-- 광고 수신 동의. 값이 있으면 동의한 시각, 없으면 동의 기록 없음이다.
-- 기본값을 두지 않는다. 기록이 없는 기존 번호를 동의로 치면 광고가 동의 없이 나간다.
-- 동의 수집과 철회 이력은 범위 밖이다. 콘솔은 저장된 값으로 제외만 한다.
alter table public.contacts add column consent_at timestamptz;

-- 체험 샘플은 80%만 동의로 둔다. 전부 동의면 제외 동작을 볼 수 없다. 번호로 정해 매번 같다.
update public.contacts c
set consent_at = c.created_at
from public.organizations o
where o.id = c.org_id
  and o.trial_expires_at is not null
  and right(c.phone, 2)::integer % 5 <> 0;

alter function public.create_trial_org(uuid) rename to create_trial_org_before_consent;
revoke execute on function public.create_trial_org_before_consent(uuid) from public, anon, authenticated;

create function public.create_trial_org(p_user_id uuid)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_org_id uuid;
  v_existed boolean;
begin
  v_existed := exists (select 1 from public.members where user_id = p_user_id);
  v_org_id := public.create_trial_org_before_consent(p_user_id);

  -- 이미 있던 본사는 사용자가 쓰던 데이터이므로 건드리지 않는다.
  if v_existed then
    return v_org_id;
  end if;

  update public.contacts
  set consent_at = now()
  where org_id = v_org_id
    and right(phone, 2)::integer % 5 <> 0;

  return v_org_id;
end;
$$;

revoke execute on function public.create_trial_org(uuid) from public, anon, authenticated;
grant execute on function public.create_trial_org(uuid) to service_role;

-- 첫 화면의 오늘 숫자. 행을 앱으로 가져와 합치면 상한을 둬야 하므로 DB에서 합친다.
-- security invoker라 RLS가 범위를 정한다. 지점은 자기 지점, 본사는 전체이고, 구성원 없는 공용 샘플은 섞이지 않는다.
-- 대기 건은 pending에 넣지 않는다. 접수 누계에서 확정 건을 뺀 값이 "확인 중"이고, 집계가 잠시 어긋나도 음수가 되지 않게 한다.
create function public.today_campaign_summary(p_from timestamptz)
returns table (
  campaign_count bigint,
  recipient_count bigint,
  delivered bigint,
  pending bigint,
  failed bigint
)
language sql
stable
set search_path = ''
as $$
  select
    count(*),
    coalesce(sum(c.recipient_count), 0)::bigint,
    coalesce(sum(c.delivered_count), 0)::bigint,
    coalesce(sum(greatest(0, c.sent_count - c.delivered_count - c.failed_count)), 0)::bigint,
    coalesce(sum(c.failed_count), 0)::bigint
  from public.campaigns c
  where c.started_at >= p_from
    and c.status in ('sending', 'completed');
$$;

revoke execute on function public.today_campaign_summary(timestamptz) from public, anon;
grant execute on function public.today_campaign_summary(timestamptz) to authenticated, service_role;

create index campaigns_started_at_idx on public.campaigns (started_at) where started_at is not null;
