import { NextResponse, type NextRequest } from "next/server";
import { requireRole } from "@/server/auth/requireRole";
import { confirmCharge } from "@/server/payments/settle-payment";
import { tossClient } from "@/server/providers/toss/toss-config";
import { createSupabaseAdminClient } from "@/server/supabase/admin";

/**
 * 결제창의 successUrl. 토스가 브라우저를 GET으로 돌려보내므로 POST로 만들 수 없다.
 * 새로고침으로 다시 와도 confirmCharge가 완료된 주문을 다시 승인하지 않는다.
 * 결과는 주소 값으로만 넘긴다. 잔액과 거래 내역은 화면이 DB에서 다시 읽는다.
 */
export async function GET(request: NextRequest) {
  const member = await requireRole(["hq", "branch"]);
  const { searchParams } = request.nextUrl;
  // 상대 경로로 보낸다. 서버가 아는 호스트가 브라우저 주소와 다르면 세션 쿠키가 빠져 로그인으로 튕긴다.
  const back = (result: string) =>
    new NextResponse(null, {
      status: 303,
      headers: { Location: `/billing?result=${result}` },
    });

  const toss = tossClient();
  const paymentKey = searchParams.get("paymentKey");
  const orderId = searchParams.get("orderId");
  const amount = Number(searchParams.get("amount"));
  if (!toss || !paymentKey || !orderId || !Number.isInteger(amount)) {
    return back("failed");
  }

  const outcome = await confirmCharge({
    supabase: createSupabaseAdminClient(),
    toss,
    // 주소가 아니라 세션의 계정이다. 다른 지점의 주문번호를 넣어도 찾지 못한다.
    account: { orgId: member.orgId, branchId: member.branchId },
    paymentKey,
    orderId,
    amount,
  });
  return back(outcome === "canceled" ? "failed" : outcome);
}
