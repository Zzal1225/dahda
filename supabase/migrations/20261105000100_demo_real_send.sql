-- 채용 담당자가 자기 폰으로 실제 문자를 받아 보는 체험 경로.
-- 체험은 원래 항상 가짜 발송기다. 이 경로만 예외이므로 조건을 사용자가 건드릴 수 없는 곳에 둔다.
-- is_real_demo는 service_role만 쓴다(campaigns 쓰기 정책 없음). 본문·발신번호는 서버 상수로만 들어온다.
alter table public.campaigns add column is_real_demo boolean not null default false;

-- 세션(익명 사용자)당 1건, 번호당 1건. 체험 조직은 3일 뒤 지워지므로 발송 건을 세면 제한도 함께 풀린다.
-- 그래서 따로 둔다. 원번호를 남기지 않으려고 해시만 둔다. 전화번호는 경우의 수가 적어 해시를 되돌릴 수 있으므로
-- 익명화가 아니다. 정책 없음(= service_role만)과 30일 삭제를 함께 쓴다.
-- user_id에 외래 키를 걸지 않는다. 체험 사용자가 지워져도 제한 기록은 30일까지 남아야 한다.
create table public.demo_sends (
  user_id uuid primary key,
  phone_hash text not null unique,
  created_at timestamptz not null default now()
);
alter table public.demo_sends enable row level security;

select cron.schedule(
  'purge-demo-sends',
  '50 3 * * *',
  $$delete from public.demo_sends where created_at < now() - interval '30 days'$$
);

create function public.start_demo_send(
  p_user_id uuid,
  p_org_id uuid,
  p_branch_id uuid,
  p_phone text,
  p_sender_phone public.phone_digits,
  p_body text,
  p_unit_price integer,
  p_daily_limit integer
)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_hash text := encode(sha256(convert_to(p_phone, 'UTF8')), 'hex');
  v_used integer;
  v_campaign_id uuid;
begin
  if not exists (
    select 1
    from public.members m
    join public.organizations o on o.id = m.org_id
    where m.user_id = p_user_id and m.org_id = p_org_id and o.trial_expires_at is not null
  ) then
    raise exception 'not_trial' using errcode = 'DH014';
  end if;
  if exists (select 1 from public.demo_sends where user_id = p_user_id) then
    raise exception 'already_sent' using errcode = 'DH016';
  end if;
  if exists (select 1 from public.demo_sends where phone_hash = v_hash) then
    raise exception 'phone_used' using errcode = 'DH017';
  end if;

  -- 안내용 확인이다. 진짜 상한은 워커의 reserve_real_sends가 보내기 직전에 잡는다.
  -- 여기서 막지 않으면 담당자가 접수 뒤에야 실패를 본다.
  select sent into v_used
  from public.real_send_counters
  where day = (now() at time zone 'Asia/Seoul')::date;
  if coalesce(v_used, 0) >= p_daily_limit then
    raise exception 'daily_limit' using errcode = 'DH015';
  end if;

  -- 동시 요청은 유일 제약(23505)에서 막힌다. 잔액 부족이면 아래에서 함께 되돌려져 기회를 잃지 않는다.
  insert into public.demo_sends (user_id, phone_hash) values (p_user_id, v_hash);

  v_campaign_id := public.submit_campaign(
    gen_random_uuid(),
    p_org_id,
    p_branch_id,
    p_user_id,
    p_body,
    'sms',
    false,
    p_sender_phone,
    'scheduled',
    null,
    p_unit_price,
    jsonb_build_array(jsonb_build_object('phone', p_phone, 'name', null))
  );

  update public.campaigns set is_real_demo = true where id = v_campaign_id;
  return v_campaign_id;
end;
$$;

revoke execute on function public.start_demo_send(uuid, uuid, uuid, text, public.phone_digits, text, integer, integer)
  from public, anon, authenticated;
grant execute on function public.start_demo_send(uuid, uuid, uuid, text, public.phone_digits, text, integer, integer)
  to service_role;

-- 반환 열이 바뀌므로 지우고 다시 만든다.
drop function public.claim_messages(integer, integer);
create function public.claim_messages(p_limit integer, p_lease_seconds integer)
returns table (
  id bigint,
  campaign_id uuid,
  campaign_status public.campaign_status,
  phone text,
  idempotency_key uuid,
  attempt_count integer,
  body text,
  kind public.campaign_kind,
  sender_phone text,
  is_ad boolean,
  is_trial boolean,
  is_real_demo boolean
)
language plpgsql
set search_path = ''
as $$
begin
  return query
  with picked as (
    select m.id
    from public.messages m
    join public.campaigns c on c.id = m.campaign_id
    where m.status = 'queued'
      and m.next_attempt_at <= now()
      -- 승인 대기 메시지도 시각은 이미 지났을 수 있다. 이 조건이 승인 전 광고 발송을 막는다.
      and c.status in ('scheduled', 'sending')
    order by m.next_attempt_at, m.id
    for update of m skip locked
    limit p_limit
  ),
  leased as (
    update public.messages m
    set attempt_count = m.attempt_count + 1,
        next_attempt_at = now() + make_interval(secs => p_lease_seconds)
    from picked
    where m.id = picked.id
    returning m.id, m.campaign_id, m.phone, m.idempotency_key, m.attempt_count
  )
  select l.id, l.campaign_id, c.status, l.phone::text, l.idempotency_key, l.attempt_count,
         c.body, c.kind, c.sender_phone::text, c.is_ad, o.trial_expires_at is not null, c.is_real_demo
  from leased l
  join public.campaigns c on c.id = l.campaign_id
  join public.organizations o on o.id = c.org_id
  order by l.id;
end;
$$;
revoke execute on function public.claim_messages(integer, integer) from public, anon, authenticated;
grant execute on function public.claim_messages(integer, integer) to service_role;

-- 체험 문자는 1회뿐이다. 재발송은 플래그를 물려받지 않아 가짜 발송기로 가고,
-- 폰에 오지 않은 문자가 "도착"으로 보이게 된다. 그래서 대상에서 뺀다.
create or replace function private.retry_targets(p_source_id uuid, p_org_id uuid, p_message_ids bigint[])
returns table (phone text, recipient_name text, fail_code text)
language sql
stable
security definer
set search_path = ''
as $$
  select m.phone::text, m.recipient_name, m.fail_code
  from public.messages m
  join public.campaigns source on source.id = m.campaign_id
  where m.campaign_id = p_source_id
    and m.org_id = p_org_id
    and m.status = 'failed'
    and m.id = any (p_message_ids)
    and not source.is_real_demo
    -- 원본을 보낸 뒤 수신거부한 사람에게 다시 보내면 안 된다.
    and not exists (
      select 1 from public.opt_outs o
      where o.org_id = p_org_id and o.phone = m.phone
    )
    -- 버튼을 두 번 누르거나 다른 담당자가 먼저 보낸 경우 두 번 보내고 두 번 차감하지 않는다.
    -- 재발송이 반려·취소됐다면 나가지 않은 것이므로 다시 보낼 수 있다.
    and not exists (
      select 1
      from public.campaigns rc
      join public.messages r on r.campaign_id = rc.id
      where rc.retry_of_campaign_id = p_source_id
        and rc.status not in ('rejected', 'canceled')
        and r.phone = m.phone
    );
$$;
