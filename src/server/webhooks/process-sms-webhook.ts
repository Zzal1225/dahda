import type { SupabaseClient } from "@supabase/supabase-js";
import {
  transitionMessage,
  type MessageEvent,
  type MessageState,
} from "@/features/campaigns/status";
import type { Database } from "@/server/db/database.types";
import type {
  SmsProvider,
  WebhookEvent,
  WebhookRequest,
} from "@/server/providers/sms-provider";
import {
  createSupabaseQueueStore,
  settleCampaigns,
} from "@/server/queue/supabase-store";

/**
 * 순서: 서명 검증 → 원문 저장 → 상태 전이 → 완료 정산. 집계는 DB 트리거가 한다.
 *
 * 원문을 전이보다 먼저 저장하는 이유: 처리 코드에 버그가 있어도 업체가 보낸 사실이 남아 나중에 다시 맞출 수 있다.
 * 서명이 틀린 요청도 남긴다. 키 불일치나 위조 시도를 추적하려면 기록이 있어야 한다.
 */

const CONFLICT_RETRIES = 3;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * - 상태 전이 결과: applied, recorded_late, ignored_final, ignored_stale
 * - unknown_message: 우리 메시지가 아니거나 체험 계정 삭제 등으로 사라진 메시지
 * - provider_mismatch: 다른 업체의 메시지를 고치려는 요청
 */
type EventResult =
  | ReturnType<typeof transitionMessage>["outcome"]
  | "unknown_message"
  | "provider_mismatch";

type Db = SupabaseClient<Database>;

export async function processSmsWebhook(options: {
  provider: SmsProvider;
  request: WebhookRequest;
  supabase: Db;
}): Promise<{ status: number }> {
  const { provider, request, supabase } = options;

  const valid = await provider.verifySignature(request).catch(() => false);

  const { data: saved, error: saveError } = await supabase
    .from("webhook_events")
    .insert({
      provider: provider.name,
      raw_body: request.rawBody,
      signature_valid: valid,
      process_result: valid ? null : "invalid_signature",
      processed_at: valid ? null : new Date().toISOString(),
    })
    .select("id")
    .single();
  // 원문을 못 남기면 처리하지 않는다. 5xx를 돌려주면 업체가 다시 보내므로 사실이 사라지지 않는다.
  if (saveError) return { status: 500 };
  if (!valid) return { status: 401 };

  const finish = (result: string, error?: string) =>
    supabase
      .from("webhook_events")
      .update({
        process_result: result,
        error: error ?? null,
        processed_at: new Date().toISOString(),
      })
      .eq("id", saved.id);

  let events: WebhookEvent[];
  try {
    events = provider.parseWebhook(request);
  } catch (cause) {
    // 같은 내용을 다시 받아도 또 실패하므로 재시도를 유도하지 않는다.
    await finish("parse_error", String(cause).slice(0, 500));
    return { status: 400 };
  }

  try {
    const results = new Set<EventResult>();
    const campaignIds = new Set<string>();
    for (const event of events) {
      const { result, campaignId } = await applyEvent(
        supabase,
        provider.name,
        event,
      );
      results.add(result);
      if (campaignId) campaignIds.add(campaignId);
    }
    // 중복 웹훅이어도 부른다. 앞선 처리가 정산 직전에 끊겼다면 재전송이 마무리해야 한다.
    await settleCampaigns(supabase, [...campaignIds]);
    await finish([...results].join(",") || "empty");
    return { status: 200 };
  } catch (cause) {
    await finish("error", String(cause).slice(0, 500));
    return { status: 500 };
  }
}

async function applyEvent(
  supabase: Db,
  providerName: string,
  event: WebhookEvent,
): Promise<{ result: EventResult; campaignId: string | null }> {
  const store = createSupabaseQueueStore(supabase);
  const messageEvent: MessageEvent =
    event.status === "delivered"
      ? {
          type: "delivered",
          providerMessageId: event.providerMessageId,
          at: event.occurredAt,
        }
      : {
          type: "failed",
          providerMessageId: event.providerMessageId,
          failCode: event.failCode,
          at: event.occurredAt,
        };

  for (let round = 0; round < CONFLICT_RETRIES; round += 1) {
    const row = await findMessage(supabase, providerName, event);
    if (!row) return { result: "unknown_message", campaignId: null };
    if (row.provider !== null && row.provider !== providerName) {
      return { result: "provider_mismatch", campaignId: null };
    }

    const state: MessageState = {
      status: row.status,
      providerMessageId: row.provider_message_id,
      failCode: row.fail_code,
      sentAt: row.sent_at ? new Date(row.sent_at) : null,
      finalizedAt: row.finalized_at ? new Date(row.finalized_at) : null,
    };
    const transition = transitionMessage(state, messageEvent);
    if (
      transition.outcome === "ignored_final" ||
      transition.outcome === "ignored_stale"
    ) {
      return { result: transition.outcome, campaignId: row.campaign_id };
    }

    const applied = await store.applyUpdates([
      {
        id: row.id,
        expectedStatus: state.status,
        state: transition.state,
        provider: providerName,
      },
    ]);
    if (applied.length > 0) {
      return { result: transition.outcome, campaignId: row.campaign_id };
    }
    // 그 사이 워커나 다른 웹훅이 먼저 바꿨다. 다시 읽어 판단한다.
  }
  throw new Error(`상태 저장 경합이 계속된다: ${event.providerMessageId}`);
}

async function findMessage(
  supabase: Db,
  providerName: string,
  event: WebhookEvent,
) {
  const columns =
    "id, campaign_id, status, provider, provider_message_id, fail_code, sent_at, finalized_at";
  // 멱등 키를 먼저 본다. 웹훅이 워커의 저장보다 먼저 오면 아직 업체 id가 행에 없다.
  // uuid 열에 형식이 틀린 값을 넘기면 쿼리 오류가 되므로 먼저 거른다.
  const query =
    event.idempotencyKey && UUID.test(event.idempotencyKey)
      ? supabase
          .from("messages")
          .select(columns)
          .eq("idempotency_key", event.idempotencyKey)
      : supabase
          .from("messages")
          .select(columns)
          .eq("provider", providerName)
          .eq("provider_message_id", event.providerMessageId);
  const { data, error } = await query.maybeSingle();
  if (error) throw new Error(`메시지 조회 실패: ${error.message}`);
  return data;
}
