import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { loadRecentMessages } from "@/features/contacts/recent-messages-query";
import { requireRole } from "@/server/auth/requireRole";
import { createSupabaseServerClient } from "@/server/supabase/server";

const idSchema = z.uuid();

/** 연락처 상세(드로어)의 최근 받은 문자. 범위는 RLS가 정한다. 볼 수 없는 연락처면 404다. */
export async function GET(
  _request: NextRequest,
  context: RouteContext<"/api/contacts/[id]/messages">,
) {
  await requireRole(["hq", "branch"]);

  const { id } = await context.params;
  if (!idSchema.safeParse(id).success) {
    return NextResponse.json({ error: "invalid_id" }, { status: 400 });
  }

  const supabase = await createSupabaseServerClient();
  const messages = await loadRecentMessages(supabase, id);
  if (!messages) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  return NextResponse.json(messages, {
    // 개인정보가 담긴 응답이다. 브라우저·CDN에 남기지 않는다.
    headers: { "Cache-Control": "no-store" },
  });
}
