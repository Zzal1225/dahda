import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/server/db/database.types";
import type {
  TossClient,
  TossPayment,
} from "@/server/providers/toss/toss-client";

type Db = SupabaseClient<Database>;

/** pending: 승인됐는지 아직 모른다. 실패로 확정하지 않고 웹훅이 마무리하게 둔다. */
export type ChargeOutcome = "done" | "pending" | "failed" | "canceled";

const FAILED_STATUSES = new Set(["ABORTED", "EXPIRED"]);
const ALREADY_PROCESSED = "ALREADY_PROCESSED_PAYMENT";

/** ready에서만 실패로 바꾼다. 웹훅이 먼저 done으로 만든 결제를 되돌리지 않는다. */
async function markFailed(supabase: Db, orderId: string): Promise<void> {
  await supabase
    .from("payments")
    .update({ status: "failed" })
    .eq("order_id", orderId)
    .eq("status", "ready");
}

/** 토스가 알려 준 결제 상태를 우리 기록에 반영한다. 리다이렉트와 웹훅이 이 함수 하나를 쓴다. */
export async function applyTossPayment(
  supabase: Db,
  payment: TossPayment,
  expected: { orderId: string; amount: number },
): Promise<ChargeOutcome> {
  if (payment.orderId !== expected.orderId) return "failed";
  if (FAILED_STATUSES.has(payment.status)) {
    await markFailed(supabase, expected.orderId);
    return "failed";
  }
  if (payment.status !== "DONE") return "pending";
  if (payment.totalAmount !== expected.amount) {
    // 승인 전에 대조했으므로 나오면 안 되는 경우다. 잔액을 늘리지 않고 사람이 보도록 남긴다.
    console.error("토스 승인 금액 불일치", expected.orderId);
    await markFailed(supabase, expected.orderId);
    return "failed";
  }

  const { error } = await supabase.rpc("confirm_payment", {
    p_order_id: expected.orderId,
    p_payment_key: payment.paymentKey,
    p_amount: expected.amount,
    p_approved_at: payment.approvedAt ?? new Date().toISOString(),
  });
  if (!error) return "done";
  if (error.code === "DH021") return "canceled";
  // 승인은 됐는데 기록이 실패했다. 실패로 보여 주면 다시 결제하게 되므로 대기로 두고 웹훅에 맡긴다.
  console.error("충전 기록 실패", expected.orderId, error.code);
  return "pending";
}

async function lookup(
  toss: TossClient,
  supabase: Db,
  paymentKey: string,
  expected: { orderId: string; amount: number },
): Promise<ChargeOutcome> {
  const result = await toss.getPayment(paymentKey);
  return result.kind === "ok"
    ? applyTossPayment(supabase, result.payment, expected)
    : "pending";
}

/**
 * 결제창에서 돌아온 요청 처리. account는 세션에서 읽은 값이다.
 * 주소의 금액은 사용자가 고칠 수 있으므로 DB 금액과 다르면 토스를 부르지 않는다.
 */
export async function confirmCharge(options: {
  supabase: Db;
  toss: TossClient;
  account: { orgId: string; branchId: string | null };
  paymentKey: string;
  orderId: string;
  amount: number;
}): Promise<ChargeOutcome> {
  const { supabase, toss, account, paymentKey, orderId, amount } = options;

  const query = supabase
    .from("payments")
    .select("order_id, amount, status")
    .eq("order_id", orderId)
    .eq("org_id", account.orgId);
  const { data: row, error } = await (
    account.branchId
      ? query.eq("branch_id", account.branchId)
      : query.is("branch_id", null)
  ).maybeSingle();
  if (error) return "pending";
  if (!row) return "failed"; // 없는 주문이거나 다른 계정의 주문이다.

  // 새로고침으로 다시 들어온 경우. 토스를 다시 부르지 않는다.
  if (row.status === "done") return "done";
  if (row.status === "canceled") return "canceled";

  if (row.amount !== amount) {
    await markFailed(supabase, orderId);
    return "failed";
  }

  const expected = { orderId, amount: row.amount };
  const result = await toss.confirm(
    { paymentKey, orderId, amount: row.amount },
    // 주문번호를 멱등 키로 쓴다. 같은 주문의 재시도는 같은 응답을 받고 두 번 승인되지 않는다.
    orderId,
  );
  if (result.kind === "ok") {
    return applyTossPayment(supabase, result.payment, expected);
  }
  if (result.kind === "rejected" && result.code !== ALREADY_PROCESSED) {
    await markFailed(supabase, orderId);
    return "failed";
  }
  // 응답이 끊겼거나 이미 처리된 결제다. 짐작하지 않고 토스에 현재 상태를 묻는다.
  return lookup(toss, supabase, paymentKey, expected);
}

/**
 * 웹훅 처리. 본문의 상태와 금액을 믿지 않고 조회 API 결과로 정한다.
 * 그래서 서명이 없거나 위조돼도 토스에 실제로 승인된 결제가 아니면 충전되지 않는다.
 */
export async function syncFromWebhook(options: {
  supabase: Db;
  toss: TossClient;
  paymentKey: string;
}): Promise<"applied" | "pending" | "failed" | "unknown_order" | "retry"> {
  const { supabase, toss, paymentKey } = options;
  const result = await toss.getPayment(paymentKey);
  if (result.kind === "unknown") return "retry";
  if (result.kind === "rejected") return "failed";

  const { data: row, error } = await supabase
    .from("payments")
    .select("order_id, amount")
    .eq("order_id", result.payment.orderId)
    .maybeSingle();
  if (error) return "retry";
  // 체험 계정이 지워졌거나 우리 주문이 아니다. 재시도해도 같으므로 받은 것으로 끝낸다.
  if (!row) return "unknown_order";

  const outcome = await applyTossPayment(supabase, result.payment, {
    orderId: row.order_id,
    amount: row.amount,
  });
  if (outcome === "done") return "applied";
  // 승인됐는데 기록이 실패했다면 재시도가 복구한다. 진행 중 상태면 다음 이벤트를 기다린다.
  if (outcome === "pending") {
    return result.payment.status === "DONE" ? "retry" : "pending";
  }
  return "failed";
}
