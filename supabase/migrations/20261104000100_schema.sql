-- dahda 스키마. 권한은 다음 마이그레이션(rls), 잔액 함수는 그다음(ledger_functions)에 둔다.
--
-- 이 파일 전체에 반복되는 설계 세 가지:
-- 1) org_id를 하위 테이블에도 둔다. RLS가 조인 없이 판단해야 10만 행에서 느려지지 않는다.
-- 2) 복합 외래 키 (branch_id, org_id) → branches(id, org_id). 다른 본사의 지점을 가리키는 행을
--    DB가 거부한다. branch_id가 null이면(= 본사 계정) 복합 키 검사를 건너뛰고 org_id의 단일 키만 본다.
-- 3) 지점·발송 건을 참조하는 키는 DEFERRABLE INITIALLY DEFERRED. 지점 단독 삭제는 막으면서
--    본사 삭제(체험 계정 정리)의 연쇄 삭제만 통과시킨다. 즉시 검사하면 연쇄 순서에 따라
--    "아직 안 지워진 자식" 때문에 본사 삭제가 실패한다.

-- 상태 값을 enum으로 두는 이유: 오타를 DB가 거부하고, 타입 생성 시 TS 유니온으로 나온다.
-- 값을 지울 수 없다는 단점은 있지만 상태는 기획서로 고정된 값이다.
create type public.member_role as enum ('hq', 'branch');
create type public.campaign_kind as enum ('sms', 'lms');
create type public.campaign_status as enum (
  'draft', 'pending_approval', 'rejected', 'scheduled', 'sending', 'completed', 'canceled'
);
create type public.message_status as enum ('queued', 'sent', 'delivered', 'failed');
create type public.payment_status as enum ('ready', 'done', 'canceled', 'failed');
create type public.ledger_kind as enum ('charge', 'reserve', 'release', 'refund');

-- 숫자만이라는 규칙을 열마다 CHECK로 복사하지 않으려고 도메인으로 뺐다.
-- 번호 체계 검증은 입력 스키마의 일이고, 여기서는 정규화가 빠진 값만 막는다.
create domain public.phone_digits as text
  check (value ~ '^[0-9]{8,15}$');

create function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 조직
-- ---------------------------------------------------------------------------

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (btrim(name) <> ''),
  -- null이면 실제 본사. 별도 is_trial 열을 두면 두 열이 어긋날 수 있어 하나로 표현한다.
  -- 워커는 이 값으로 체험 본사를 가짜 발송기에 고정한다.
  trial_expires_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.branches (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  name text not null check (btrim(name) <> ''),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, name),
  unique (id, org_id) -- 복합 외래 키의 대상
);
create trigger branches_set_updated_at before update on public.branches
  for each row execute function public.set_updated_at();

create table public.members (
  -- 사용자당 한 행. 한 사람이 여러 본사에 속하는 경우는 범위 밖이라 PK로 고정했다.
  user_id uuid primary key references auth.users (id) on delete cascade,
  org_id uuid not null references public.organizations (id) on delete cascade,
  branch_id uuid,
  role public.member_role not null,
  display_name text not null check (btrim(display_name) <> ''),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (branch_id, org_id) references public.branches (id, org_id)
    deferrable initially deferred,
  -- 역할 전환에서 role만 바꾸고 branch_id를 빠뜨리면 권한 판단이 어긋난다. 그 상태를 저장 자체로 막는다.
  constraint members_role_matches_branch check (
    (role = 'hq' and branch_id is null) or (role = 'branch' and branch_id is not null)
  )
);
create index members_org_id_idx on public.members (org_id);
-- 지점 담당자는 1명이라는 기획을 제약으로 옮겼다. 본사 계정(null)은 여러 명 가능하다.
create unique index members_one_per_branch on public.members (branch_id)
  where branch_id is not null;
create trigger members_set_updated_at before update on public.members
  for each row execute function public.set_updated_at();

-- 지점당 번호가 여러 개라 branches의 열로 두지 않았다.
create table public.sender_numbers (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  branch_id uuid, -- null = 본사 번호
  number public.phone_digits not null,
  label text not null check (btrim(label) <> ''),
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (branch_id, org_id) references public.branches (id, org_id)
    deferrable initially deferred,
  -- NULLS NOT DISTINCT가 없으면 branch_id가 null인 본사 번호는 중복이 허용된다.
  unique nulls not distinct (org_id, branch_id, number)
);
-- 대표 번호는 계정마다 하나. null은 서로 다른 값으로 취급되므로 본사용 인덱스를 따로 둔다.
create unique index sender_numbers_one_default_per_branch on public.sender_numbers (branch_id)
  where is_default and branch_id is not null;
create unique index sender_numbers_one_default_per_hq on public.sender_numbers (org_id)
  where is_default and branch_id is null;
create trigger sender_numbers_set_updated_at before update on public.sender_numbers
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 주소록
-- ---------------------------------------------------------------------------

create table public.contacts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  branch_id uuid not null,
  phone public.phone_digits not null,
  name text,
  memo text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (branch_id, org_id) references public.branches (id, org_id)
    deferrable initially deferred,
  unique (branch_id, phone), -- 엑셀 업로드의 "중복" 판정 기준
  unique (id, org_id, branch_id)
);
create index contacts_org_id_idx on public.contacts (org_id);
create trigger contacts_set_updated_at before update on public.contacts
  for each row execute function public.set_updated_at();

create table public.contact_groups (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  branch_id uuid not null,
  name text not null check (btrim(name) <> ''),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (branch_id, org_id) references public.branches (id, org_id)
    deferrable initially deferred,
  unique (branch_id, name),
  unique (id, org_id, branch_id)
);
create index contact_groups_org_id_idx on public.contact_groups (org_id);
create trigger contact_groups_set_updated_at before update on public.contact_groups
  for each row execute function public.set_updated_at();

-- org_id·branch_id를 양쪽 복합 키에 함께 넣어 "다른 지점 연락처를 내 그룹에 넣기"를 구조적으로 막는다.
create table public.contact_group_members (
  group_id uuid not null,
  contact_id uuid not null,
  org_id uuid not null,
  branch_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (group_id, contact_id),
  foreign key (group_id, org_id, branch_id)
    references public.contact_groups (id, org_id, branch_id) on delete cascade,
  foreign key (contact_id, org_id, branch_id)
    references public.contacts (id, org_id, branch_id) on delete cascade
);
create index contact_group_members_contact_id_idx on public.contact_group_members (contact_id);

-- 수신거부는 본사 공통이다. 한 지점에서 거부한 번호를 다른 지점이 보내면 안 되기 때문이다.
create table public.opt_outs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  phone public.phone_digits not null,
  reason text,
  source text not null check (source in ('manual', 'upload', 'webhook')),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (org_id, phone)
);

-- ---------------------------------------------------------------------------
-- 발송
-- ---------------------------------------------------------------------------

create table public.campaigns (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  branch_id uuid, -- null = 본사 발송
  created_by uuid references auth.users (id) on delete set null,
  body text not null default '',
  kind public.campaign_kind not null default 'sms',
  is_ad boolean not null default false,
  -- sender_numbers를 참조하지 않고 값을 복사한다. 번호를 나중에 지워도 발송 기록은 그대로여야 한다.
  sender_phone public.phone_digits,
  scheduled_at timestamptz,
  status public.campaign_status not null default 'draft',
  rejected_reason text,
  requested_at timestamptz,
  reviewed_by uuid references auth.users (id) on delete set null,
  reviewed_at timestamptz,
  recipient_count integer not null default 0 check (recipient_count >= 0),
  -- 단가를 저장하는 이유: 요금이 바뀌어도 실패분 환불은 발송 당시 단가로 계산해야 한다.
  unit_price integer not null default 0 check (unit_price >= 0),
  estimated_cost integer not null default 0,
  -- 진행률 집계. 화면이 메시지 10만 행을 구독하지 않고 이 행 하나만 구독한다.
  -- 갱신 트리거는 큐·웹훅을 만드는 step4에서 추가한다.
  sent_count integer not null default 0 check (sent_count >= 0),
  delivered_count integer not null default 0 check (delivered_count >= 0),
  failed_count integer not null default 0 check (failed_count >= 0),
  -- 실패 건 재발송은 원본을 되돌리지 않고 새 발송 건으로 잇는다.
  retry_of_campaign_id uuid,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, org_id),
  foreign key (branch_id, org_id) references public.branches (id, org_id)
    deferrable initially deferred,
  foreign key (retry_of_campaign_id, org_id) references public.campaigns (id, org_id)
    deferrable initially deferred,
  constraint campaigns_rejected_has_reason check ((status = 'rejected') = (rejected_reason is not null)),
  constraint campaigns_submitted_has_sender check (status = 'draft' or sender_phone is not null),
  constraint campaigns_cost_matches check (estimated_cost = recipient_count * unit_price),
  constraint campaigns_final_counts_fit check (delivered_count + failed_count <= recipient_count)
);
create index campaigns_org_created_idx on public.campaigns (org_id, created_at desc);
create index campaigns_branch_created_idx on public.campaigns (branch_id, created_at desc)
  where branch_id is not null;
create index campaigns_retry_of_idx on public.campaigns (retry_of_campaign_id)
  where retry_of_campaign_id is not null;
create trigger campaigns_set_updated_at before update on public.campaigns
  for each row execute function public.set_updated_at();

create table public.messages (
  -- uuid 대신 bigint: 10만 행에서 인덱스가 작고, 표의 다음 페이지를 id 기준으로 찾을 수 있다.
  id bigint generated always as identity primary key,
  campaign_id uuid not null references public.campaigns (id) on delete cascade,
  -- 아래 트리거가 발송 건에서 복사한다. 부르는 쪽이 넘긴 값을 믿지 않으므로 어긋날 수 없다.
  -- 복합 외래 키로 묶지 않은 이유: 본사 발송은 branch_id가 null이라 키 검사가 건너뛰어져 보장이 안 된다.
  org_id uuid not null,
  branch_id uuid,
  phone public.phone_digits not null,
  -- 번호·이름은 발송 시점 값이다. 주소록을 고쳐도 지난 발송 결과는 바뀌지 않아야 한다.
  recipient_name text,
  status public.message_status not null default 'queued',
  provider text,
  provider_message_id text,
  -- 재시도에도 같은 키를 쓴다. 업체 웹훅이 워커의 sent 기록보다 먼저 와도 이 키로 행을 찾는다.
  idempotency_key uuid not null default gen_random_uuid() unique,
  fail_code text,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  -- 예약 발송도 여기에 넣는다. 워커가 발송 건과 조인하지 않고 이 열만 보면 된다.
  next_attempt_at timestamptz not null default now(),
  sent_at timestamptz,
  finalized_at timestamptz,
  created_at timestamptz not null default now(),
  unique (campaign_id, phone), -- 같은 번호에 두 번 보내고 두 번 차감하는 것을 막는다
  constraint messages_sent_has_provider_id check (status <> 'sent' or provider_message_id is not null),
  constraint messages_failed_has_code check (status <> 'failed' or fail_code is not null),
  constraint messages_final_has_time check ((status in ('delivered', 'failed')) = (finalized_at is not null))
);
-- 큐 집기 전용. 끝난 행이 쌓여도 인덱스는 대기 행 크기만큼만 유지된다.
create index messages_queue_idx on public.messages (next_attempt_at) where status = 'queued';
create unique index messages_provider_id_idx on public.messages (provider, provider_message_id)
  where provider_message_id is not null;
-- 표 정렬·필터용 인덱스는 step2에서 측정 전 수치를 잰 뒤 추가한다(CLAUDE.md 5-2).

create function public.messages_copy_campaign_scope()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  select c.org_id, c.branch_id into new.org_id, new.branch_id
  from public.campaigns c
  where c.id = new.campaign_id;
  return new;
end;
$$;
create trigger messages_copy_campaign_scope before insert on public.messages
  for each row execute function public.messages_copy_campaign_scope();

-- 파싱에 실패한 본문도 남겨야 하므로 jsonb가 아닌 text로 저장한다. 서명 검증도 원문 그대로가 필요하다.
create table public.webhook_events (
  id bigint generated always as identity primary key,
  provider text not null,
  raw_body text not null,
  signature_valid boolean not null,
  process_result text, -- null = 아직 처리 전. 값 목록은 웹훅을 만드는 step4에서 정한다.
  error text,
  received_at timestamptz not null default now(),
  processed_at timestamptz
);
create index webhook_events_received_at_idx on public.webhook_events (received_at); -- 90일 삭제용

-- ---------------------------------------------------------------------------
-- 돈
-- ---------------------------------------------------------------------------

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  branch_id uuid, -- null = 본사 계정
  requested_by uuid references auth.users (id) on delete set null,
  order_id text not null unique,
  payment_key text unique,
  amount integer not null check (amount > 0), -- 승인 전 브라우저 값과 대조하는 기준
  status public.payment_status not null default 'ready',
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, org_id),
  foreign key (branch_id, org_id) references public.branches (id, org_id)
    deferrable initially deferred,
  constraint payments_done_has_key check (status <> 'done' or payment_key is not null)
);
create index payments_org_created_idx on public.payments (org_id, created_at desc);
create trigger payments_set_updated_at before update on public.payments
  for each row execute function public.set_updated_at();

-- 잔액 열이 없다. 잔액은 이 표의 합계이며, 숫자 하나를 고치는 방식과 달리 이유가 모두 남는다.
create table public.ledger_entries (
  id bigint generated always as identity primary key,
  org_id uuid not null references public.organizations (id) on delete cascade,
  branch_id uuid, -- 잔액 계정. null = 본사 계정
  kind public.ledger_kind not null,
  amount integer not null,
  -- 연결 대상을 "id + 종류" 한 열로 두면 외래 키를 걸 수 없어 두 열로 나눴다.
  payment_id uuid,
  campaign_id uuid,
  idempotency_key text not null unique,
  created_at timestamptz not null default now(),
  foreign key (branch_id, org_id) references public.branches (id, org_id)
    deferrable initially deferred,
  foreign key (payment_id, org_id) references public.payments (id, org_id)
    deferrable initially deferred,
  foreign key (campaign_id, org_id) references public.campaigns (id, org_id)
    deferrable initially deferred,
  -- 부호 실수는 잔액 전체를 틀리게 하지만 합계만 봐서는 찾기 어렵다. 저장할 때 막는다.
  constraint ledger_amount_sign check (
    (kind = 'reserve' and amount < 0) or (kind <> 'reserve' and amount > 0)
  ),
  constraint ledger_link_matches_kind check (
    (kind = 'charge' and payment_id is not null and campaign_id is null)
    or (kind <> 'charge' and campaign_id is not null and payment_id is null)
  )
);
create index ledger_entries_account_idx on public.ledger_entries (org_id, branch_id, created_at desc);
-- 멱등 키를 만드는 코드가 실수해도 같은 결제·같은 발송 건으로 두 번 기록되지 않게 하는 두 번째 방어선.
create unique index ledger_one_charge_per_payment on public.ledger_entries (payment_id)
  where payment_id is not null;
create unique index ledger_one_kind_per_campaign on public.ledger_entries (campaign_id, kind)
  where campaign_id is not null;

-- 잔액 조회 경로를 하나로 둔다. security_invoker여야 조회자의 RLS가 적용된다.
-- 기본값(생성자 권한)이면 뷰를 통해 다른 지점의 잔액이 보인다.
create view public.account_balances
with (security_invoker = true) as
select org_id, branch_id, sum(amount)::bigint as balance
from public.ledger_entries
group by org_id, branch_id;
