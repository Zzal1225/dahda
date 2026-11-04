import { NextResponse, type NextRequest } from "next/server";
import { webhookProviderFor } from "@/server/providers/webhook-providers";
import { createSupabaseAdminClient } from "@/server/supabase/admin";
import { processSmsWebhook } from "@/server/webhooks/process-sms-webhook";

// 서명 없는 요청도 기록을 남기므로, 크기를 막지 않으면 큰 요청 몇 번으로 DB를 채울 수 있다.
const MAX_BODY_BYTES = 256 * 1024;

export async function POST(
  request: NextRequest,
  context: RouteContext<"/api/webhooks/sms/[provider]">,
) {
  const { provider: name } = await context.params;
  const provider = webhookProviderFor(name);
  if (!provider) {
    return NextResponse.json({ error: "unknown_provider" }, { status: 404 });
  }

  // 원문 그대로 읽는다. JSON으로 풀었다 다시 만들면 공백과 순서가 바뀌어 서명이 맞지 않는다.
  const rawBody = await request.text();
  if (new TextEncoder().encode(rawBody).length > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "too_large" }, { status: 413 });
  }

  const { status } = await processSmsWebhook({
    provider,
    request: { rawBody, headers: request.headers },
    // 호출자는 업체라 세션이 없다. 권한은 서명으로 확인하고, 상태 쓰기는 service_role만 할 수 있다.
    supabase: createSupabaseAdminClient(),
  });
  return new NextResponse(null, { status });
}
