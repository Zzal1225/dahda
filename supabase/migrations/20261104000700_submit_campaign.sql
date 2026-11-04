-- 문자 접수. 발송 건·메시지·잔액 선점이 한 트랜잭션이어야 한다.
-- 따로 처리하면 메시지 없는 발송 건이나, 차감 없이 나가는 메시지가 남을 수 있다.

-- 발송 버튼을 두 번 눌러도 한 건만 만들기 위한 키. 화면을 열 때 만들어 재시도에도 같은 값을 쓴다.
alter table public.campaigns add column client_request_id uuid unique;

create function public.submit_campaign(
  p_client_request_id uuid,
  p_org_id uuid,
  p_branch_id uuid, -- null = 본사 발송
  p_created_by uuid,
  p_body text,
  p_kind public.campaign_kind,
  p_is_ad boolean,
  p_sender_phone public.phone_digits,
  p_status public.campaign_status,
  p_scheduled_at timestamptz,
  p_unit_price integer,
  p_recipients jsonb -- [{ "phone": "...", "name": "..." }]
)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_campaign_id uuid;
  v_count integer := jsonb_array_length(p_recipients);
begin
  -- 어떤 전이가 맞는지는 status.ts가 정한다. 접수로 만들 수 있는 상태만 여기서 다시 막는다.
  if p_status not in ('scheduled', 'pending_approval') then
    raise exception 'invalid_status' using errcode = 'DH007';
  end if;
  if v_count = 0 then
    raise exception 'no_recipients' using errcode = 'DH008';
  end if;

  insert into public.campaigns (
    client_request_id, org_id, branch_id, created_by, body, kind, is_ad, sender_phone, status,
    scheduled_at, requested_at, recipient_count, unit_price, estimated_cost
  )
  values (
    p_client_request_id, p_org_id, p_branch_id, p_created_by, p_body, p_kind, p_is_ad, p_sender_phone, p_status,
    p_scheduled_at,
    case when p_status = 'pending_approval' then now() end,
    v_count, p_unit_price, v_count * p_unit_price
  )
  on conflict (client_request_id) do nothing
  returning id into v_campaign_id;

  -- 이미 처리한 요청이다. 다시 차감하거나 메시지를 또 만들지 않는다.
  if v_campaign_id is null then
    select id into v_campaign_id
    from public.campaigns
    where client_request_id = p_client_request_id and org_id = p_org_id;
    return v_campaign_id;
  end if;

  -- 번호·이름은 이 시점의 값으로 복사한다. 주소록을 고쳐도 이 발송은 바뀌지 않는다.
  -- 승인 전 광고도 수신자를 미리 만든다. 워커는 발송 건 상태까지 확인해야 하며, 승인 전 건을 보내면 안 된다.
  insert into public.messages (campaign_id, org_id, phone, recipient_name, next_attempt_at)
  select
    v_campaign_id,
    p_org_id,
    recipient ->> 'phone',
    recipient ->> 'name',
    coalesce(p_scheduled_at, now())
  from jsonb_array_elements(p_recipients) as recipient;

  -- 승인 전 광고는 차감하지 않는다. 승인할 때 선점한다(시안 안내와 같다).
  if p_status = 'scheduled' then
    perform public.reserve_balance(
      p_org_id, p_branch_id, v_campaign_id, v_count * p_unit_price, 'reserve:' || v_campaign_id
    );
  end if;

  return v_campaign_id;
end;
$$;

revoke execute on function public.submit_campaign(uuid, uuid, uuid, uuid, text, public.campaign_kind, boolean, public.phone_digits, public.campaign_status, timestamptz, integer, jsonb)
  from public, anon, authenticated;
grant execute on function public.submit_campaign(uuid, uuid, uuid, uuid, text, public.campaign_kind, boolean, public.phone_digits, public.campaign_status, timestamptz, integer, jsonb)
  to service_role;

-- 체험 샘플의 광고 문구를 실제 규칙대로 고친다. 규칙을 보여 주는 데이터가 규칙을 어기면 안 된다.
-- 문구를 짧게 두어 고정 문구를 합쳐도 SMS(90byte 이하)라 이미 계산한 단가와 잔액이 그대로다.
alter function public.create_trial_org(uuid) rename to create_trial_org_with_contacts;
revoke execute on function public.create_trial_org_with_contacts(uuid) from public, anon, authenticated;

create function public.create_trial_org(p_user_id uuid)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_org_id uuid;
  v_existed boolean;
begin
  v_existed := exists (select 1 from public.members where user_id = p_user_id);
  v_org_id := public.create_trial_org_with_contacts(p_user_id);

  -- 이미 있던 본사는 사용자가 쓰던 데이터이므로 건드리지 않는다.
  if v_existed then
    return v_org_id;
  end if;

  update public.campaigns c
  set body =
    '(광고)dahda마트' ||
    coalesce(' ' || (select b.name from public.branches b where b.id = c.branch_id), '') || ' ' ||
    regexp_replace(c.sender_phone::text, '^(\d{3})(\d{4})(\d{4})$', '\1-\2-\3') ||
    E'\n이번 주 특가 안내\n무료거부 080-000-0000'
  where c.org_id = v_org_id and c.is_ad;

  return v_org_id;
end;
$$;

revoke execute on function public.create_trial_org(uuid) from public, anon, authenticated;
grant execute on function public.create_trial_org(uuid) to service_role;
