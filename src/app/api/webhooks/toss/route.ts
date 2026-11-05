import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { syncFromWebhook } from "@/server/payments/settle-payment";
import {
  tossClient,
  tossWebhookSecret,
} from "@/server/providers/toss/toss-config";
import { verifyTossSignature } from "@/server/providers/toss/toss-webhook";
import { createSupabaseAdminClient } from "@/server/supabase/admin";

const MAX_BODY_BYTES = 256 * 1024;

const eventSchema = z.object({
  eventType: z.string(),
  data: z.object({ paymentKey: z.string().min(1) }).optional(),
});

/**
 * 리다이렉트가 끊겼을 때 충전을 마무리하는 보조 경로.
 * 순서: 서명 확인 → 원문 저장 → 조회 API로 확정. 처리에 실패해도 원문은 남는다.
 */
export async function POST(request: NextRequest) {
  const toss = tossClient();
  if (!toss) {
    return NextResponse.json({ error: "not_configured" }, { status: 404 });
  }

  const rawBody = await request.text();
  if (new TextEncoder().encode(rawBody).length > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "too_large" }, { status: 413 });
  }

  const signature = verifyTossSignature(
    rawBody,
    request.headers,
    tossWebhookSecret(),
  );
  const supabase = createSupabaseAdminClient();
  const { data: saved, error: saveError } = await supabase
    .from("webhook_events")
    .insert({
      provider: "toss",
      raw_body: rawBody,
      signature_valid: signature === "valid",
      process_result: signature === "invalid" ? "invalid_signature" : null,
      processed_at: signature === "invalid" ? new Date().toISOString() : null,
    })
    .select("id")
    .single();
  // 원문을 못 남기면 처리하지 않는다. 5xx를 돌려주면 토스가 다시 보낸다.
  if (saveError) return new NextResponse(null, { status: 500 });
  if (signature === "invalid") return new NextResponse(null, { status: 401 });

  const finish = async (result: string, status: number) => {
    await supabase
      .from("webhook_events")
      .update({
        process_result: result,
        processed_at: new Date().toISOString(),
      })
      .eq("id", saved.id);
    return new NextResponse(null, { status });
  };

  let event: z.infer<typeof eventSchema>;
  try {
    event = eventSchema.parse(JSON.parse(rawBody));
  } catch {
    return finish("parse_error", 400);
  }
  if (event.eventType !== "PAYMENT_STATUS_CHANGED" || !event.data) {
    return finish("ignored", 200);
  }

  const result = await syncFromWebhook({
    supabase,
    toss,
    paymentKey: event.data.paymentKey,
  });
  return finish(result, result === "retry" ? 500 : 200);
}
