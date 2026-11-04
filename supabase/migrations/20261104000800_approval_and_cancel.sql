-- 승인·반려·예약 취소. 상태와 돈이 함께 바뀌므로 한 트랜잭션에서 처리한다.
-- 행을 잠그고 상태를 다시 확인한다. 본사 담당자 둘이 동시에 승인하거나, 승인과 반려가 겹쳐도 한쪽만 성공한다.
-- 어떤 전이가 맞는지의 판단은 status.ts에 있고, 여기서는 동시 요청에 대비해 다시 확인만 한다.

create function public.approve_campaign(
  p_campaign_id uuid,
  p_org_id uuid,
  p_reviewer uuid
)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_campaign public.campaigns%rowtype;
begin
  select * into v_campaign
  from public.campaigns
  where id = p_campaign_id and org_id = p_org_id
  for update;

  if not found or v_campaign.status <> 'pending_approval' then
    raise exception 'not_pending' using errcode = 'DH009';
  end if;

  -- 차감은 지점 잔액에서 한다. 부족하면 예외로 전체가 되돌아가 승인 대기로 남는다.
  perform public.reserve_balance(
    p_org_id,
    v_campaign.branch_id,
    p_campaign_id,
    v_campaign.estimated_cost,
    'reserve:' || p_campaign_id
  );

  update public.campaigns
  set status = 'scheduled', reviewed_by = p_reviewer, reviewed_at = now()
  where id = p_campaign_id;
end;
$$;

create function public.reject_campaign(
  p_campaign_id uuid,
  p_org_id uuid,
  p_reviewer uuid,
  p_reason text
)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_status public.campaign_status;
begin
  select status into v_status
  from public.campaigns
  where id = p_campaign_id and org_id = p_org_id
  for update;

  if not found or v_status <> 'pending_approval' then
    raise exception 'not_pending' using errcode = 'DH009';
  end if;

  -- 보낼 일이 없는 메시지를 지운다. 남겨 두면 워커가 집어 갈 위험만 남는다.
  delete from public.messages where campaign_id = p_campaign_id;

  update public.campaigns
  set status = 'rejected', rejected_reason = p_reason, reviewed_by = p_reviewer, reviewed_at = now()
  where id = p_campaign_id;
end;
$$;

-- 예약 취소. 승인된 건은 시안 안내대로 취소할 수 없다. 계정 주인만 취소한다.
create function public.cancel_campaign(
  p_campaign_id uuid,
  p_org_id uuid,
  p_branch_id uuid -- null = 본사 계정
)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_campaign public.campaigns%rowtype;
begin
  select * into v_campaign
  from public.campaigns
  where id = p_campaign_id
    and org_id = p_org_id
    and branch_id is not distinct from p_branch_id
  for update;

  if not found or v_campaign.status <> 'scheduled' then
    raise exception 'not_cancelable' using errcode = 'DH010';
  end if;
  if v_campaign.reviewed_at is not null then
    raise exception 'approved' using errcode = 'DH011';
  end if;
  -- 예약 시각이 지났거나 "지금 보내기"면 이미 나가는 중일 수 있다.
  if v_campaign.scheduled_at is null or v_campaign.scheduled_at <= now() then
    raise exception 'too_late' using errcode = 'DH012';
  end if;

  delete from public.messages where campaign_id = p_campaign_id;

  insert into public.ledger_entries (org_id, branch_id, kind, amount, campaign_id, idempotency_key)
  values (p_org_id, p_branch_id, 'refund', v_campaign.estimated_cost, p_campaign_id, 'refund:' || p_campaign_id);

  update public.campaigns set status = 'canceled' where id = p_campaign_id;
end;
$$;

revoke execute on function public.approve_campaign(uuid, uuid, uuid) from public, anon, authenticated;
revoke execute on function public.reject_campaign(uuid, uuid, uuid, text) from public, anon, authenticated;
revoke execute on function public.cancel_campaign(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.approve_campaign(uuid, uuid, uuid) to service_role;
grant execute on function public.reject_campaign(uuid, uuid, uuid, text) to service_role;
grant execute on function public.cancel_campaign(uuid, uuid, uuid) to service_role;
