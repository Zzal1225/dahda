import { NextResponse, type NextRequest } from "next/server";
import { listMessageEvents } from "@/features/messages/message-events-query";
import { requireRole } from "@/server/auth/requireRole";
import { createSupabaseServerClient } from "@/server/supabase/server";

/** 수신자 기록. 범위는 RLS가 정한다. 다른 지점 메시지 id면 빈 배열이고, 있는지 없는지도 드러나지 않는다. */
export async function GET(
  _request: NextRequest,
  context: RouteContext<"/api/messages/[id]/events">,
) {
  await requireRole(["hq", "branch"]);

  const { id } = await context.params;
  // 메시지 id는 bigint다. 숫자가 아니면 DB까지 보내지 않는다.
  if (!/^[1-9][0-9]{0,15}$/.test(id)) {
    return NextResponse.json({ error: "invalid_id" }, { status: 400 });
  }

  const supabase = await createSupabaseServerClient();
  return NextResponse.json(await listMessageEvents(supabase, Number(id)));
}
