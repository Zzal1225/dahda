-- 토스 승인 결과를 결제 상태와 거래 기록에 한 트랜잭션으로 남긴다.
-- 따로 쓰면 그 사이 실패할 때 "돈은 나갔는데 잔액은 그대로"가 된다.
-- 승인 API 호출은 이 함수 밖에서 한다. 외부 호출 동안 행을 잠그면 토스가 느릴 때 잠금이 길어진다.
create function public.confirm_payment(
  p_order_id text,
  p_payment_key text,
  p_amount integer,
  p_approved_at timestamptz
)
returns text -- charged | already_done
language plpgsql
set search_path = ''
as $$
declare
  v_payment public.payments%rowtype;
begin
  -- 리다이렉트와 웹훅이 동시에 와도 한쪽만 기록하게 줄을 세운다.
  select * into v_payment from public.payments where order_id = p_order_id for update;
  if not found then
    raise exception 'payment_not_found' using errcode = 'DH018';
  end if;
  if v_payment.amount <> p_amount then
    raise exception 'payment_amount_mismatch' using errcode = 'DH019';
  end if;
  if v_payment.status = 'done' then
    if v_payment.payment_key <> p_payment_key then
      raise exception 'payment_key_mismatch' using errcode = 'DH020';
    end if;
    return 'already_done';
  end if;
  -- failed는 다시 done이 될 수 있다. 토스가 승인했다면 돈이 실제로 나간 것이고, 막으면 충전이 사라진다.
  -- canceled만 최종 상태다.
  if v_payment.status = 'canceled' then
    raise exception 'payment_canceled' using errcode = 'DH021';
  end if;

  update public.payments
  set status = 'done', payment_key = p_payment_key, approved_at = p_approved_at
  where id = v_payment.id;

  insert into public.ledger_entries (org_id, branch_id, kind, amount, payment_id, idempotency_key)
  values (v_payment.org_id, v_payment.branch_id, 'charge', v_payment.amount, v_payment.id,
          'charge:' || p_order_id);
  return 'charged';
end;
$$;

revoke execute on function public.confirm_payment(text, text, integer, timestamptz)
  from public, anon, authenticated;
grant execute on function public.confirm_payment(text, text, integer, timestamptz) to service_role;
