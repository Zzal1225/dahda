-- 발송 큐. messages의 queued 행이 곧 큐다. 판단은 워커의 status.ts가 하고, 여기서는 집기와 조건부 저장만 한다.

-- 함수가 끝나면 행 잠금도 풀리고, 업체 호출은 그 뒤에 일어난다. 그래서 잠금만으로는 다음 워커가 같은 행을 또 집는다.
-- next_attempt_at을 미래로 밀어 "임대"한다. 워커가 결과를 저장하지 못하고 죽으면 임대가 끝난 뒤 다시 집혀 영영 멈추지 않는다.
-- 그때 같은 멱등 키로 다시 보내므로 업체 쪽에서 중복이 막힌다.
create function public.claim_messages(p_limit integer, p_lease_seconds integer)
returns table (
  id bigint,
  campaign_id uuid,
  campaign_status public.campaign_status,
  phone text,
  idempotency_key uuid,
  attempt_count integer,
  body text,
  kind public.campaign_kind,
  sender_phone text,
  is_ad boolean,
  is_trial boolean
)
language plpgsql
set search_path = ''
as $$
begin
  return query
  with picked as (
    select m.id
    from public.messages m
    join public.campaigns c on c.id = m.campaign_id
    where m.status = 'queued'
      and m.next_attempt_at <= now()
      -- 승인 대기 메시지도 시각은 이미 지났을 수 있다. 이 조건이 승인 전 광고 발송을 막는다.
      and c.status in ('scheduled', 'sending')
    order by m.next_attempt_at, m.id
    for update of m skip locked
    limit p_limit
  ),
  leased as (
    update public.messages m
    set attempt_count = m.attempt_count + 1,
        next_attempt_at = now() + make_interval(secs => p_lease_seconds)
    from picked
    where m.id = picked.id
    returning m.id, m.campaign_id, m.phone, m.idempotency_key, m.attempt_count
  )
  select l.id, l.campaign_id, c.status, l.phone::text, l.idempotency_key, l.attempt_count,
         c.body, c.kind, c.sender_phone::text, c.is_ad, o.trial_expires_at is not null
  from leased l
  join public.campaigns c on c.id = l.campaign_id
  join public.organizations o on o.id = c.org_id
  order by l.id;
end;
$$;

-- 워커가 status.ts로 계산한 결과를 저장한다. 읽은 상태일 때만 바꾼다(status.ts 머리말의 약속).
-- 건마다 왕복하면 500건에 500번 호출하므로 묶어서 처리하고, 바꾼 id를 돌려준다. 빠진 id는 그 사이 웹훅이 먼저 온 행이다.
create function public.apply_message_updates(p_updates jsonb)
returns setof bigint
language plpgsql
set search_path = ''
as $$
begin
  return query
  update public.messages m
  set status = u.status,
      provider = u.provider,
      provider_message_id = u.provider_message_id,
      fail_code = u.fail_code,
      sent_at = u.sent_at,
      finalized_at = u.finalized_at,
      next_attempt_at = coalesce(u.next_attempt_at, m.next_attempt_at),
      attempt_count = coalesce(u.attempt_count, m.attempt_count)
  from jsonb_to_recordset(p_updates) as u (
    id bigint,
    expected_status public.message_status,
    status public.message_status,
    provider text,
    provider_message_id text,
    fail_code text,
    sent_at timestamptz,
    finalized_at timestamptz,
    next_attempt_at timestamptz,
    attempt_count integer
  )
  where m.id = u.id and m.status = u.expected_status
  returning m.id;
end;
$$;

revoke execute on function public.claim_messages(integer, integer) from public, anon, authenticated;
revoke execute on function public.apply_message_updates(jsonb) from public, anon, authenticated;
grant execute on function public.claim_messages(integer, integer) to service_role;
grant execute on function public.apply_message_updates(jsonb) to service_role;

-- 워커 깨우기. 주소와 비밀값은 환경마다 달라 Vault에 둔다. 없으면 아무것도 하지 않아, 설정 전에는 문자가 나갈 길이 없다.
create extension if not exists pg_net with schema extensions;

create function private.wake_send_worker()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url text;
  v_secret text;
begin
  -- 보낼 것이 없으면 호출하지 않는다. 10초마다 부르면 한 달에 약 26만 번이라 무료 호출 한도를 그냥 쓰게 된다.
  if not exists (
    select 1
    from public.messages m
    join public.campaigns c on c.id = m.campaign_id
    where m.status = 'queued'
      and m.next_attempt_at <= now()
      and c.status in ('scheduled', 'sending')
  ) then
    return;
  end if;

  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'send_worker_url';
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'send_worker_secret';
  if v_url is null or v_secret is null then
    return;
  end if;

  perform net.http_post(
    url := v_url,
    headers := jsonb_build_object('content-type', 'application/json', 'x-worker-secret', v_secret),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
end;
$$;

revoke execute on function private.wake_send_worker() from public, anon, authenticated;

select cron.schedule('wake-send-worker', '10 seconds', 'select private.wake_send_worker()');
-- 10초 작업은 실행 기록이 하루 8,640행씩 쌓인다.
select cron.schedule(
  'purge-cron-history',
  '30 3 * * *',
  $$delete from cron.job_run_details where end_time < now() - interval '1 day'$$
);
