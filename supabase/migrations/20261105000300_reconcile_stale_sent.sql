-- 웹훅이 끝내 오지 않아 "접수"에 멈춘 메시지를 업체 조회로 맞춘다.
-- 이게 없으면 그 발송 건은 영원히 "확인 중"이고 실패분 환불도 일어나지 않는다.

-- 10만 행을 훑지 않도록 멈출 수 있는 행만 담는다. 정상 흐름에서는 금방 비워지므로 작다.
-- 가짜 발송기는 조회 API가 없고, 체험 샘플의 "확인 중"은 시연용 상태라 대상에서 뺀다.
create index messages_stale_sent_idx on public.messages (sent_at)
  where status = 'sent' and provider = 'solapi';

-- 워커와 같은 주소를 쓰되 작업만 구분한다. 키와 어댑터를 Edge Function 한 곳에 두려는 것이다.
create function private.wake_reconcile()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url text;
  v_secret text;
begin
  -- 대상이 없으면 부르지 않는다. 호출 한도와 조회 제한을 쓰지 않는다.
  if not exists (
    select 1 from public.messages m
    where m.status = 'sent'
      and m.provider = 'solapi'
      and m.sent_at < now() - interval '1 hour'
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
    body := '{"task":"reconcile"}'::jsonb,
    timeout_milliseconds := 60000
  );
end;
$$;

revoke execute on function private.wake_reconcile() from public, anon, authenticated;

select cron.schedule('reconcile-stale-sent', '*/10 * * * *', 'select private.wake_reconcile()');
