-- 주소록 화면 개편에 필요한 최소 변경.
--   1) 본사도 엑셀 업로드로 지점 주소록에 연락처·그룹을 넣을 수 있다(사용자 요청). 수정·삭제는 여전히 지점만 한다.
--   2) contact_page: 수신 상태(동의·미동의·수신거부)로 거르고, 번호 뒤 4자리로 찾는 목록 함수.
--   3) 체험 주소록 샘플 교체: 지점마다 다른 사람 500명, 무작위 이름·번호, 그룹 4~5개, 수신 상태 분포, 등록일 6개월.
--   4) 체험 발송 샘플의 수신자를 주소록 사람으로 잇는다. 안 이으면 연락처 상세의 "최근 받은 문자"가 늘 비어 있다.
-- 열·테이블은 추가하지 않는다.

-- ---------------------------------------------------------------------------
-- 1) 본사 쓰기 허용(추가만)
-- 본사는 어느 지점이든 넣을 수 있다. 지점이 같은 본사 소속인지는 (branch_id, org_id) 외래 키가 보장한다.
-- ---------------------------------------------------------------------------
drop policy contacts_insert on public.contacts;
create policy contacts_insert on public.contacts for insert to authenticated
  with check (
    org_id = (select private.current_org_id())
    and ((select private.is_hq()) or branch_id = (select private.current_branch_id()))
  );

drop policy contact_groups_insert on public.contact_groups;
create policy contact_groups_insert on public.contact_groups for insert to authenticated
  with check (
    org_id = (select private.current_org_id())
    and ((select private.is_hq()) or branch_id = (select private.current_branch_id()))
  );

drop policy contact_group_members_insert on public.contact_group_members;
create policy contact_group_members_insert on public.contact_group_members for insert to authenticated
  with check (
    org_id = (select private.current_org_id())
    and ((select private.is_hq()) or branch_id = (select private.current_branch_id()))
  );

-- ---------------------------------------------------------------------------
-- 2) 목록 함수
-- 수신거부는 번호 기준 본사 공통 목록(opt_outs)이라 연락처 열이 아니다. PostgREST로는 "수신거부인 연락처만"을
-- 거를 수 없어(관계 없는 테이블의 존재 여부) 함수로 계산한다. security invoker라 RLS가 범위를 정한다.
-- 검색: 숫자 1~4자리면 번호 끝, 더 길면 번호 앞, 그 밖은 이름 일부.
-- total_count는 거른 뒤 전체 건수(offset·limit 전)다. 페이지마다 한 번에 받는다.
-- ---------------------------------------------------------------------------
create function public.contact_page(
  p_branch_id uuid,
  p_group_id uuid,
  p_status text,
  p_query text,
  p_offset integer,
  p_limit integer
)
returns table (
  id uuid,
  branch_id uuid,
  branch_name text,
  phone text,
  name text,
  memo text,
  consent_at timestamptz,
  created_at timestamptz,
  group_ids uuid[],
  receive_status text,
  total_count bigint
)
language sql
stable
set search_path = ''
as $$
  with scoped as (
    select
      c.id, c.branch_id, c.phone::text as phone, c.name, c.memo, c.consent_at, c.created_at,
      case
        when exists (select 1 from public.opt_outs o where o.org_id = c.org_id and o.phone = c.phone)
          then 'opted_out'
        when c.consent_at is not null then 'consented'
        else 'not_consented'
      end as receive_status
    from public.contacts c
    where (p_branch_id is null or c.branch_id = p_branch_id)
      and (
        p_group_id is null
        or exists (
          select 1 from public.contact_group_members g
          where g.contact_id = c.id and g.group_id = p_group_id
        )
      )
      and (
        coalesce(p_query, '') = ''
        or case
          when p_query ~ '^[0-9]{1,4}$' then c.phone like '%' || p_query
          when p_query ~ '^[0-9]+$' then c.phone like p_query || '%'
          -- 검색어의 %·_는 글자로 취급한다. "%"가 전체 일치가 되면 안 된다.
          else c.name ilike '%' || replace(replace(replace(p_query, '\', '\\'), '%', '\%'), '_', '\_') || '%'
        end
      )
  ),
  filtered as (
    select * from scoped where p_status is null or receive_status = p_status
  )
  select
    f.id, f.branch_id, b.name, f.phone, f.name, f.memo, f.consent_at, f.created_at,
    coalesce(
      (select array_agg(g.group_id order by g.created_at, g.group_id)
       from public.contact_group_members g where g.contact_id = f.id),
      '{}'
    ),
    f.receive_status,
    count(*) over ()
  from filtered f
  join public.branches b on b.id = f.branch_id
  -- 최근 등록순. 업로드처럼 같은 시각에 들어온 행이 많아 번호·id로 순서를 고정한다(내보내기가 페이지를 이어 읽는다).
  order by f.created_at desc, f.phone, f.id
  offset greatest(p_offset, 0)
  limit least(greatest(p_limit, 1), 1000);
$$;

revoke execute on function public.contact_page(uuid, uuid, text, text, integer, integer) from public, anon;
grant execute on function public.contact_page(uuid, uuid, text, text, integer, integer) to authenticated;

-- 연락처 상세의 "최근 받은 문자 3건"은 번호로 메시지를 찾는다. 메시지에는 번호 인덱스가 없어 표 전체를 훑었다.
-- 측정(로컬, 메시지 86만 행, 같은 쿼리 explain analyze): 인덱스 전 48.2ms(Seq Scan) → 후는 docs/performance.md.
create index messages_phone_idx on public.messages (phone);

-- ---------------------------------------------------------------------------
-- 3) 체험 주소록 샘플
-- 번호는 0100 다음 자리가 1~9인 대역(0100-1xxx-xxxx ~ 0100-9xxx-xxxx)만 쓴다. 010-0xxx 대역은 통신사가 배정하지 않는
-- 안전 대역이고, 그중 01000으로 시작하는 번호는 발신번호·테스트 데이터가 쓰므로 비워 둔다.
-- 지점마다 다른 사람이다. 1,500명을 한 번에 뽑아 지점별로 500명씩 나눠 번호가 겹치지 않는다.
-- ---------------------------------------------------------------------------
create or replace function public.create_trial_org_with_contacts(p_user_id uuid)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_org_id uuid;
  v_branch record;
  v_index integer := 0;
  v_group_count integer;
  v_group_ids uuid[];
  v_group_id uuid;
  -- 모든 지점에 단골·신규가 있고, 나머지는 지점마다 다르게 2~3개를 고른다.
  v_extra constant text[] := array[
    '과일 행사', '배달 고객', '주말 장보기', '정육 예약', '김장 예약', '반찬 정기 배송', '아파트 단지 이웃'
  ];
  v_surnames constant text[] := array[
    '김','이','박','최','정','강','조','윤','장','임','한','오','서','신','권','황','안','송','류','전','홍','고','문','양','손'
  ];
  v_given constant text[] := array[
    '민준','서연','도윤','하은','지호','수아','예준','지유','시우','서윤','주원','하린','지민','유나','현우','채원',
    '준서','다은','건우','소율','은우','지안','선우','예린','연우','수빈','정우','나연','승현','가윤','태윤','민서',
    '영숙','미경','정희','순자','경수','영호','상철','미영','은정','혜진','성민','동현','지훈','보람'
  ];
  v_memos constant text[] := array[
    '주말 오전 배송 선호', '현관 비밀번호 문자로 받음', '대량 구매 고객(식당 운영)', '유기농 채소 문의 많음',
    '전화보다 문자 선호', '김장철 절임배추 매년 주문', '아파트 경비실에 맡겨 달라고 함', '견과류 알레르기 있음'
  ];
  v_reasons constant text[] := array['문자 수신 원치 않음', '전화로 수신 거부 요청', '080 수신거부 전화'];
begin
  v_org_id := public.create_trial_org_base(p_user_id);

  -- 두 번 불러도 샘플이 겹치지 않게 한다.
  if exists (select 1 from public.contacts where org_id = v_org_id) then
    return v_org_id;
  end if;

  create temporary table trial_people on commit drop as
  select row_number() over (order by random()) as n, phone
  from (
    select distinct '0100' || (1000000 + floor(random() * 9000000))::integer::text as phone
    from generate_series(1, 1700)
  ) candidates
  limit 1500;

  for v_branch in
    select id from public.branches where org_id = v_org_id order by name
  loop
    -- 그룹 4~5개
    v_group_count := 4 + (v_index % 2);
    with created as (
      insert into public.contact_groups (org_id, branch_id, name)
      select v_org_id, v_branch.id, g.name
      from (
        select '단골' as name, 0 as k
        union all select '신규', 1
        union all
        select v_extra[((v_index * 3 + i) % array_length(v_extra, 1)) + 1], 2 + i
        from generate_series(0, v_group_count - 3) as i
      ) g
      returning id
    )
    select array_agg(id) into v_group_ids from created;

    -- 사람 500명. 수신 상태 92% 동의, 5% 미동의, 3% 수신거부. 메모 10%. 등록일은 최근 6개월에 흩어진다.
    create temporary table trial_branch_people on commit drop as
    select
      p.phone,
      v_surnames[1 + floor(random() * array_length(v_surnames, 1))::integer]
        || v_given[1 + floor(random() * array_length(v_given, 1))::integer] as name,
      case when random() < 0.1
        then v_memos[1 + floor(random() * array_length(v_memos, 1))::integer] end as memo,
      now() - random() * interval '180 days' as created_at,
      random() as roll
    from trial_people p
    where p.n > v_index * 500 and p.n <= (v_index + 1) * 500;

    insert into public.contacts (org_id, branch_id, phone, name, memo, consent_at, created_at)
    select
      v_org_id, v_branch.id, phone, name, memo,
      -- 동의는 등록할 때 받았다고 본다. 미동의·수신거부는 동의 기록이 없다.
      case when roll < 0.92 then created_at end,
      created_at
    from trial_branch_people;

    -- 수신거부는 본사 공통 목록에 번호로 남긴다. 등록 뒤 어느 날 거부했다.
    insert into public.opt_outs (org_id, phone, reason, source, created_by, created_at)
    select
      v_org_id, phone,
      v_reasons[1 + floor(random() * array_length(v_reasons, 1))::integer],
      'manual', p_user_id,
      created_at + random() * (now() - created_at)
    from trial_branch_people
    where roll >= 0.97
    on conflict (org_id, phone) do nothing;

    -- 한 사람이 0~2개 그룹: 25%는 없음, 50%는 1개, 25%는 2개.
    -- random()은 select 목록에 둬야 행마다 다시 계산된다. 상관없는 lateral 하위 쿼리에 두면 한 번만 계산될 수 있다.
    -- 같은 그룹이 두 번 뽑히면 distinct로 하나만 남는다(2개를 뽑았는데 1개가 되는 경우는 그대로 둔다).
    insert into public.contact_group_members (group_id, contact_id, org_id, branch_id)
    select distinct
      v_group_ids[1 + floor(random() * array_length(v_group_ids, 1))::integer],
      person.id, v_org_id, v_branch.id
    from (
      select c.id, floor(random() * 4)::integer as how_many
      from public.contacts c
      where c.org_id = v_org_id and c.branch_id = v_branch.id
    ) person
    cross join lateral generate_series(
      1, case person.how_many when 0 then 0 when 3 then 2 else 1 end
    );

    drop table trial_branch_people;
    v_index := v_index + 1;
  end loop;

  return v_org_id;
end;
$$;

revoke execute on function public.create_trial_org_with_contacts(uuid) from public, anon, authenticated;

-- 수신 동의 80%를 now()로 덮어쓰던 감싸기 함수. 위에서 분포와 시각을 정하므로 그대로 넘긴다.
create or replace function public.create_trial_org_before_review(p_user_id uuid)
returns uuid
language plpgsql
set search_path = ''
as $$
begin
  return public.create_trial_org_before_consent(p_user_id);
end;
$$;

revoke execute on function public.create_trial_org_before_review(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4) 발송 샘플 수신자를 주소록 사람으로 잇는다
-- 지점 발송은 그 지점 사람, 본사 발송은 전 지점 사람 중에서 고른다. 수신거부는 빼고, 광고는 동의한 사람만이다
-- (실제 발송 경로의 resolveRecipients와 같은 규칙). 사람이 모자라면 남은 메시지는 원래 번호 그대로 둔다.
-- 기존 번호(01000…)와 새 번호(0100[1-9]…)는 대역이 달라 바꾸는 중에 (campaign_id, phone) 고유 제약에 걸리지 않는다.
-- ---------------------------------------------------------------------------
create function public.link_trial_messages(p_org_id uuid)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_campaign record;
begin
  for v_campaign in
    select c.id, c.branch_id, c.is_ad
    from public.campaigns c
    where c.org_id = p_org_id
  loop
    with eligible as (
      select distinct on (c.phone) c.phone, c.name
      from public.contacts c
      where c.org_id = p_org_id
        and (v_campaign.branch_id is null or c.branch_id = v_campaign.branch_id)
        and (not v_campaign.is_ad or c.consent_at is not null)
        and not exists (
          select 1 from public.opt_outs o where o.org_id = p_org_id and o.phone = c.phone
        )
      order by c.phone, c.id
    ),
    picked as (
      select phone, name, row_number() over (order by md5(v_campaign.id::text || phone)) as k
      from eligible
    ),
    targets as (
      select m.id, row_number() over (order by m.id) as k
      from public.messages m
      where m.campaign_id = v_campaign.id
    )
    update public.messages m
    set phone = p.phone, recipient_name = p.name
    from targets t
    join picked p on p.k = t.k
    where m.id = t.id;
  end loop;
end;
$$;

revoke execute on function public.link_trial_messages(uuid) from public, anon, authenticated;
grant execute on function public.link_trial_messages(uuid) to service_role;

alter function public.create_trial_org(uuid) rename to create_trial_org_before_links;
revoke execute on function public.create_trial_org_before_links(uuid) from public, anon, authenticated;

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
  v_org_id := public.create_trial_org_before_links(p_user_id);
  -- 이미 있던 본사는 사용자가 쓰던 데이터이므로 건드리지 않는다.
  if not v_existed then
    perform public.link_trial_messages(v_org_id);
  end if;
  return v_org_id;
end;
$$;

revoke execute on function public.create_trial_org(uuid) from public, anon, authenticated;
grant execute on function public.create_trial_org(uuid) to service_role;
