-- 결과 집계와 발송 완료 정산.

-- 진행률 집계. 화면이 메시지 10만 행을 구독하지 않고 발송 건 행 하나만 구독하게 하려는 값이다.
-- 문장 단위 트리거인 이유: 워커는 한 문장으로 100건을 바꾼다. 행 단위면 같은 발송 건 행을 100번 고쳐 죽은 행만 늘어난다.
create function public.messages_update_campaign_counts()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- 여러 발송 건을 고치는 문장 둘이 서로 다른 순서로 잠그면 교착이 생긴다. 순서를 고정한다.
  perform 1
  from public.campaigns c
  where c.id in (select n.campaign_id from new_rows n)
  order by c.id
  for update;

  with delta as (
    select
      n.campaign_id,
      -- 업체가 받은 건만 센다. 보내기 전 실패는 접수가 아니고, 웹훅이 먼저 와 queued에서 확정된 건은 접수된 것이다.
      count(*) filter (where o.status = 'queued' and n.status <> 'queued' and n.provider_message_id is not null) as sent,
      count(*) filter (where o.status <> 'delivered' and n.status = 'delivered') as delivered,
      count(*) filter (where o.status <> 'failed' and n.status = 'failed') as failed
    from old_rows o
    join new_rows n on n.id = o.id
    group by n.campaign_id
  )
  update public.campaigns c
  set sent_count = c.sent_count + d.sent,
      delivered_count = c.delivered_count + d.delivered,
      failed_count = c.failed_count + d.failed
  from delta d
  where c.id = d.campaign_id
    and d.sent + d.delivered + d.failed > 0;

  return null;
end;
$$;

create trigger messages_update_campaign_counts
  after update on public.messages
  referencing old table as old_rows new table as new_rows
  for each statement execute function public.messages_update_campaign_counts();

-- 완료 처리. 판단은 status.ts가 하고, 여기서는 상태와 돈을 한 트랜잭션에 묶으며 동시 요청에 대비해 다시 확인한다.
-- 실패분만 돌려준다. 접수 때 전체를 선점했으므로, 도착한 건은 그대로 비용이 된다.
create function public.complete_campaign(p_campaign_id uuid)
returns boolean -- 이번 호출이 완료시켰는지
language plpgsql
set search_path = ''
as $$
declare
  v_campaign public.campaigns%rowtype;
  v_release integer;
begin
  select * into v_campaign
  from public.campaigns
  where id = p_campaign_id
  for update;

  if not found
    or v_campaign.status <> 'sending'
    or v_campaign.delivered_count + v_campaign.failed_count <> v_campaign.recipient_count then
    return false;
  end if;

  v_release := v_campaign.failed_count * v_campaign.unit_price;
  if v_release > 0 then
    insert into public.ledger_entries (org_id, branch_id, kind, amount, campaign_id, idempotency_key)
    values (v_campaign.org_id, v_campaign.branch_id, 'release', v_release, p_campaign_id, 'release:' || p_campaign_id);
  end if;

  update public.campaigns
  set status = 'completed', completed_at = now()
  where id = p_campaign_id;
  return true;
end;
$$;

revoke execute on function public.complete_campaign(uuid) from public, anon, authenticated;
grant execute on function public.complete_campaign(uuid) to service_role;

create index campaigns_sending_idx on public.campaigns (updated_at) where status = 'sending';

-- 웹훅이 상태는 저장했는데 완료 처리 전에 끊기면 발송 건이 영영 "확인 중"이고 실패분도 돌아오지 않는다. 그 틈을 메운다.
-- 정상 경로와 겹치지 않게 1분 지난 건만 본다. 겹쳐도 complete_campaign이 한 번만 처리한다.
create function private.complete_finished_campaigns()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.complete_campaign(c.id)
  from public.campaigns c
  where c.status = 'sending'
    and c.updated_at < now() - interval '1 minute'
    and c.delivered_count + c.failed_count = c.recipient_count;
end;
$$;

revoke execute on function private.complete_finished_campaigns() from public, anon, authenticated;

select cron.schedule('complete-finished-campaigns', '* * * * *', 'select private.complete_finished_campaigns()');
-- 원문에 전화번호가 있다. 처리방침대로 90일 뒤 지운다(기획서 "개인정보").
select cron.schedule(
  'purge-webhook-events',
  '40 3 * * *',
  $$delete from public.webhook_events where received_at < now() - interval '90 days'$$
);
