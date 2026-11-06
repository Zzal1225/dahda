import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Database } from "@/server/db/database.types";
import {
  isReceiveStatus,
  RECEIVE_STATUSES,
  type ReceiveStatus,
} from "./receive-status";

export const CONTACT_PAGE_SIZE = 50;

/** 그룹 목록의 "수신거부" 항목. 그룹 id(uuid)와 겹치지 않는 값이다. */
export const OPT_OUT_VIEW = "opt-outs";

/** URL 값은 사용자가 고칠 수 있는 입력이다. 잘못된 값은 오류 대신 조건 없음으로 처리한다. */
const optionalUuid = z.uuid().nullable().catch(null);
export const contactFiltersSchema = z.object({
  q: z.string().trim().max(50).catch(""),
  group: z
    .union([z.uuid(), z.literal(OPT_OUT_VIEW)])
    .nullable()
    .catch(null),
  branch: optionalUuid,
  status: z.enum(RECEIVE_STATUSES).nullable().catch(null),
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
  consentAt: string | null;
  createdAt: string;
  groupIds: string[];
  receiveStatus: ReceiveStatus;
  /** 내보내기·대화상자가 쓰는 값. receiveStatus에서 나온다. */
  optedOut: boolean;
};

export type GroupRow = {
  id: string;
  branchId: string;
  /** 본사가 지점을 고르지 않았을 때 어느 지점 그룹인지 보여 준다. */
  branchName: string | null;
  name: string;
  memberCount: number;
};

/**
 * contact_page(DB 함수)로 읽는다. security invoker라 RLS가 범위를 정한다. 지점 사용자는 다른 지점 id로 걸러도 빈 결과다.
 * 수신 상태 필터가 있어 PostgREST 조회로 바꿀 수 없다: 수신거부는 번호 기준 본사 공통 목록이라 연락처와 외래 키가 없다.
 * 검색: 숫자 1~4자리는 번호 끝, 더 긴 숫자는 번호 앞, 그 밖은 이름 일부. 하이픈·공백은 뺀다.
 */
export async function listContacts(
  supabase: SupabaseClient<Database>,
  filters: ContactFilters,
  pageSize: number = CONTACT_PAGE_SIZE,
): Promise<{ rows: ContactRow[]; total: number }> {
  const digits = filters.q.replace(/[\s-]/g, "");
  const query = /^[0-9]+$/.test(digits) ? digits : filters.q;
  const groupId =
    filters.group && filters.group !== OPT_OUT_VIEW ? filters.group : null;

  // 생성 타입은 uuid·text 인자를 null 불가로 적지만 함수는 null을 "조건 없음"으로 받는다.
  const { data, error } = await supabase.rpc("contact_page", {
    p_branch_id: filters.branch as string,
    p_group_id: groupId as string,
    p_status: filters.status as string,
    p_query: query,
    p_offset: (filters.page - 1) * pageSize,
    p_limit: pageSize,
  });
  if (error) throw new Error(`연락처 조회 실패: ${error.message}`);

  return {
    rows: data.map((row) => {
      const status: ReceiveStatus = isReceiveStatus(row.receive_status)
        ? row.receive_status
        : "not_consented";
      return {
        id: row.id,
        branchId: row.branch_id,
        branchName: row.branch_name,
        phone: row.phone,
        name: row.name,
        memo: row.memo,
        consentAt: row.consent_at,
        createdAt: row.created_at,
        groupIds: row.group_ids,
        receiveStatus: status,
        optedOut: status === "opted_out",
      };
    }),
    // 마지막 페이지를 넘겨 행이 없으면 건수도 알 수 없다. 화면은 0건으로 보고 첫 페이지로 돌아가게 한다.
    total: Number(data[0]?.total_count ?? 0),
  };
}

/**
 * 왼쪽 그룹 목록의 "전체"와 "수신거부" 인원. 본사가 지점을 고르면 전체는 그 지점 인원이다.
 * 수신거부는 본사 공통 목록이라 지점과 관계없이 같은 숫자다.
 */
export async function countContactLists(
  supabase: SupabaseClient<Database>,
  branchId: string | null,
): Promise<{ all: number; optOuts: number }> {
  let contacts = supabase
    .from("contacts")
    .select("id", { count: "exact", head: true });
  if (branchId) contacts = contacts.eq("branch_id", branchId);
  const [all, optOuts] = await Promise.all([
    contacts,
    supabase.from("opt_outs").select("id", { count: "exact", head: true }),
  ]);
  if (all.error) throw new Error(`연락처 수 조회 실패: ${all.error.message}`);
  if (optOuts.error) {
    throw new Error(`수신거부 수 조회 실패: ${optOuts.error.message}`);
  }
  return { all: all.count ?? 0, optOuts: optOuts.count ?? 0 };
}

export async function listGroups(
  supabase: SupabaseClient<Database>,
): Promise<GroupRow[]> {
  const { data, error } = await supabase
    .from("contact_groups")
    .select("id, branch_id, name, branches(name), contact_group_members(count)")
    .order("name");
  if (error) throw new Error(`그룹 조회 실패: ${error.message}`);

  return data.map((row) => ({
    id: row.id,
    branchId: row.branch_id,
    branchName: row.branches?.name ?? null,
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

  // 주소록 검색과 같은 규칙: 4자리 이하는 번호 끝, 더 길면 번호 앞.
  const digits = filters.q.replace(/[^0-9]/g, "");
  if (digits) {
    request = request.like(
      "phone",
      digits.length <= 4 ? `%${digits}` : `${digits}%`,
    );
  }

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
