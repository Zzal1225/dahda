-- 잔액 선점. 잔액 검사와 reserve 기록을 한 트랜잭션에서 처리한다.
-- 서버에서 검사한 뒤 따로 기록하면, 두 요청이 같은 잔액을 동시에 보고 모두 통과해 잔액이 음수가 된다.

create function public.reserve_balance(
  p_org_id uuid,
  p_branch_id uuid, -- null = 본사 계정
  p_campaign_id uuid,
  p_amount integer,
  p_idempotency_key text
)
returns bigint -- 처리 후 잔액
language plpgsql
set search_path = ''
as $$
declare
  v_existing public.ledger_entries%rowtype;
  v_balance bigint;
begin
  if p_amount is null or p_amount <= 0 then
    raise exception 'invalid_amount' using errcode = 'DH001';
  end if;

  -- 발송 건이 이 계정의 것인지 확인한다. 외래 키는 본사까지만 보므로 "내 발송 건을 옆 지점 잔액으로" 결제하는
  -- 잘못된 호출을 막지 못한다.
  if not exists (
    select 1 from public.campaigns c
    where c.id = p_campaign_id
      and c.org_id = p_org_id
      and c.branch_id is not distinct from p_branch_id
  ) then
    raise exception 'campaign_account_mismatch' using errcode = 'DH002';
  end if;

  -- 계정 단위로 줄을 세운다. 잠글 "잔액 행"이 없어 행 잠금 대신 advisory lock을 쓴다.
  -- SERIALIZABLE과 달리 재시도 코드가 필요 없고, 다른 계정의 발송은 기다리지 않는다.
  -- 지점 id와 본사 id는 서로 다른 uuid이므로 둘 중 하나로 계정을 구분할 수 있다. 해시 충돌은 잠깐 기다리는 것뿐이다.
  perform pg_advisory_xact_lock(hashtextextended(coalesce(p_branch_id, p_org_id)::text, 0));

  -- 멱등 확인을 잠금 뒤에 둔다. 앞에 두면 같은 키의 동시 요청 둘이 모두 "없음"을 보고 진행한다.
  select * into v_existing
  from public.ledger_entries
  where idempotency_key = p_idempotency_key;

  if found and (
    v_existing.campaign_id is distinct from p_campaign_id
    or v_existing.amount <> -p_amount
  ) then
    -- 키가 같은데 내용이 다르면 호출 코드의 버그다. 조용히 성공시키면 금액 오류가 숨는다.
    raise exception 'idempotency_conflict' using errcode = 'DH003';
  end if;

  select coalesce(sum(amount), 0)::bigint into v_balance
  from public.ledger_entries
  where org_id = p_org_id
    and branch_id is not distinct from p_branch_id;

  if v_existing.id is not null then
    return v_balance; -- 이미 처리한 요청. 다시 차감하지 않는다.
  end if;

  if v_balance < p_amount then
    raise exception 'insufficient_balance' using errcode = 'DH004';
  end if;

  insert into public.ledger_entries (org_id, branch_id, kind, amount, campaign_id, idempotency_key)
  values (p_org_id, p_branch_id, 'reserve', -p_amount, p_campaign_id, p_idempotency_key);

  return v_balance - p_amount;
end;
$$;

-- 사용자가 직접 부르면 다른 지점 id를 넘길 수 있다. requireRole을 거친 서버만 호출한다.
revoke execute on function public.reserve_balance(uuid, uuid, uuid, integer, text)
  from public, anon, authenticated;
grant execute on function public.reserve_balance(uuid, uuid, uuid, integer, text) to service_role;
