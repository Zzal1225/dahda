import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Database } from "@/server/db/database.types";

export const LEDGER_PAGE_SIZE = 20;

export const billingFiltersSchema = z.object({
  page: z.coerce.number().int().min(1).catch(1),
  branch: z.uuid().optional().catch(undefined),
  result: z.string().optional().catch(undefined),
  code: z.string().optional().catch(undefined),
});
export type BillingFilters = z.output<typeof billingFiltersSchema>;

export type LedgerRow = {
  id: string;
  kind: Database["public"]["Enums"]["ledger_kind"];
  amount: number;
  createdAt: string;
};

/** 사용자 세션 클라이언트로 읽는다. RLS가 다른 지점의 기록을 막는 최종 경계다. */
export async function listLedger(
  supabase: SupabaseClient<Database>,
  account: { orgId: string; branchId: string | null },
  page: number,
): Promise<{ rows: LedgerRow[]; total: number }> {
  const from = (page - 1) * LEDGER_PAGE_SIZE;
  const query = supabase
    .from("ledger_entries")
    .select("id, kind, amount, created_at", { count: "exact" })
    .eq("org_id", account.orgId);
  const { data, count, error } = await (
    account.branchId
      ? query.eq("branch_id", account.branchId)
      : query.is("branch_id", null)
  )
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .range(from, from + LEDGER_PAGE_SIZE - 1);
  if (error) throw new Error(`거래 내역 조회 실패: ${error.message}`);

  return {
    total: count ?? 0,
    rows: (data ?? []).map((row) => ({
      id: String(row.id),
      kind: row.kind,
      amount: row.amount,
      createdAt: row.created_at,
    })),
  };
}
