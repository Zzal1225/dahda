-- 화면은 발송 건 행만 구독한다. 메시지 10만 행을 구독하지 않으려고 집계를 발송 건에 모아 둔 것이다.
-- 구독자마다 RLS를 확인하므로, 사용자는 볼 수 있는 행의 변경만 받는다.
alter publication supabase_realtime add table public.campaigns;

-- 실패 건 재발송. 원본 행은 바꾸지 않고 새 발송 건으로 잇는다(결정 기록: 기획·디자인 충돌 정리).
-- 미리보기와 실행이 같은 대상을 보도록 조건을 여기 한 곳에 둔다.
create function private.retry_targets(p_source_id uuid, p_org_id uuid, p_message_ids bigint[])
returns table (phone text, recipient_name text, fail_code text)
language sql
stable
security definer
set search_path = ''
as $$
  select m.phone::text, m.recipient_name, m.fail_code
  from public.messages m
  where m.campaign_id = p_source_id
    and m.org_id = p_org_id
    and m.status = 'failed'
    and m.id = any (p_message_ids)
    -- 원본을 보낸 뒤 수신거부한 사람에게 다시 보내면 안 된다.
    and not exists (
      select 1 from public.opt_outs o
      where o.org_id = p_org_id and o.phone = m.phone
    )
    -- 버튼을 두 번 누르거나 다른 담당자가 먼저 보낸 경우 두 번 보내고 두 번 차감하지 않는다.
    -- 재발송이 반려·취소됐다면 나가지 않은 것이므로 다시 보낼 수 있다.
    and not exists (
      select 1
      from public.campaigns rc
      join public.messages r on r.campaign_id = rc.id
      where rc.retry_of_campaign_id = p_source_id
        and rc.status not in ('rejected', 'canceled')
        and r.phone = m.phone
    );
$$;

revoke execute on function private.retry_targets(uuid, uuid, bigint[]) from public, anon, authenticated;
grant usage on schema private to service_role;
grant execute on function private.retry_targets(uuid, uuid, bigint[]) to service_role;

create function public.preview_retry(
  p_source_id uuid,
  p_org_id uuid,
  p_message_ids bigint[],
  p_hopeless_codes text[]
)
returns table (
  failed_count integer,
  target_count integer,
  hopeless_count integer,
  unit_price integer,
  kind public.campaign_kind,
  balance bigint
)
language sql
stable
set search_path = ''
as $$
  select
    (select count(*)::integer from public.messages m
      where m.campaign_id = c.id and m.status = 'failed' and m.id = any (p_message_ids)),
    t.total,
    t.hopeless,
    c.unit_price,
    c.kind,
    -- 재발송 비용은 원본 계정에서 나간다. 본사가 지점 건을 다시 보내도 지점 잔액이다.
    (select coalesce(sum(l.amount), 0)::bigint from public.ledger_entries l
      where l.org_id = c.org_id and l.branch_id is not distinct from c.branch_id)
  from public.campaigns c
  cross join lateral (
    select count(*)::integer as total,
           count(*) filter (where r.fail_code = any (p_hopeless_codes))::integer as hopeless
    from private.retry_targets(c.id, p_org_id, p_message_ids) r
  ) t
  where c.id = p_source_id and c.org_id = p_org_id;
$$;

create function public.retry_failed_messages(
  p_source_id uuid,
  p_org_id uuid,
  p_created_by uuid,
  p_message_ids bigint[]
)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_source public.campaigns%rowtype;
  v_campaign_id uuid;
  v_count integer;
begin
  -- 원본을 잠가 재발송을 줄 세운다. 동시 요청 둘이 같은 대상을 함께 보는 일을 막는다.
  select * into v_source
  from public.campaigns
  where id = p_source_id and org_id = p_org_id
  for update;

  if not found or v_source.status not in ('sending', 'completed') then
    raise exception 'not_retryable' using errcode = 'DH013';
  end if;

  select count(*)::integer into v_count
  from private.retry_targets(p_source_id, p_org_id, p_message_ids);
  if v_count = 0 then
    raise exception 'no_recipients' using errcode = 'DH008';
  end if;

  -- 같은 내용을 다시 보내는 것이라 승인을 다시 받지 않는다. 승인 기록을 이어받아 승인 건의 취소 금지도 유지된다.
  insert into public.campaigns (
    org_id, branch_id, created_by, body, kind, is_ad, sender_phone, status,
    reviewed_by, reviewed_at, recipient_count, unit_price, estimated_cost, retry_of_campaign_id
  )
  values (
    p_org_id, v_source.branch_id, p_created_by, v_source.body, v_source.kind, v_source.is_ad,
    v_source.sender_phone, 'scheduled', v_source.reviewed_by, v_source.reviewed_at,
    v_count, v_source.unit_price, v_count * v_source.unit_price, p_source_id
  )
  returning id into v_campaign_id;

  insert into public.messages (campaign_id, org_id, phone, recipient_name, next_attempt_at)
  select v_campaign_id, p_org_id, t.phone, t.recipient_name, now()
  from private.retry_targets(p_source_id, p_org_id, p_message_ids) t;

  perform public.reserve_balance(
    p_org_id, v_source.branch_id, v_campaign_id, v_count * v_source.unit_price, 'reserve:' || v_campaign_id
  );
  return v_campaign_id;
end;
$$;

revoke execute on function public.preview_retry(uuid, uuid, bigint[], text[]) from public, anon, authenticated;
revoke execute on function public.retry_failed_messages(uuid, uuid, uuid, bigint[]) from public, anon, authenticated;
grant execute on function public.preview_retry(uuid, uuid, bigint[], text[]) to service_role;
grant execute on function public.retry_failed_messages(uuid, uuid, uuid, bigint[]) to service_role;
