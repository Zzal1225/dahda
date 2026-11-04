import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/server/db/database.types";

export type ApprovalRow = {
  id: string;
  branchId: string | null;
  branchName: string;
  body: string;
  kind: "sms" | "lms";
  recipientCount: number;
  estimatedCost: number;
  scheduledAt: string | null;
  requestedAt: string | null;
  senderPhone: string | null;
};

const COLUMNS =
  "id, branch_id, body, kind, recipient_count, estimated_cost, scheduled_at, requested_at, sender_phone, branches(name)";

type Row = {
  id: string;
  branch_id: string | null;
  body: string;
  kind: "sms" | "lms";
  recipient_count: number;
  estimated_cost: number;
  scheduled_at: string | null;
  requested_at: string | null;
  sender_phone: string | null;
  branches: { name: string } | null;
};

function toApproval(row: Row): ApprovalRow {
  return {
    id: row.id,
    branchId: row.branch_id,
    branchName: row.branches?.name ?? "본사",
    body: row.body,
    kind: row.kind,
    recipientCount: row.recipient_count,
    estimatedCost: row.estimated_cost,
    scheduledAt: row.scheduled_at,
    requestedAt: row.requested_at,
    senderPhone: row.sender_phone,
  };
}

/** 오래 기다린 요청부터 보여 준다. 사용자 권한으로 읽어 다른 본사의 요청은 보이지 않는다. */
export async function listApprovals(
  supabase: SupabaseClient<Database>,
): Promise<ApprovalRow[]> {
  const { data, error } = await supabase
    .from("campaigns")
    .select(COLUMNS)
    .eq("status", "pending_approval")
    .order("requested_at")
    .order("id");
  if (error) throw new Error(`승인 대기 조회 실패: ${error.message}`);
  return data.map(toApproval);
}

export async function getApproval(
  supabase: SupabaseClient<Database>,
  id: string,
): Promise<(ApprovalRow & { balance: number }) | null> {
  const { data, error } = await supabase
    .from("campaigns")
    .select(COLUMNS)
    .eq("id", id)
    .eq("status", "pending_approval")
    .maybeSingle();
  if (error) throw new Error(`승인 요청 조회 실패: ${error.message}`);
  if (!data) return null;

  const row = toApproval(data);
  const balances = supabase.from("account_balances").select("balance");
  // uuid 열에 null을 eq로 넘기면 조회 오류다. 본사 계정은 is로 찾는다.
  const balance = await (
    row.branchId
      ? balances.eq("branch_id", row.branchId)
      : balances.is("branch_id", null)
  ).maybeSingle();
  if (balance.error)
    throw new Error(`잔액 조회 실패: ${balance.error.message}`);
  return { ...row, balance: balance.data?.balance ?? 0 };
}

export async function countApprovals(
  supabase: SupabaseClient<Database>,
): Promise<number> {
  const { count, error } = await supabase
    .from("campaigns")
    .select("id", { count: "exact", head: true })
    .eq("status", "pending_approval");
  if (error) throw new Error(`승인 대기 조회 실패: ${error.message}`);
  return count ?? 0;
}
