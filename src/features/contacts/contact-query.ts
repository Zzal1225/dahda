import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Database } from "@/server/db/database.types";

export const CONTACT_PAGE_SIZE = 50;

/** URL 값은 사용자가 고칠 수 있는 입력이다. 잘못된 값은 오류 대신 조건 없음으로 처리한다. */
const optionalUuid = z.uuid().nullable().catch(null);
export const contactFiltersSchema = z.object({
  q: z.string().trim().max(50).catch(""),
  group: optionalUuid,
  branch: optionalUuid,
  page: z.coerce.number().int().min(1).catch(1),
});
export type ContactFilters = z.output<typeof contactFiltersSchema>;

export type ContactRow = {
  id: string;
  branchId: string;
  branchName: string | null;
  phone: string;
  name: string | null;
  memo: string | null;
  groupIds: string[];
  optedOut: boolean;
};

export type GroupRow = {
  id: string;
  branchId: string;
  name: string;
  memberCount: number;
};

/** ILIKE의 와일드카드를 글자로 취급한다. 검색어 "%"가 전체 일치가 되면 안 된다. */
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (match) => `\\${match}`);
}

/**
 * 사용자 권한 클라이언트를 받아 RLS가 범위를 정한다. 지점 사용자는 다른 지점 id로 필터해도 빈 결과다.
 * 숫자와 구분 문자만 있으면 번호 앞부분으로, 아니면 이름으로 찾는다.
 */
export async function listContacts(
  supabase: SupabaseClient<Database>,
  filters: ContactFilters,
  pageSize: number = CONTACT_PAGE_SIZE,
): Promise<{ rows: ContactRow[]; total: number }> {
  // 그룹으로 거를 때만 !inner로 묶는다. 항상 묶으면 그룹 없는 연락처가 사라진다.
  const groupEmbed = filters.group
    ? "contact_group_members!inner(group_id)"
    : "contact_group_members(group_id)";

  let request = supabase
    .from("contacts")
    .select(`id, branch_id, phone, name, memo, branches(name), ${groupEmbed}`, {
      count: "exact",
    });

  if (filters.branch) request = request.eq("branch_id", filters.branch);
  if (filters.group) {
    request = request.eq("contact_group_members.group_id", filters.group);
  }
  if (filters.q) {
    const digits = filters.q.replace(/[\s-]/g, "");
    request = /^[0-9]+$/.test(digits)
      ? request.like("phone", `${digits}%`)
      : request.ilike("name", `%${escapeLike(filters.q)}%`);
  }

  const offset = (filters.page - 1) * pageSize;
  const { data, error, count } = await request
    // 엑셀 업로드처럼 같은 시각에 만든 행이 많아, 뒤섞여 보이지 않게 번호로 정렬한다.
    .order("created_at", { ascending: false })
    .order("phone")
    // 지점이 다르면 같은 시각에 같은 번호가 있을 수 있다. 내보내기는 페이지를 이어 읽으므로 순서가 고정돼야 한다.
    .order("id")
    .range(offset, offset + pageSize - 1)
    .overrideTypes<
      {
        id: string;
        branch_id: string;
        phone: string;
        name: string | null;
        memo: string | null;
        branches: { name: string } | null;
        contact_group_members: { group_id: string }[];
      }[]
    >();
  if (error) throw new Error(`연락처 조회 실패: ${error.message}`);

  // 수신거부는 본사 공통이라 이 페이지의 번호만 따로 확인한다.
  const phones = data.map((row) => row.phone);
  const optOuts = phones.length
    ? await supabase.from("opt_outs").select("phone").in("phone", phones)
    : { data: [], error: null };
  if (optOuts.error) {
    throw new Error(`수신거부 조회 실패: ${optOuts.error.message}`);
  }
  const optedOut = new Set(optOuts.data.map((row) => row.phone));

  return {
    rows: data.map((row) => ({
      id: row.id,
      branchId: row.branch_id,
      branchName: row.branches?.name ?? null,
      phone: row.phone,
      name: row.name,
      memo: row.memo,
      groupIds: row.contact_group_members.map((member) => member.group_id),
      optedOut: optedOut.has(row.phone),
    })),
    total: count ?? 0,
  };
}

export async function listGroups(
  supabase: SupabaseClient<Database>,
): Promise<GroupRow[]> {
  const { data, error } = await supabase
    .from("contact_groups")
    .select("id, branch_id, name, contact_group_members(count)")
    .order("name");
  if (error) throw new Error(`그룹 조회 실패: ${error.message}`);

  return data.map((row) => ({
    id: row.id,
    branchId: row.branch_id,
    name: row.name,
    memberCount: row.contact_group_members[0]?.count ?? 0,
  }));
}

export const OPT_OUT_PAGE_SIZE = 50;
export const optOutFiltersSchema = z.object({
  q: z.string().trim().max(20).catch(""),
  page: z.coerce.number().int().min(1).catch(1),
});
export type OptOutFilters = z.output<typeof optOutFiltersSchema>;

export type OptOutRow = {
  id: string;
  phone: string;
  reason: string | null;
  source: string;
  createdAt: string;
};

export async function listOptOuts(
  supabase: SupabaseClient<Database>,
  filters: OptOutFilters,
): Promise<{ rows: OptOutRow[]; total: number }> {
  let request = supabase
    .from("opt_outs")
    .select("id, phone, reason, source, created_at", { count: "exact" });

  const digits = filters.q.replace(/[^0-9]/g, "");
  if (digits) request = request.like("phone", `${digits}%`);

  const offset = (filters.page - 1) * OPT_OUT_PAGE_SIZE;
  const { data, error, count } = await request
    .order("created_at", { ascending: false })
    .order("id")
    .range(offset, offset + OPT_OUT_PAGE_SIZE - 1);
  if (error) throw new Error(`수신거부 조회 실패: ${error.message}`);

  return {
    rows: data.map((row) => ({
      id: row.id,
      phone: row.phone,
      reason: row.reason,
      source: row.source,
      createdAt: row.created_at,
    })),
    total: count ?? 0,
  };
}
