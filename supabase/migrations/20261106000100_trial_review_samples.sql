-- 체험 샘플에 승인 대기·예약·반려 발송 건을 더한다. 완료·확인 중만 있으면 승인함과 예약 취소,
-- 반려 사유 화면을 체험에서 볼 수 없다. 상태마다 실제 함수가 남기는 것과 같은 행을 만든다.
--   승인 대기: 메시지는 미리 만들고 차감하지 않는다(submit_campaign과 같다).
--   예약: 메시지를 예약 시각에 대기시키고 선점한다. 체험이라 시각이 되면 가짜 발송기로 나간다.
--   반려: 메시지를 지우고 사유를 남긴다(reject_campaign과 같다).
-- 예약 선점만큼 먼저 충전해 최종 잔액은 기존 데모 값 그대로다.

alter function public.create_trial_org(uuid) rename to create_trial_org_before_review;
revoke execute on function public.create_trial_org_before_review(uuid) from public, anon, authenticated;

create function public.create_trial_org(p_user_id uuid)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_org_id uuid;
  v_existed boolean;
  v_seongsu uuid;
  v_mangwon uuid;
  v_hapjeong uuid;
  v_campaign_id uuid;
  v_order_id text;
  v_payment_id uuid;
  v_recipients constant integer := 30;
  v_price constant integer := 20;
  -- 내일 10시(KST). 광고 야간 제한에 걸리지 않고, 3일 뒤 삭제 전에 실제로 나가는 모습도 볼 수 있다.
  v_tomorrow_10 timestamptz :=
    (date_trunc('day', now() at time zone 'Asia/Seoul') + interval '1 day 10 hours') at time zone 'Asia/Seoul';
begin
  v_existed := exists (select 1 from public.members where user_id = p_user_id);
  v_org_id := public.create_trial_org_before_review(p_user_id);

  -- 이미 있던 본사는 사용자가 쓰던 데이터이므로 건드리지 않는다.
  if v_existed then
    return v_org_id;
  end if;

  select id into v_seongsu from public.branches where org_id = v_org_id and name = '성수점';
  select id into v_mangwon from public.branches where org_id = v_org_id and name = '망원점';
  select id into v_hapjeong from public.branches where org_id = v_org_id and name = '합정점';

  -- 승인 대기: 성수점 광고. 예약 시각이 없어 본사가 승인하면 바로 나가고, 진행률이 실시간으로 차오른다.
  insert into public.campaigns (
    org_id, branch_id, body, kind, is_ad, sender_phone, status,
    requested_at, recipient_count, unit_price, estimated_cost, created_at
  )
  values (
    v_org_id, v_seongsu,
    E'(광고)dahda마트 성수점 010-0000-0002\n주말 과일 할인 안내\n무료거부 080-000-0000',
    'sms', true, '01000000002', 'pending_approval',
    now() - interval '20 minutes', v_recipients, v_price, v_recipients * v_price,
    now() - interval '20 minutes'
  )
  returning id into v_campaign_id;

  insert into public.messages (campaign_id, org_id, phone, recipient_name, next_attempt_at)
  select v_campaign_id, v_org_id, '01000' || lpad((200 + n)::text, 6, '0'), '고객' || (200 + n),
    now() - interval '20 minutes'
  from generate_series(1, v_recipients) as n;

  -- 반려: 망원점 광고. 지점이 발송 내역에서 사유를 본다.
  insert into public.campaigns (
    org_id, branch_id, body, kind, is_ad, sender_phone, status, rejected_reason,
    requested_at, reviewed_by, reviewed_at, recipient_count, unit_price, estimated_cost, created_at
  )
  values (
    v_org_id, v_mangwon,
    E'(광고)dahda마트 망원점 010-0000-0003\n개점 기념 전 품목 할인\n무료거부 080-000-0000',
    'sms', true, '01000000003', 'rejected', '수신 동의 확인이 필요해요',
    now() - interval '1 day 2 hours', p_user_id, now() - interval '1 day 1 hour',
    v_recipients, v_price, v_recipients * v_price, now() - interval '1 day 2 hours'
  );

  -- 예약: 합정점 일반 문자. 승인을 거치지 않은 예약이라 지점이 취소할 수 있다.
  v_order_id := 'trial-' || gen_random_uuid();
  insert into public.payments (org_id, branch_id, order_id, payment_key, amount, status, approved_at)
  values (v_org_id, v_hapjeong, v_order_id, v_order_id, v_recipients * v_price, 'done', now())
  returning id into v_payment_id;
  insert into public.ledger_entries (org_id, branch_id, kind, amount, payment_id, idempotency_key)
  values (v_org_id, v_hapjeong, 'charge', v_recipients * v_price, v_payment_id, 'charge:' || v_order_id);

  insert into public.campaigns (
    org_id, branch_id, body, kind, is_ad, sender_phone, status, scheduled_at,
    recipient_count, unit_price, estimated_cost, created_at
  )
  values (
    v_org_id, v_hapjeong, '합정점 내일 정기 점검으로 오전 영업이 1시간 늦어집니다',
    'sms', false, '01000000004', 'scheduled', v_tomorrow_10,
    v_recipients, v_price, v_recipients * v_price, now() - interval '5 minutes'
  )
  returning id into v_campaign_id;

  insert into public.messages (campaign_id, org_id, phone, recipient_name, next_attempt_at)
  select v_campaign_id, v_org_id, '01000' || lpad((300 + n)::text, 6, '0'), '고객' || (300 + n),
    v_tomorrow_10
  from generate_series(1, v_recipients) as n;

  perform public.reserve_balance(
    v_org_id, v_hapjeong, v_campaign_id, v_recipients * v_price, 'reserve:' || v_campaign_id
  );

  return v_org_id;
end;
$$;

revoke execute on function public.create_trial_org(uuid) from public, anon, authenticated;
grant execute on function public.create_trial_org(uuid) to service_role;
