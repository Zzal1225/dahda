-- 실제 발송을 시험할 본사 계정을 만든다. 운영 SQL Editor에서 한 번만 직접 실행한다(자동으로 돌지 않는다).
--
-- 준비: Supabase 대시보드 Authentication에서 이메일 사용자를 먼저 만든다.
-- 아래 세 값만 바꾼다. 번호는 숫자만 쓰고, 발신번호는 솔라피에 등록된 번호여야 한다.
--
-- 잔액은 원래 결제로만 생긴다. 토스 충전이 없어 시험용 결제 기록을 함께 만든다. payment_key로 구분할 수 있다.
-- 체험이 아닌 본사라 SMS_PROVIDER=solapi면 실제 문자가 나간다. 허용 번호와 하루 상한은 그대로 적용된다.
do $$
declare
  v_email text := '여기에_이메일';
  v_sender text := '01000000000';
  v_amount integer := 1000;
  v_user uuid;
  v_org uuid;
  v_payment uuid;
begin
  select id into v_user from auth.users where email = v_email;
  if v_user is null then
    raise exception '% 사용자가 없다. Authentication에서 먼저 만든다', v_email;
  end if;
  if exists (select 1 from public.members where user_id = v_user) then
    raise exception '이미 소속이 있는 사용자다. 두 번 실행하지 않는다';
  end if;

  insert into public.organizations (name) values ('dahda 실제 발송 시험')
  returning id into v_org;

  insert into public.members (user_id, org_id, role, display_name)
  values (v_user, v_org, 'hq', '본사 관리자');

  insert into public.sender_numbers (org_id, number, label, is_default)
  values (v_org, v_sender, '내 번호', true);

  insert into public.payments (org_id, requested_by, order_id, payment_key, amount, status, approved_at)
  values (v_org, v_user, 'manual-' || v_org, 'manual-test-' || v_org, v_amount, 'done', now())
  returning id into v_payment;

  insert into public.ledger_entries (org_id, kind, amount, payment_id, idempotency_key)
  values (v_org, 'charge', v_amount, v_payment, 'charge:manual-' || v_org);
end;
$$;
