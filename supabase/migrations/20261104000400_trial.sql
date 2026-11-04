-- 체험 계정. 익명 로그인 뒤 서버가 부르는 함수들이며 사용자가 직접 부를 수 없다.

-- 사용자마다 자기 샘플 본사를 준다. 하나를 공유하면 한 사람의 업로드·역할 전환이 다른 사람 화면을 바꾼다.
create function public.create_trial_org(p_user_id uuid)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_org_id uuid;
  v_branch record;
  v_account record;
  v_payment_id uuid;
  v_order_id text;
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

  -- 시안의 데모 잔액. 잔액 열이 없으므로 충전 결제와 거래 기록으로 만든다.
  -- 숫자를 직접 넣는 지름길을 두면 체험 데이터만 "거래 기록의 합계" 원칙을 어기게 된다.
  create temporary table trial_accounts (branch_id uuid, phone text, label text, amount integer)
    on commit drop;

  -- 샘플 번호는 실제 번호가 아닌 형식만 쓴다(기획서 운영·안전 정책).
  insert into trial_accounts values (null, '01000000001', '본사 대표', 8500000);

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
    select id, v_branch.phone, v_branch.name || ' 대표', v_branch.amount from created;
  end loop;

  for v_account in select * from trial_accounts loop
    insert into public.sender_numbers (org_id, branch_id, number, label, is_default)
    values (v_org_id, v_account.branch_id, v_account.phone, v_account.label, true);

    v_order_id := 'trial-' || gen_random_uuid();
    insert into public.payments (org_id, branch_id, order_id, payment_key, amount, status, approved_at)
    values (v_org_id, v_account.branch_id, v_order_id, v_order_id, v_account.amount, 'done', now())
    returning id into v_payment_id;

    insert into public.ledger_entries (org_id, branch_id, kind, amount, payment_id, idempotency_key)
    values (v_org_id, v_account.branch_id, 'charge', v_account.amount, v_payment_id, 'charge:' || v_order_id);
  end loop;

  return v_org_id;
end;
$$;

-- 화면만 바꾸지 않고 members를 바꾼다. 그래야 RLS까지 함께 바뀌어 전환이 진짜가 된다.
-- 체험 여부를 호출부가 아니라 여기서 확인해, 서버 코드에 실수가 있어도 실제 본사의 역할은 바뀌지 않는다.
create function public.switch_trial_role(p_user_id uuid, p_branch_id uuid)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_org_id uuid;
begin
  select m.org_id into v_org_id
  from public.members m
  join public.organizations o on o.id = m.org_id
  where m.user_id = p_user_id and o.trial_expires_at is not null;

  if not found then
    raise exception 'not_trial_member' using errcode = 'DH005';
  end if;

  -- 복합 외래 키도 막지만 커밋 때 터지는 일반 오류라, 호출부가 구분할 수 있게 먼저 확인한다.
  if p_branch_id is not null and not exists (
    select 1 from public.branches where id = p_branch_id and org_id = v_org_id
  ) then
    raise exception 'branch_not_in_org' using errcode = 'DH006';
  end if;

  update public.members
  set role = case when p_branch_id is null then 'hq' else 'branch' end::public.member_role,
      branch_id = p_branch_id
  where user_id = p_user_id;
end;
$$;

-- auth.users를 지워야 해서 SECURITY DEFINER다. 호출자 인자가 없어 다른 데이터를 지울 수 없다.
create function public.delete_expired_trials()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  delete from auth.users u
  using public.members m, public.organizations o
  where m.user_id = u.id
    and o.id = m.org_id
    and o.trial_expires_at < now();

  -- 사용자보다 나중에 지운다. members가 사라져도 본사 만료 시각으로 찾을 수 있다.
  delete from public.organizations where trial_expires_at < now();
  get diagnostics v_count = row_count;

  -- 본사 생성에 실패한 익명 사용자는 위 조건에 걸리지 않으므로 따로 지운다.
  delete from auth.users u
  where u.is_anonymous
    and u.created_at < now() - interval '3 days'
    and not exists (select 1 from public.members m where m.user_id = u.id);

  return v_count;
end;
$$;

revoke execute on function public.create_trial_org(uuid) from public, anon, authenticated;
revoke execute on function public.switch_trial_role(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.delete_expired_trials() from public, anon, authenticated;
grant execute on function public.create_trial_org(uuid) to service_role;
grant execute on function public.switch_trial_role(uuid, uuid) to service_role;
grant execute on function public.delete_expired_trials() to service_role;

-- 만료 시각이 지난 뒤 최대 1시간 안에 지워진다. 체험 데이터 삭제에 그보다 정밀할 이유가 없다.
create extension if not exists pg_cron with schema pg_catalog;
select cron.schedule('delete-expired-trials', '0 * * * *', 'select public.delete_expired_trials()');
