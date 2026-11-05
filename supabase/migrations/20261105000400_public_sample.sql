-- 방문자가 10만 행 표를 직접 볼 수 있게 공용 샘플 발송 건 하나를 만든다.
--
-- RLS에 예외를 두지 않는다. 첫 화면과 발송 내역은 조직 조건 없이 RLS에 범위를 맡기므로,
-- 공용 조직을 읽게 열면 샘플 10만 행이 모든 사용자의 오늘 숫자에 섞인다.
-- 대신 구성원이 없는 조직에 넣어 RLS로는 아무도 못 읽게 두고, 전용 조회 경로가 이 발송 건만 읽는다.
--
-- 마이그레이션에서 바로 넣지 않고 함수로 둔다. 넣으면 로컬과 CI의 db reset마다 10만 행을 만든다.
-- 안전: queued 행을 만들지 않아 워커가 집지 않고, 제공자가 fake라 멈춘 발송 보정도 조회하지 않는다.
create function public.seed_public_sample()
returns bigint -- 만든 메시지 수
language plpgsql
set search_path = ''
as $$
declare
  c_org constant uuid := '5a3b1e00-0000-4000-8000-000000000001';
  c_campaign constant uuid := '5a3b1e00-0000-4000-8000-000000000002';
  c_count constant integer := 100000;
  c_price constant integer := 20;
  c_base constant timestamptz := '2026-11-01 00:00:00+00';
  v_inserted bigint;
begin
  -- 다시 실행하면 같은 구성으로 새로 만든다. 지우는 대상은 고정 id 하나뿐이다.
  delete from public.organizations where id = c_org;

  insert into public.organizations (id, name) values (c_org, '공용 샘플 본사');
  insert into public.campaigns (
    id, org_id, body, kind, sender_phone, status,
    recipient_count, unit_price, estimated_cost, started_at
  ) values (
    c_campaign, c_org, '10만 행 표를 확인하는 샘플 발송 건이에요', 'sms', '0200000000', 'sending',
    c_count, c_price, c_count * c_price, c_base
  );

  -- 번호로 값을 정한다. 다시 만들어도 같고, 측정 조건이 흔들리지 않는다.
  -- 010-0xxx-xxxx 형식은 발송에 쓰이지 않는다(queued 없음).
  insert into public.messages (
    campaign_id, phone, recipient_name, status, provider, provider_message_id,
    fail_code, attempt_count, sent_at, finalized_at
  )
  select
    c_campaign,
    '0100' || lpad(n::text, 7, '0'),
    '고객' || (n % 5000),
    v.status::public.message_status,
    'fake',
    'public-sample-' || n,
    case when v.status = 'failed'
      then (array['E301', 'E302', 'E410', 'E503', 'E201'])[n % 5 + 1] end,
    1,
    c_base + make_interval(secs => n),
    case when v.status <> 'sent'
      then c_base + make_interval(secs => n + 1 + n % 5) end
  from generate_series(0, c_count - 1) as n
  cross join lateral (
    -- 도착 85%, 확인 중 8%, 실패 7%. 연속 번호가 뭉치지 않게 곱해서 흩뜨린다.
    select case
      when (n::bigint * 7919) % 100 < 85 then 'delivered'
      when (n::bigint * 7919) % 100 < 93 then 'sent'
      else 'failed'
    end as status
  ) v;
  get diagnostics v_inserted = row_count;

  -- 집계 트리거는 update에만 걸려 있어 insert로 넣은 값은 직접 맞춘다.
  update public.campaigns c
  set sent_count = a.total,
      delivered_count = a.delivered,
      failed_count = a.failed
  from (
    select count(*)::integer as total,
           count(*) filter (where status = 'delivered')::integer as delivered,
           count(*) filter (where status = 'failed')::integer as failed
    from public.messages where campaign_id = c_campaign
  ) a
  where c.id = c_campaign;

  return v_inserted;
end;
$$;

revoke execute on function public.seed_public_sample() from public, anon, authenticated;
grant execute on function public.seed_public_sample() to service_role;
