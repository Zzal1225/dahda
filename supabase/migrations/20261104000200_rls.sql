-- 권한의 최종 경계. 화면과 requireRole은 편의이고, 여기가 뚫리면 다른 지점 데이터가 보인다.
--
-- 쓰기 원칙: 상태·돈이 얽힌 테이블(campaigns, messages, payments, ledger_entries, members,
-- sender_numbers, organizations)은 사용자에게 쓰기 권한을 주지 않고 서버(service_role)만 쓴다.
-- RLS는 "어느 행인가"는 판단해도 "어떤 전이인가"는 판단하기 어렵다. 지점에 campaigns UPDATE를 열면
-- 자기 광고를 status = 'scheduled'로 바꿔 본사 승인을 건너뛸 수 있다.

-- ---------------------------------------------------------------------------
-- 현재 사용자 조회
-- ---------------------------------------------------------------------------

-- PostgREST가 노출하지 않는 스키마에 둔다. 정책 평가에 필요한 실행 권한만 준다.
create schema private;
grant usage on schema private to authenticated;

-- SECURITY DEFINER인 이유: members 정책이 members를 읽으면 정책이 자기 자신을 다시 호출해 무한 재귀가 된다.
-- search_path를 비워 정의자 권한으로 다른 스키마의 같은 이름 객체를 잡는 공격을 막는다.
create function private.current_org_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select org_id from public.members where user_id = auth.uid()
$$;

create function private.current_branch_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select branch_id from public.members where user_id = auth.uid()
$$;

create function private.is_hq()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.members where user_id = auth.uid() and role = 'hq')
$$;

revoke all on function private.current_org_id(), private.current_branch_id(), private.is_hq() from public;
grant execute on function private.current_org_id(), private.current_branch_id(), private.is_hq()
  to authenticated;

-- ---------------------------------------------------------------------------
-- 테이블 권한
-- ---------------------------------------------------------------------------

-- Supabase 기본값은 anon·authenticated에 전체 권한을 주고 RLS에 맡긴다.
-- 정책 실수에 대비해 필요한 권한만 다시 준다. 비로그인(anon)은 어떤 테이블도 읽지 못한다.
revoke all on all tables in schema public from anon, authenticated;
alter default privileges for role postgres in schema public revoke all on tables from anon, authenticated;

grant select on
  public.organizations, public.branches, public.members, public.sender_numbers,
  public.contacts, public.contact_groups, public.contact_group_members, public.opt_outs,
  public.campaigns, public.messages, public.payments, public.ledger_entries,
  public.account_balances
to authenticated;
-- webhook_events는 원문에 전화번호가 있고 화면에서 쓰지 않으므로 select도 주지 않는다.

grant insert (org_id, name), update (name) on public.branches to authenticated;
grant insert, update, delete on public.contacts, public.contact_groups to authenticated;
grant insert, delete on public.contact_group_members to authenticated;
grant insert, delete on public.opt_outs to authenticated;

-- 트리거 함수를 포함해 public 함수는 API로 직접 부를 수 없게 한다. 트리거 실행에는 이 권한이 필요 없다.
revoke execute on all functions in schema public from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 정책
-- ---------------------------------------------------------------------------
-- 함수를 (select ...)로 감싸는 이유: 그냥 부르면 행마다 실행되고, 감싸면 쿼리당 한 번만 실행된다.
-- 10만 행 표에서 차이가 크다. 같은 이유로 범위 판단을 함수 하나로 묶지 않고 식을 그대로 적었다.
--
-- 지점 전용 쓰기 정책은 branch_id = current_branch_id()만 본다. 본사는 current_branch_id()가 null이고
-- null과의 비교는 참이 아니므로 역할 조건 없이도 자동으로 제외된다.

alter table public.organizations enable row level security;
alter table public.branches enable row level security;
alter table public.members enable row level security;
alter table public.sender_numbers enable row level security;
alter table public.contacts enable row level security;
alter table public.contact_groups enable row level security;
alter table public.contact_group_members enable row level security;
alter table public.opt_outs enable row level security;
alter table public.campaigns enable row level security;
alter table public.messages enable row level security;
alter table public.webhook_events enable row level security; -- 정책 없음 = service_role만
alter table public.payments enable row level security;
alter table public.ledger_entries enable row level security;

create policy organizations_select on public.organizations for select to authenticated
  using (id = (select private.current_org_id()));

create policy branches_select on public.branches for select to authenticated
  using (
    org_id = (select private.current_org_id())
    and ((select private.is_hq()) or id = (select private.current_branch_id()))
  );
create policy branches_insert on public.branches for insert to authenticated
  with check (org_id = (select private.current_org_id()) and (select private.is_hq()));
create policy branches_update on public.branches for update to authenticated
  using (org_id = (select private.current_org_id()) and (select private.is_hq()))
  with check (org_id = (select private.current_org_id()) and (select private.is_hq()));

create policy members_select on public.members for select to authenticated
  using (
    user_id = (select auth.uid())
    or (org_id = (select private.current_org_id()) and (select private.is_hq()))
  );

create policy sender_numbers_select on public.sender_numbers for select to authenticated
  using (
    org_id = (select private.current_org_id())
    and ((select private.is_hq()) or branch_id = (select private.current_branch_id()))
  );

-- 주소록은 지점 소유다. 본사는 조회만 한다.
create policy contacts_select on public.contacts for select to authenticated
  using (
    org_id = (select private.current_org_id())
    and ((select private.is_hq()) or branch_id = (select private.current_branch_id()))
  );
create policy contacts_insert on public.contacts for insert to authenticated
  with check (
    org_id = (select private.current_org_id())
    and branch_id = (select private.current_branch_id())
  );
create policy contacts_update on public.contacts for update to authenticated
  using (
    org_id = (select private.current_org_id())
    and branch_id = (select private.current_branch_id())
  )
  with check (
    org_id = (select private.current_org_id())
    and branch_id = (select private.current_branch_id())
  );
create policy contacts_delete on public.contacts for delete to authenticated
  using (
    org_id = (select private.current_org_id())
    and branch_id = (select private.current_branch_id())
  );

create policy contact_groups_select on public.contact_groups for select to authenticated
  using (
    org_id = (select private.current_org_id())
    and ((select private.is_hq()) or branch_id = (select private.current_branch_id()))
  );
create policy contact_groups_insert on public.contact_groups for insert to authenticated
  with check (
    org_id = (select private.current_org_id())
    and branch_id = (select private.current_branch_id())
  );
create policy contact_groups_update on public.contact_groups for update to authenticated
  using (
    org_id = (select private.current_org_id())
    and branch_id = (select private.current_branch_id())
  )
  with check (
    org_id = (select private.current_org_id())
    and branch_id = (select private.current_branch_id())
  );
create policy contact_groups_delete on public.contact_groups for delete to authenticated
  using (
    org_id = (select private.current_org_id())
    and branch_id = (select private.current_branch_id())
  );

create policy contact_group_members_select on public.contact_group_members for select to authenticated
  using (
    org_id = (select private.current_org_id())
    and ((select private.is_hq()) or branch_id = (select private.current_branch_id()))
  );
create policy contact_group_members_insert on public.contact_group_members for insert to authenticated
  with check (
    org_id = (select private.current_org_id())
    and branch_id = (select private.current_branch_id())
  );
create policy contact_group_members_delete on public.contact_group_members for delete to authenticated
  using (
    org_id = (select private.current_org_id())
    and branch_id = (select private.current_branch_id())
  );

-- 수신거부는 본사 공통이라 지점 조건이 없다. 해제는 본사만 한다.
create policy opt_outs_select on public.opt_outs for select to authenticated
  using (org_id = (select private.current_org_id()));
create policy opt_outs_insert on public.opt_outs for insert to authenticated
  with check (
    org_id = (select private.current_org_id())
    and created_by = (select auth.uid())
  );
create policy opt_outs_delete on public.opt_outs for delete to authenticated
  using (org_id = (select private.current_org_id()) and (select private.is_hq()));

create policy campaigns_select on public.campaigns for select to authenticated
  using (
    org_id = (select private.current_org_id())
    and ((select private.is_hq()) or branch_id = (select private.current_branch_id()))
  );

create policy messages_select on public.messages for select to authenticated
  using (
    org_id = (select private.current_org_id())
    and ((select private.is_hq()) or branch_id = (select private.current_branch_id()))
  );

create policy payments_select on public.payments for select to authenticated
  using (
    org_id = (select private.current_org_id())
    and ((select private.is_hq()) or branch_id = (select private.current_branch_id()))
  );

create policy ledger_entries_select on public.ledger_entries for select to authenticated
  using (
    org_id = (select private.current_org_id())
    and ((select private.is_hq()) or branch_id = (select private.current_branch_id()))
  );
