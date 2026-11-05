"use server";

import { randomUUID } from "node:crypto";
import { formatWon } from "@/lib/format";
import { requireRole } from "@/server/auth/requireRole";
import { tossClientKey } from "@/server/providers/toss/toss-config";
import { createSupabaseAdminClient } from "@/server/supabase/admin";
import { chargeAmountSchema, newOrderId } from "./charge-schema";

export type StartedCharge = {
  clientKey: string;
  customerKey: string;
  orderId: string;
  orderName: string;
  amount: number;
};

/**
 * 결제창을 열기 전에 금액을 DB에 먼저 적는다. 돌아온 금액은 이 값과 대조한다.
 * 계정은 입력으로 받지 않고 세션에서 읽는다. 그래서 충전은 항상 계정 주인 자신의 잔액에만 들어간다.
 */
export async function startCharge(
  input: unknown,
): Promise<StartedCharge | { error: string }> {
  const member = await requireRole(["hq", "branch"]);
  const clientKey = tossClientKey();
  if (!clientKey) return { error: "지금은 충전할 수 없어요" };

  const amount = chargeAmountSchema.safeParse(input);
  if (!amount.success) return { error: "충전 금액을 선택해 주세요" };

  const orderId = newOrderId(randomUUID());
  const { error } = await createSupabaseAdminClient().from("payments").insert({
    org_id: member.orgId,
    branch_id: member.branchId,
    requested_by: member.userId,
    order_id: orderId,
    amount: amount.data,
  });
  if (error) return { error: "결제를 시작하지 못했어요" };

  return {
    clientKey,
    // 토스 규칙은 추측하기 어려운 22~50자다. 사용자 id(uuid)가 맞다. 이메일이나 전화번호는 쓰지 않는다.
    customerKey: member.userId,
    orderId,
    orderName: `dahda 충전금 ${formatWon(amount.data)}`,
    amount: amount.data,
  };
}
