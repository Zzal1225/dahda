-- 메시지별 결과 기록. 워커 접수, 웹훅, 업체 조회가 메시지에 무엇을 했는지 한 줄씩 남긴다.
-- 상태 열은 최종 결과만 보여 주므로 "웹훅이 두 번 왔지만 한 번만 반영했다", "결과가 접수 기록보다 먼저 왔다"는 사실이 사라진다.
-- webhook_events를 화면에 쓰지 않는 이유: 원문이라 메시지와 잇는 열이 없고, 위조 요청까지 들어 있어 사용자에게 열지 않는다.
-- 이 기록은 보여 주기용이다. 원본 사실은 여전히 webhook_events이고, 이 기록을 못 남겨도 상태 전이는 되돌리지 않는다.

create table public.message_events (
  id bigint generated always as identity primary key,
  message_id bigint not null references public.messages (id) on delete cascade,
  -- 기록 함수가 메시지에서 복사한다. RLS가 메시지와 같은 범위로 거른다.
  org_id uuid not null,
  branch_id uuid,
  source text not null check (source in ('worker', 'webhook', 'reconcile')),
  kind text not null check (kind in ('accepted', 'retry', 'deferred', 'send_failed', 'delivered', 'failed')),
  -- status.ts의 MessageOutcome. retry·deferred는 상태 전이가 아니라 다시 줄을 세운 것이라 scheduled다.
  outcome text not null check (outcome in ('applied', 'recorded_late', 'ignored_final', 'ignored_stale', 'scheduled')),
  fail_code text,
  -- 업체나 워커가 말한 시각. 받은 시각과 다르면 순서가 뒤집혀 도착했다는 뜻이다.
  occurred_at timestamptz not null,
  received_at timestamptz not null default now()
);
create index message_events_message_idx on public.message_events (message_id, received_at);

alter table public.message_events enable row level security;
grant select on public.message_events to authenticated;

create policy message_events_select on public.message_events for select to authenticated
  using (
    org_id = (select private.current_org_id())
    and ((select private.is_hq()) or branch_id = (select private.current_branch_id()))
  );

-- 한 번에 여러 줄을 남긴다. 워커는 묶음 500건이라 건마다 부르면 왕복이 500번이다.
-- 범위를 부르는 쪽에서 받지 않고 메시지에서 읽는다. 넘긴 값을 믿으면 다른 본사 기록으로 섞일 수 있다.
-- 체험 삭제 등으로 사라진 메시지는 조인에서 빠진다.
create function public.record_message_events(p_events jsonb)
returns void
language sql
set search_path = ''
as $$
  insert into public.message_events (
    message_id, org_id, branch_id, source, kind, outcome, fail_code, occurred_at
  )
  select m.id, m.org_id, m.branch_id, e.source, e.kind, e.outcome, e.fail_code, e.occurred_at
  from jsonb_to_recordset(p_events) as e(
    message_id bigint, source text, kind text, outcome text, fail_code text, occurred_at timestamptz
  )
  join public.messages m on m.id = e.message_id;
$$;

revoke execute on function public.record_message_events(jsonb) from public, anon, authenticated;
grant execute on function public.record_message_events(jsonb) to service_role;


-- ---------------------------------------------------------------------------
-- 체험 샘플의 기록. 샘플 메시지는 함수가 바로 만든 행이라 기록이 없어 "기록 보기"가 비어 보인다.
-- 실제 경로가 남기는 것과 같은 줄을 만들고, 중복(약 5%)과 순서 바뀜(약 4%)을 섞어 처리 결과가 보이게 한다.
-- 샘플 메시지(provider_message_id가 trial-로 시작)만 대상이다. 사용자가 직접 보낸 메시지에 지어낸 기록을 붙이지 않는다.
-- ---------------------------------------------------------------------------
create function public.seed_sample_message_events(p_org_id uuid)
returns void
language sql
set search_path = ''
as $$
  with sample as (
    select m.id, m.org_id, m.branch_id, m.status, m.fail_code, m.sent_at, m.finalized_at,
      right(m.phone, 6)::integer as n,
      m.finalized_at is not null as final
    from public.messages m
    where m.org_id = p_org_id
      and m.provider = 'fake'
      and m.provider_message_id like 'trial-%'
      and m.sent_at is not null
      and not exists (select 1 from public.message_events e where e.message_id = m.id)
  )
  insert into public.message_events (
    message_id, org_id, branch_id, source, kind, outcome, fail_code, occurred_at, received_at
  )
  -- 순서 바뀜: 결과 웹훅이 워커의 접수 기록보다 먼저 와서, 접수는 나중에 시각만 채웠다.
  select id, org_id, branch_id, 'worker', 'accepted',
    case when final and n % 25 = 3 then 'recorded_late' else 'applied' end,
    null, sent_at,
    case when final and n % 25 = 3 then finalized_at + interval '800 milliseconds' else sent_at end
  from sample
  union all
  select id, org_id, branch_id, 'webhook', status::text, 'applied', fail_code, finalized_at, finalized_at
  from sample where final
  union all
  -- 중복: 업체가 같은 결과를 한 번 더 보냈다. 상태는 그대로다.
  select id, org_id, branch_id, 'webhook', status::text, 'ignored_final', fail_code, finalized_at,
    finalized_at + interval '2 seconds'
  from sample where final and n % 20 = 7;
$$;

revoke execute on function public.seed_sample_message_events(uuid) from public, anon, authenticated;
grant execute on function public.seed_sample_message_events(uuid) to service_role;

alter function public.create_trial_org(uuid) rename to create_trial_org_before_events;
revoke execute on function public.create_trial_org_before_events(uuid) from public, anon, authenticated;

create function public.create_trial_org(p_user_id uuid)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_org_id uuid;
begin
  v_org_id := public.create_trial_org_before_events(p_user_id);
  -- 이미 기록이 있는 메시지는 건너뛰므로 두 번 불러도 같다.
  perform public.seed_sample_message_events(v_org_id);
  return v_org_id;
end;
$$;

revoke execute on function public.create_trial_org(uuid) from public, anon, authenticated;
grant execute on function public.create_trial_org(uuid) to service_role;

-- 이미 있는 체험 본사에도 채운다. 체험은 3일이면 지워지지만 그 사이 방문자도 같은 화면을 봐야 한다.
select public.seed_sample_message_events(o.id)
from public.organizations o
where o.trial_expires_at is not null;
