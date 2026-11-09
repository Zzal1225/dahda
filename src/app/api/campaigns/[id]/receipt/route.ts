import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { loadCampaignReceipt } from "@/features/campaigns/receipt-query";
import { requireRole } from "@/server/auth/requireRole";
import { createSupabaseServerClient } from "@/server/supabase/server";

const idSchema = z.uuid();

/**
 * 도착 확인증 집계. 범위는 RLS가 정한다. 다른 지점 발송 건이면 404이고, 있는지 없는지도 드러나지 않는다.
 * 브라우저에서 메시지 행을 모아 세지 않는 이유: 수신자가 많으면 수천 행을 내려받아야 하고, 표가 받은 페이지만으로는 셀 수 없다.
 */
export async function GET(
  _request: NextRequest,
  context: RouteContext<"/api/campaigns/[id]/receipt">,
) {
  await requireRole(["hq", "branch"]);

  const { id } = await context.params;
  // uuid가 아니면 DB까지 보내지 않는다. 보내면 형 변환 오류가 500으로 보인다.
  if (!idSchema.safeParse(id).success) {
    return NextResponse.json({ error: "invalid_id" }, { status: 400 });
  }

  const supabase = await createSupabaseServerClient();
  const receipt = await loadCampaignReceipt(supabase, id);
  if (!receipt) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  return NextResponse.json(receipt);
}
