-- 체험 본사에 주소록 샘플을 넣는다. 주소록 화면이 생겨 빈 화면으로 시작하면 체험의 의미가 없다.
-- 긴 함수를 또 복사하면 어긋나기 쉬워, 기존 함수를 그대로 두고 샘플만 더하는 함수로 감쌌다.

alter function public.create_trial_org(uuid) rename to create_trial_org_base;
revoke execute on function public.create_trial_org_base(uuid) from public, anon, authenticated;

create function public.create_trial_org(p_user_id uuid)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_org_id uuid;
  v_branch record;
  v_regular_id uuid;
  v_new_id uuid;
begin
  v_org_id := public.create_trial_org_base(p_user_id);

  -- 두 번 불러도 샘플이 겹치지 않게 한다. 번호가 유일해서 겹치면 오류가 난다.
  if exists (select 1 from public.contacts where org_id = v_org_id) then
    return v_org_id;
  end if;

  for v_branch in
    select id from public.branches where org_id = v_org_id
  loop
    insert into public.contact_groups (org_id, branch_id, name)
    values (v_org_id, v_branch.id, '단골 손님')
    returning id into v_regular_id;
    insert into public.contact_groups (org_id, branch_id, name)
    values (v_org_id, v_branch.id, '신규 손님')
    returning id into v_new_id;

    -- 샘플 번호는 실제 번호가 아닌 형식만 쓴다(기획서 운영·안전 정책).
    with created as (
      insert into public.contacts (org_id, branch_id, phone, name, memo)
      select
        v_org_id,
        v_branch.id,
        '01000' || lpad(n::text, 6, '0'),
        '고객' || n,
        case when n % 10 = 0 then '주말 배송 선호' end
      from generate_series(1, 60) as n
      returning id, phone
    )
    insert into public.contact_group_members (group_id, contact_id, org_id, branch_id)
    select
      case when right(phone, 2)::integer % 2 = 0 then v_regular_id else v_new_id end,
      id,
      v_org_id,
      v_branch.id
    from created;
  end loop;

  -- 수신거부는 본사 공통이라 지점과 무관하게 한 번만 넣는다.
  insert into public.opt_outs (org_id, phone, reason, source, created_by)
  values
    (v_org_id, '01000000007', '문자 수신 원치 않음', 'manual', p_user_id),
    (v_org_id, '01000000013', '전화로 수신 거부 요청', 'manual', p_user_id);

  return v_org_id;
end;
$$;

revoke execute on function public.create_trial_org(uuid) from public, anon, authenticated;
grant execute on function public.create_trial_org(uuid) to service_role;
