-- 첫 화면 "발송 추이": 일별(최근 30일)·월별(최근 12개월) 도착·확인 중·실패.
--
-- 메시지(수만~수십만 행)가 아니라 발송 건의 집계 열(delivered_count 등)을 더한다. 웹훅이 이미 세어 둔 값이라
-- 첫 화면을 열 때마다 메시지를 훑지 않아도 된다. today_campaign_summary와 같은 정의를 써서
-- "오늘 도착률"과 추이의 오늘 칸이 어긋나지 않게 한다.
--   - 기준 시각은 started_at(실제로 나가기 시작한 때). 예약 건은 만든 날이 아니라 나간 날에 들어간다.
--   - 승인 대기·예약·반려·취소처럼 나가지 않은 건은 세지 않는다.
--   - 확인 중 = 업체가 받았지만 결과가 아직 없는 수. 대기(queued)는 아직 나가지 않아 넣지 않는다.
--
-- 칸은 KST 날짜다. 빈 칸 채우기는 화면 코드(kstBuckets)가 한다. 여기서 generate_series로 채우면
-- 시간대 계산이 두 곳에 생긴다.
-- security invoker(기본값): 호출한 사용자의 RLS가 그대로 적용되어 지점은 자기 지점, 본사는 전체를 본다.

create function public.campaign_trend(p_from timestamptz, p_unit text)
returns table (
  bucket date,
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
    date_trunc(p_unit, c.started_at at time zone 'Asia/Seoul')::date,
    count(*),
    coalesce(sum(c.recipient_count), 0)::bigint,
    coalesce(sum(c.delivered_count), 0)::bigint,
    coalesce(sum(greatest(0, c.sent_count - c.delivered_count - c.failed_count)), 0)::bigint,
    coalesce(sum(c.failed_count), 0)::bigint
  from public.campaigns c
  where c.started_at >= p_from
    and c.status in ('sending', 'completed')
    -- 다른 단위가 오면 date_trunc가 실패하기 전에 빈 결과로 끝낸다.
    and p_unit in ('day', 'month')
  group by 1
  order by 1;
$$;

revoke execute on function public.campaign_trend(timestamptz, text) from public, anon;
grant execute on function public.campaign_trend(timestamptz, text) to authenticated, service_role;
