import { NextResponse, type NextRequest } from "next/server";
import {
  listMessages,
  messageQuerySchema,
} from "@/features/messages/message-query";
import { requireRole } from "@/server/auth/requireRole";
import { createSupabaseServerClient } from "@/server/supabase/server";

/**
 * 표가 페이지를 넘길 때 부르는 조회 경로. 브라우저가 DB를 직접 부르지 않게 서버를 거친다.
 * 지점 범위는 여기서 판단하지 않는다. 사용자 권한 클라이언트를 쓰므로 RLS가 다른 지점의 행을 숨긴다.
 */
export async function GET(request: NextRequest) {
  await requireRole(["hq", "branch"]);

  const params = request.nextUrl.searchParams;
  const parsed = messageQuerySchema.safeParse({
    campaignId: params.get("campaignId"),
    status: params.getAll("status"),
    q: params.get("q") ?? undefined,
    offset: params.get("offset") ?? undefined,
    limit: params.get("limit") ?? undefined,
    withTotal: params.get("withTotal") === "1",
  });
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_query" }, { status: 400 });
  }

  const supabase = await createSupabaseServerClient();
  return NextResponse.json(await listMessages(supabase, parsed.data));
}
