import { NextResponse, type NextRequest } from "next/server";
import {
  listMessages,
  parseMessageQuery,
} from "@/features/messages/message-query";
import { PUBLIC_SAMPLE_CAMPAIGN_ID } from "@/features/messages/public-sample";
import { requireRole } from "@/server/auth/requireRole";
import { createSupabaseAdminClient } from "@/server/supabase/admin";

/**
 * 공용 샘플 표의 조회 경로. 샘플 조직에는 구성원이 없어 RLS로는 읽을 수 없으므로 RLS를 건너뛰는 클라이언트를 쓴다.
 * 그래서 발송 건 id를 입력으로 받지 않고 고정한다. 입력을 믿으면 이 경로로 남의 발송 내역을 읽을 수 있다.
 */
export async function GET(request: NextRequest) {
  await requireRole(["hq", "branch"]);

  const parsed = parseMessageQuery(request.nextUrl.searchParams, {
    campaignId: PUBLIC_SAMPLE_CAMPAIGN_ID,
  });
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_query" }, { status: 400 });
  }
  return NextResponse.json(
    await listMessages(createSupabaseAdminClient(), parsed.data),
  );
}
