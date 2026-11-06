-- 발송 상세의 "도착 확인증"이 쓰는 집계. 접수 → 발송 → 통신사 전달 → 도착 네 단계의 건수와 첫 건 시각,
-- 그리고 결과 웹훅 기록(message_events)에서 중복·순서 바뀜 횟수를 한 번에 낸다.
--
-- 발송 건의 집계 열(sent_count 등)로 계산하지 않는 이유: failed_count에는 업체가 받지도 않은 건(접수 거절)과
-- 통신사까지 갔다가 실패한 건이 섞여 있다. 둘을 나누지 않으면 "통신사 전달" 건수가 "발송" 건수보다 커질 수 있다.
--
-- 시각을 "마지막 건"이 아니라 "첫 건"으로 내는 이유: 실패는 통신사 전달에는 들어가고 도착에는 안 들어간다.
-- 마지막 건 시각이면 마지막 결과가 실패일 때 통신사 전달이 도착보다 늦게 찍혀 화살표가 거꾸로 읽힌다.
-- 첫 건 시각은 앞 단계가 뒤 단계의 상위 집합이라 순서가 뒤집히지 않는다. 끝난 시각은 completed_at으로 따로 보인다.
--
-- security invoker(기본값)다. 사용자 권한으로 돌아 RLS가 campaigns·messages·message_events를 거른다.
-- 다른 지점 발송 건 id를 넣으면 행이 없고, 있는지 없는지도 드러나지 않는다.

create function public.campaign_receipt(p_campaign_id uuid)
returns table (
  started_at timestamptz,
  completed_at timestamptz,
  queued integer,
  awaiting integer,
  delivered integer,
  carrier_failed integer,
  vendor_failed integer,
  first_accepted_at timestamptz,
  first_result_at timestamptz,
  first_delivered_at timestamptz,
  webhook_count integer,
  webhook_ignored integer,
  accepted_late integer
)
language sql
stable
set search_path = ''
as $$
  select
    c.started_at,
    c.completed_at,
    m.queued, m.awaiting, m.delivered, m.carrier_failed, m.vendor_failed,
    m.first_accepted_at, m.first_result_at, m.first_delivered_at,
    e.webhook_count, e.webhook_ignored, e.accepted_late
  from public.campaigns c
  -- 메시지는 (campaign_id, phone) 고유 인덱스로 찾는다. 한 번 훑으며 filter로 모두 센다.
  cross join lateral (
    select
      count(*) filter (where status = 'queued')::integer as queued,
      count(*) filter (where status = 'sent')::integer as awaiting,
      count(*) filter (where status = 'delivered')::integer as delivered,
      count(*) filter (where status = 'failed' and sent_at is not null)::integer as carrier_failed,
      -- 접수 기록보다 실패 웹훅이 먼저 오면 잠깐 이쪽으로 세지만, 워커가 sent_at을 채우면 바로 옮겨 간다.
      count(*) filter (where status = 'failed' and sent_at is null)::integer as vendor_failed,
      min(sent_at) as first_accepted_at,
      -- 도착은 sent_at이 비어 있어도 통신사를 거친 것이다(결과가 접수 기록보다 먼저 온 경우).
      min(finalized_at) filter (where status = 'delivered' or sent_at is not null) as first_result_at,
      min(finalized_at) filter (where status = 'delivered') as first_delivered_at
    from public.messages
    where campaign_id = c.id
  ) m
  cross join lateral (
    select
      count(*) filter (where ev.source = 'webhook')::integer as webhook_count,
      -- 이미 확정된 뒤에 온 결과와 더 오래된 결과. 둘 다 기록만 하고 상태는 바꾸지 않았다.
      count(*) filter (where ev.source = 'webhook' and ev.outcome in ('ignored_final', 'ignored_stale'))::integer as webhook_ignored,
      -- 결과가 먼저 와서 접수가 나중에 시각만 채운 건.
      count(*) filter (where ev.kind = 'accepted' and ev.outcome = 'recorded_late')::integer as accepted_late
    from public.messages mm
    join public.message_events ev on ev.message_id = mm.id
    where mm.campaign_id = c.id
  ) e
  where c.id = p_campaign_id;
$$;

revoke execute on function public.campaign_receipt(uuid) from public, anon;
grant execute on function public.campaign_receipt(uuid) to authenticated;
