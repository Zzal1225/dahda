import { NextResponse, type NextRequest } from "next/server";
import {
  campaignQuerySchema,
  listCampaigns,
} from "@/features/campaigns/campaign-query";
import { requireRole } from "@/server/auth/requireRole";
import { createSupabaseServerClient } from "@/server/supabase/server";

export async function GET(request: NextRequest) {
  await requireRole(["hq", "branch"]);

  const params = request.nextUrl.searchParams;
  const parsed = campaignQuerySchema.safeParse({
    from: params.get("from"),
    to: params.get("to"),
    branch: params.get("branch"),
    ad: params.get("ad") ?? undefined,
    kind: params.get("kind") ?? undefined,
    state: params.get("state"),
  });
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_query" }, { status: 400 });
  }

  const supabase = await createSupabaseServerClient();
  return NextResponse.json(await listCampaigns(supabase, parsed.data));
}
