-- 체험 샘플을 다양하게 만든다. 지금까지는 계정마다 "이번 주 특가 안내" 120명이 똑같이 반복되고,
-- 진행률·실패 수·시각이 모두 같아 기계로 찍은 데이터로 보였다. 실제 마트에서 한 주에 나갈 법한 발송으로 바꾼다.
--
-- 바꾸는 함수 셋. 감싸는 순서(바깥 → 안)는 그대로다.
--   create_trial_org_before_events : 승인 대기·반려·예약 샘플의 제목·인원·시각
--   create_trial_org_before_consent: 광고 제목을 모두 "이번 주 특가 안내"로 덮어쓰던 일을 뺀다
--   create_trial_org_base          : 보낸 발송 건 샘플
-- 최종 잔액은 기존 데모 값 그대로다. 선점·환불만큼 먼저 충전하는 방식도 같다.
-- 이미 있는 체험 본사는 바꾸지 않는다. 3일 안에 지워지고, 쓰던 화면이 갑자기 바뀌면 안 된다.

create or replace function public.create_trial_org_base(p_user_id uuid)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_org_id uuid;
  v_branch record;
  v_account record;
  v_sample record;
  v_payment_id uuid;
  v_order_id text;
  v_campaign_id uuid;
  v_price integer;
  v_spent integer;
  v_body text;
  -- KST 오늘 0시(시간대 없는 값). 지난 발송은 "며칠 전 몇 시 몇 분"으로 둔다.
  v_today timestamp := date_trunc('day', now() at time zone 'Asia/Seoul');
begin
  -- 체험하기를 두 번 눌러도 본사가 둘 생기지 않게 한다.
  select org_id into v_org_id from public.members where user_id = p_user_id;
  if found then
    return v_org_id;
  end if;

  insert into public.organizations (name, trial_expires_at)
  values ('dahda마트 본사', now() + interval '3 days')
  returning id into v_org_id;

  insert into public.members (user_id, org_id, branch_id, role, display_name)
  values (p_user_id, v_org_id, null, 'hq', '체험 사용자');

  -- 숫자를 직접 넣는 지름길을 두면 체험 데이터만 "거래 기록의 합계" 원칙을 어기게 된다.
  create temporary table trial_accounts (branch_id uuid, name text, phone text, label text, amount integer)
    on commit drop;

  -- 샘플 번호는 실제 번호가 아닌 형식만 쓴다(기획서 운영·안전 정책).
  insert into trial_accounts values (null, '본사', '01000000001', '본사 대표', 8500000);

  for v_branch in
    select * from (values
      ('성수점', '01000000002', 2000000),
      ('망원점', '01000000003', 1310400),
      ('합정점', '01000000004', 864200)
    ) as t(name, phone, amount)
  loop
    with created as (
      insert into public.branches (org_id, name)
      values (v_org_id, v_branch.name)
      returning id
    )
    insert into trial_accounts
    select id, v_branch.name, v_branch.phone, v_branch.name || ' 대표', v_branch.amount from created;
  end loop;

  -- 보낸 발송 건. 진행 중 둘, 오늘 끝난 하나, 지난 며칠의 넷. 인원·도착·실패·시각이 모두 다르다.
  -- 확인 중 = 인원 - 도착 - 실패. 끝난 건은 확인 중이 0이어야 한다.
  -- 제목 줄(middle)은 광고면 (광고)·전송자·무료거부 사이에 들어가고, 아니면 본문 그대로다.
  create temporary table trial_samples (
    account text, status public.campaign_status, is_ad boolean, kind public.campaign_kind,
    middle text, recipients integer, delivered integer, failed integer,
    started_at timestamptz, finish_after interval
  ) on commit drop;

  insert into trial_samples values
    ('본사', 'sending', true, 'lms',
      E'11월 둘째 주 행사 안내\n- 신선 코너 전 품목 10~30% 할인\n- 기간: 이번 주 월요일부터 일요일까지',
      1240, 893, 18, now() - interval '18 minutes 24 seconds', null),
    ('망원점', 'sending', false, 'sms',
      '[배송 지연 안내] 오늘 오후 주문 상품이 1시간가량 늦게 도착해요',
      86, 64, 9, now() - interval '7 minutes 51 seconds', null),
    ('성수점', 'completed', true, 'sms',
      '주말 과일 할인',
      30, 30, 0, now() - interval '47 minutes 12 seconds', interval '6 minutes 3 seconds'),
    ('본사', 'completed', false, 'lms',
      E'[멤버십 포인트 소멸 예정 안내]\n이번 달 말에 소멸 예정인 포인트가 있어요. 남은 포인트는 매장 계산대와 앱에서 확인할 수 있어요.',
      640, 628, 12, (v_today - interval '3 days' + interval '10 hours 12 minutes 37 seconds') at time zone 'Asia/Seoul', interval '9 minutes 41 seconds'),
    ('성수점', 'completed', false, 'sms',
      '[주차장 공사 안내] 내일 오전 지하 주차장 B2 공사로 B1만 이용할 수 있어요',
      212, 209, 3, (v_today - interval '1 day' + interval '16 hours 37 minutes 5 seconds') at time zone 'Asia/Seoul', interval '4 minutes 18 seconds'),
    ('망원점', 'completed', true, 'sms',
      '김장 재료 사전 예약',
      154, 148, 6, (v_today - interval '4 days' + interval '11 hours 28 minutes 44 seconds') at time zone 'Asia/Seoul', interval '5 minutes 7 seconds'),
    ('합정점', 'completed', false, 'sms',
      '[영업시간 변경 안내] 다음 주부터 평일 영업이 밤 10시까지로 바뀌어요',
      120, 118, 2, (v_today - interval '5 days' + interval '9 hours 5 minutes 19 seconds') at time zone 'Asia/Seoul', interval '3 minutes 52 seconds');

  for v_account in select * from trial_accounts loop
    insert into public.sender_numbers (org_id, branch_id, number, label, is_default)
    values (v_org_id, v_account.branch_id, v_account.phone, v_account.label, true);

    -- 이 계정에서 빠져나갈 금액(선점 - 끝난 건의 실패분 환불)만큼 더 충전해 최종 잔액을 데모 값으로 맞춘다.
    select coalesce(sum(
      s.recipients * (case s.kind when 'lms' then 50 else 20 end)
      - case when s.status = 'completed' then s.failed * (case s.kind when 'lms' then 50 else 20 end) else 0 end
    ), 0)::integer
    into v_spent
    from trial_samples s where s.account = v_account.name;

    v_order_id := 'trial-' || gen_random_uuid();
    insert into public.payments (org_id, branch_id, order_id, payment_key, amount, status, approved_at)
    values (v_org_id, v_account.branch_id, v_order_id, v_order_id, v_account.amount + v_spent, 'done', now())
    returning id into v_payment_id;

    insert into public.ledger_entries (org_id, branch_id, kind, amount, payment_id, idempotency_key)
    values (v_org_id, v_account.branch_id, 'charge', v_account.amount + v_spent, v_payment_id, 'charge:' || v_order_id);

    for v_sample in select * from trial_samples s where s.account = v_account.name loop
      -- 단가는 campaignSchema.ts의 UNIT_PRICE와 같다.
      v_price := case v_sample.kind when 'lms' then 50 else 20 end;
      v_body := case when v_sample.is_ad then
          '(광고)dahda마트' ||
          case when v_account.branch_id is null then '' else ' ' || v_account.name end || ' ' ||
          regexp_replace(v_account.phone, '^(\d{3})(\d{4})(\d{4})$', '\1-\2-\3') ||
          E'\n' || v_sample.middle || E'\n무료거부 080-000-0000'
        else v_sample.middle end;

      insert into public.campaigns (
        org_id, branch_id, body, kind, is_ad, sender_phone, status,
        recipient_count, unit_price, estimated_cost,
        sent_count, delivered_count, failed_count,
        started_at, completed_at, created_at
      )
      values (
        v_org_id, v_account.branch_id, v_body, v_sample.kind, v_sample.is_ad, v_account.phone, v_sample.status,
        v_sample.recipients, v_price, v_sample.recipients * v_price,
        v_sample.recipients, v_sample.delivered, v_sample.failed,
        v_sample.started_at, v_sample.started_at + v_sample.finish_after,
        -- 작성은 보내기 몇 분 전이다. 같은 시각이면 목록 순서가 정해지지 않는다.
        v_sample.started_at - interval '2 minutes 13 seconds'
      )
      returning id into v_campaign_id;

      -- 실패·확인 중이 앞번호에 몰리지 않게 섞는다. 7919는 소수라 인원이 그 배수가 아니면 1..인원을 한 번씩 거친다.
      insert into public.messages (
        campaign_id, org_id, phone, recipient_name, status, provider, provider_message_id,
        fail_code, attempt_count, sent_at, finalized_at
      )
      select
        v_campaign_id,
        v_org_id,
        '01000' || lpad(n::text, 6, '0'),
        -- 이름도 "고객1, 고객2"보다 실제 명단처럼 보이게 성과 이름을 엇갈려 고른다.
        (array['김','이','박','최','정','강','조','윤','장','임','한','오','서','신','권','황','안','송','류','홍'])[(n * 7) % 20 + 1] ||
        (array['민준','서연','도윤','하은','지호','수아','예준','지유','시우','서윤','주원','하린','지민','유나','현우','채원','준서','다은','건우','소율'])[(n * 13) % 20 + 1],
        s.status,
        'fake',
        'trial-' || v_campaign_id || '-' || n,
        case when s.status = 'failed' then (array['E301','E302','E410','E503','E201'])[n % 5 + 1] end,
        1,
        v_sample.started_at + (n * 45 || ' milliseconds')::interval,
        case when s.status <> 'sent'
          then v_sample.started_at + (n * 45 || ' milliseconds')::interval + ((2 + (n * 7919) % 37) || ' seconds')::interval
        end
      from generate_series(1, v_sample.recipients) as n
      cross join lateral (
        select case
          when (n * 7919) % v_sample.recipients < v_sample.failed then 'failed'
          when (n * 7919) % v_sample.recipients < v_sample.recipients - v_sample.delivered then 'sent'
          else 'delivered'
        end::public.message_status as status
      ) as s;

      insert into public.ledger_entries (org_id, branch_id, kind, amount, campaign_id, idempotency_key)
      values (v_org_id, v_account.branch_id, 'reserve', -(v_sample.recipients * v_price), v_campaign_id, 'reserve:' || v_campaign_id);

      -- 실패분 환불은 끝날 때 한 번 기록한다. 진행 중인 건은 아직 확정되지 않았다.
      if v_sample.status = 'completed' and v_sample.failed > 0 then
        insert into public.ledger_entries (org_id, branch_id, kind, amount, campaign_id, idempotency_key)
        values (v_org_id, v_account.branch_id, 'release', v_sample.failed * v_price, v_campaign_id, 'release:' || v_campaign_id);
      end if;
    end loop;
  end loop;

  return v_org_id;
end;
$$;

revoke execute on function public.create_trial_org_base(uuid) from public, anon, authenticated;

-- 광고 문구는 이제 바닥 함수가 규칙대로 만든다. 여기서 덮어쓰면 모든 광고 제목이 같아진다.
create or replace function public.create_trial_org_before_consent(p_user_id uuid)
returns uuid
language plpgsql
set search_path = ''
as $$
begin
  return public.create_trial_org_with_contacts(p_user_id);
end;
$$;

revoke execute on function public.create_trial_org_before_consent(uuid) from public, anon, authenticated;

-- 승인 대기·반려·예약. 모양(메시지·선점 여부)은 20261106000100과 같고 제목·인원·시각만 다르다.
create or replace function public.create_trial_org_before_events(p_user_id uuid)
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
  v_price constant integer := 20;
  v_today timestamp := date_trunc('day', now() at time zone 'Asia/Seoul');
  -- 내일 10시(KST). 광고 야간 제한에 걸리지 않고, 3일 뒤 삭제 전에 실제로 나가는 모습도 볼 수 있다.
  v_tomorrow_10 timestamptz := (v_today + interval '1 day 10 hours') at time zone 'Asia/Seoul';
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

  -- 승인 대기: 성수점 광고 48명. 예약 시각이 없어 본사가 승인하면 바로 나가고, 진행률이 실시간으로 차오른다.
  insert into public.campaigns (
    org_id, branch_id, body, kind, is_ad, sender_phone, status,
    requested_at, recipient_count, unit_price, estimated_cost, created_at
  )
  values (
    v_org_id, v_seongsu,
    E'(광고)dahda마트 성수점 010-0000-0002\n한우 등심 할인 예약\n무료거부 080-000-0000',
    'sms', true, '01000000002', 'pending_approval',
    now() - interval '26 minutes 40 seconds', 48, v_price, 48 * v_price,
    now() - interval '26 minutes 40 seconds'
  )
  returning id into v_campaign_id;

  insert into public.messages (campaign_id, org_id, phone, recipient_name, next_attempt_at)
  select v_campaign_id, v_org_id, '01000' || lpad((2000 + n)::text, 6, '0'), '고객' || (2000 + n),
    now() - interval '26 minutes 40 seconds'
  from generate_series(1, 48) as n;

  -- 반려: 망원점 광고 64명. 지점이 발송 내역에서 사유를 본다.
  insert into public.campaigns (
    org_id, branch_id, body, kind, is_ad, sender_phone, status, rejected_reason,
    requested_at, reviewed_by, reviewed_at, recipient_count, unit_price, estimated_cost, created_at
  )
  values (
    v_org_id, v_mangwon,
    E'(광고)dahda마트 망원점 010-0000-0003\n개점 기념 전 품목 할인\n무료거부 080-000-0000',
    'sms', true, '01000000003', 'rejected', '수신 동의 확인이 필요해요',
    (v_today - interval '1 day' + interval '11 hours 52 minutes 8 seconds') at time zone 'Asia/Seoul',
    p_user_id,
    (v_today - interval '1 day' + interval '13 hours 20 minutes 31 seconds') at time zone 'Asia/Seoul',
    64, v_price, 64 * v_price,
    (v_today - interval '1 day' + interval '11 hours 52 minutes 8 seconds') at time zone 'Asia/Seoul'
  );

  -- 예약: 합정점 일반 문자 75명. 승인을 거치지 않은 예약이라 지점이 취소할 수 있다.
  v_order_id := 'trial-' || gen_random_uuid();
  insert into public.payments (org_id, branch_id, order_id, payment_key, amount, status, approved_at)
  values (v_org_id, v_hapjeong, v_order_id, v_order_id, 75 * v_price, 'done', now())
  returning id into v_payment_id;
  insert into public.ledger_entries (org_id, branch_id, kind, amount, payment_id, idempotency_key)
  values (v_org_id, v_hapjeong, 'charge', 75 * v_price, v_payment_id, 'charge:' || v_order_id);

  insert into public.campaigns (
    org_id, branch_id, body, kind, is_ad, sender_phone, status, scheduled_at,
    recipient_count, unit_price, estimated_cost, created_at
  )
  values (
    v_org_id, v_hapjeong, '[정기 점검 안내] 내일 오전 영업이 1시간 늦은 11시에 시작해요',
    'sms', false, '01000000004', 'scheduled', v_tomorrow_10,
    75, v_price, 75 * v_price, now() - interval '9 minutes 18 seconds'
  )
  returning id into v_campaign_id;

  insert into public.messages (campaign_id, org_id, phone, recipient_name, next_attempt_at)
  select v_campaign_id, v_org_id, '01000' || lpad((3000 + n)::text, 6, '0'), '고객' || (3000 + n),
    v_tomorrow_10
  from generate_series(1, 75) as n;

  perform public.reserve_balance(
    v_org_id, v_hapjeong, v_campaign_id, 75 * v_price, 'reserve:' || v_campaign_id
  );

  return v_org_id;
end;
$$;

revoke execute on function public.create_trial_org_before_events(uuid) from public, anon, authenticated;
