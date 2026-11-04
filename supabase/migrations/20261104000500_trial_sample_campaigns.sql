-- 체험 본사에 발송 내역 샘플을 넣는다. 발송 내역 화면이 생겨 빈 화면으로 시작하면 체험의 의미가 없다.
-- 잔액을 시안의 데모 값으로 유지하려고, 차감할 금액만큼 충전을 더 한 뒤 실제와 같게 선점·환불을 기록한다.

create or replace function public.create_trial_org(p_user_id uuid)
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
  v_sample record;
  v_campaign_id uuid;
  v_recipients constant integer := 120;
  v_failed integer;
  v_spent integer;
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

  for v_account in select * from trial_accounts loop
    insert into public.sender_numbers (org_id, branch_id, number, label, is_default)
    values (v_org_id, v_account.branch_id, v_account.phone, v_account.label, true);

    -- 계정마다 완료 1건(실패분 환불 포함), 확인 중 1건을 차감한다. 그만큼 더 충전해 최종 잔액을 데모 값으로 맞춘다.
    v_failed := v_recipients * 7 / 100;
    v_spent := v_recipients * 20 * 2 - v_failed * 20;
    v_order_id := 'trial-' || gen_random_uuid();
    insert into public.payments (org_id, branch_id, order_id, payment_key, amount, status, approved_at)
    values (v_org_id, v_account.branch_id, v_order_id, v_order_id, v_account.amount + v_spent, 'done', now())
    returning id into v_payment_id;

    insert into public.ledger_entries (org_id, branch_id, kind, amount, payment_id, idempotency_key)
    values (v_org_id, v_account.branch_id, 'charge', v_account.amount + v_spent, v_payment_id, 'charge:' || v_order_id);

    for v_sample in
      select * from (values
        ('completed'::public.campaign_status, v_account.name || ' 이번 주 특가 안내드립니다. 신선 코너 전 품목 할인', true, interval '2 days'),
        ('sending'::public.campaign_status, v_account.name || ' 배송 일정 변경을 알려 드립니다', false, interval '10 minutes')
      ) as t(status, body, is_ad, ago)
    loop
      -- 실패 7%, 확인 중은 진행 중인 건에만 8%. 측정 시드와 같은 비율이다.
      insert into public.campaigns (
        org_id, branch_id, body, kind, is_ad, sender_phone, status,
        recipient_count, unit_price, estimated_cost,
        sent_count, delivered_count, failed_count,
        started_at, completed_at, created_at
      )
      values (
        v_org_id, v_account.branch_id, v_sample.body, 'sms', v_sample.is_ad, v_account.phone, v_sample.status,
        v_recipients, 20, v_recipients * 20,
        v_recipients,
        case when v_sample.status = 'completed' then v_recipients - v_failed
             else v_recipients - v_failed - v_recipients * 8 / 100 end,
        v_failed,
        now() - v_sample.ago,
        case when v_sample.status = 'completed' then now() - v_sample.ago + interval '5 minutes' end,
        now() - v_sample.ago
      )
      returning id into v_campaign_id;

      insert into public.messages (
        campaign_id, org_id, phone, recipient_name, status, provider, provider_message_id,
        fail_code, attempt_count, sent_at, finalized_at
      )
      select
        v_campaign_id,
        v_org_id,
        '01000' || lpad(n::text, 6, '0'),
        '고객' || n,
        s.status,
        'fake',
        'trial-' || v_campaign_id || '-' || n,
        case when s.status = 'failed' then (array['E301','E302','E410','E503','E201'])[n % 5 + 1] end,
        1,
        now() - v_sample.ago + (n || ' seconds')::interval,
        case when s.status <> 'sent' then now() - v_sample.ago + ((n + 3) || ' seconds')::interval end
      from generate_series(1, v_recipients) as n
      cross join lateral (
        select case
          when n <= v_failed then 'failed'
          when v_sample.status = 'sending' and n <= v_failed + v_recipients * 8 / 100 then 'sent'
          else 'delivered'
        end::public.message_status as status
      ) as s;

      insert into public.ledger_entries (org_id, branch_id, kind, amount, campaign_id, idempotency_key)
      values (v_org_id, v_account.branch_id, 'reserve', -(v_recipients * 20), v_campaign_id, 'reserve:' || v_campaign_id);

      -- 실패분 환불은 완료 때 한 번 기록한다. 확인 중인 건은 아직 확정되지 않았다.
      if v_sample.status = 'completed' then
        insert into public.ledger_entries (org_id, branch_id, kind, amount, campaign_id, idempotency_key)
        values (v_org_id, v_account.branch_id, 'release', v_failed * 20, v_campaign_id, 'release:' || v_campaign_id);
      end if;
    end loop;
  end loop;

  return v_org_id;
end;
$$;

revoke execute on function public.create_trial_org(uuid) from public, anon, authenticated;
grant execute on function public.create_trial_org(uuid) to service_role;
