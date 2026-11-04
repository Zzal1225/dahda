-- 실제 발송 하루 상한. 코드 실수나 무한 재시도가 있어도 돈과 문자가 정해진 양을 넘지 않게 하는 마지막 장치다.
-- 보낸 건을 세지 않고 보내기 전에 예약한다. 메시지 행을 세면 접수 뒤 저장 전에 죽은 건이 빠져 상한을 넘을 수 있고,
-- 워커 둘이 동시에 같은 숫자를 보고 함께 통과할 수 있다. 재시도도 다시 예약하므로 실패가 많으면 일찍 닫힌다. 그쪽이 안전하다.
create table public.real_send_counters (
  day date primary key, -- KST 날짜
  sent integer not null default 0 check (sent >= 0)
);
alter table public.real_send_counters enable row level security; -- 정책 없음 = service_role만

create function public.reserve_real_sends(p_count integer, p_limit integer)
returns integer -- 보내도 되는 건수
language plpgsql
set search_path = ''
as $$
declare
  v_day date := (now() at time zone 'Asia/Seoul')::date;
  v_used integer;
  v_granted integer;
begin
  insert into public.real_send_counters (day) values (v_day)
  on conflict (day) do nothing;

  select sent into v_used
  from public.real_send_counters
  where day = v_day
  for update;

  v_granted := greatest(0, least(p_count, p_limit - v_used));
  update public.real_send_counters set sent = v_used + v_granted where day = v_day;
  return v_granted;
end;
$$;

revoke execute on function public.reserve_real_sends(integer, integer) from public, anon, authenticated;
grant execute on function public.reserve_real_sends(integer, integer) to service_role;
