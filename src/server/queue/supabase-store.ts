import type { SupabaseClient } from "@supabase/supabase-js";
import { transitionCampaign } from "../../features/campaigns/status.ts";
import type { MessageState } from "../../features/campaigns/status.ts";
import type { Database } from "../db/database.types.ts";
import type { MessageEventLog } from "./event-log.ts";
import type { ReconcileStore } from "./reconcile.ts";
import type { MessageUpdate, QueueStore } from "./worker.ts";

const toIso = (value: Date | null | undefined) => value?.toISOString() ?? null;
const toDate = (value: string | null) => (value ? new Date(value) : null);

/**
 * 모든 메시지가 확정된 발송 건을 완료한다. 워커와 웹훅이 함께 쓴다.
 * 판단은 status.ts, 상태와 환불을 한 트랜잭션에 묶는 일은 complete_campaign이 한다.
 */
export async function settleCampaigns(
  supabase: SupabaseClient<Database>,
  ids: readonly string[],
): Promise<void> {
  if (ids.length === 0) return;
  const { data, error } = await supabase
    .from("campaigns")
    .select("id, status, recipient_count, delivered_count, failed_count")
    .in("id", [...ids]);
  if (error) throw new Error(`발송 건 조회 실패: ${error.message}`);

  for (const campaign of data) {
    const transition = transitionCampaign(campaign.status, {
      type: "complete",
      recipientCount: campaign.recipient_count,
      deliveredCount: campaign.delivered_count,
      failedCount: campaign.failed_count,
    });
    if (!transition.ok) continue; // 아직 남았거나 이미 끝난 건이다.
    const { error: completeError } = await supabase.rpc("complete_campaign", {
      p_campaign_id: campaign.id,
    });
    if (completeError) {
      throw new Error(`완료 처리 실패: ${completeError.message}`);
    }
  }
}

/** 워커·웹훅·조회가 함께 쓴다. 범위(org·지점)는 DB 함수가 메시지에서 읽는다. */
export async function recordMessageEvents(
  supabase: SupabaseClient<Database>,
  events: readonly MessageEventLog[],
): Promise<void> {
  if (events.length === 0) return;
  const { error } = await supabase.rpc("record_message_events", {
    p_events: events.map((event) => ({
      message_id: event.messageId,
      source: event.source,
      kind: event.kind,
      outcome: event.outcome,
      fail_code: event.failCode,
      occurred_at: event.occurredAt.toISOString(),
    })),
  });
  if (error) throw new Error(`메시지 기록 실패: ${error.message}`);
}

/**
 * DB 열 이름과 TS 타입의 변환은 이 경계에서 한 번만 한다(CLAUDE.md).
 * supabase-js는 타입만 가져온다. 실제 클라이언트는 Next.js와 Deno가 각자 만들어 넘긴다.
 */
export function createSupabaseQueueStore(
  supabase: SupabaseClient<Database>,
): QueueStore & ReconcileStore {
  return {
    async listStaleSent(sentBefore, limit) {
      const { data, error } = await supabase
        .from("messages")
        .select(
          "id, campaign_id, provider, provider_message_id, status, fail_code, sent_at, finalized_at",
        )
        .eq("status", "sent")
        // 조회 API가 있는 업체만이다. 부분 인덱스와 같은 조건이라 큰 표를 훑지 않는다.
        .eq("provider", "solapi")
        .not("provider_message_id", "is", null)
        .lt("sent_at", sentBefore.toISOString())
        .order("sent_at")
        .limit(limit);
      if (error) throw new Error(`멈춘 메시지 조회 실패: ${error.message}`);
      return data.map((row) => ({
        id: row.id,
        campaignId: row.campaign_id,
        provider: row.provider ?? "",
        providerMessageId: row.provider_message_id ?? "",
        state: {
          status: row.status,
          providerMessageId: row.provider_message_id,
          failCode: row.fail_code,
          sentAt: toDate(row.sent_at),
          finalizedAt: toDate(row.finalized_at),
        },
      }));
    },

    async claim(limit, leaseSeconds) {
      const { data, error } = await supabase.rpc("claim_messages", {
        p_limit: limit,
        p_lease_seconds: leaseSeconds,
      });
      if (error) throw new Error(`큐 집기 실패: ${error.message}`);
      return data.map((row) => ({
        id: row.id,
        campaignId: row.campaign_id,
        campaignStatus: row.campaign_status,
        phone: row.phone,
        idempotencyKey: row.idempotency_key,
        attemptCount: row.attempt_count,
        body: row.body,
        kind: row.kind,
        senderPhone: row.sender_phone,
        isAd: row.is_ad,
        isTrial: row.is_trial,
        isRealDemo: row.is_real_demo,
      }));
    },

    async startCampaigns(ids) {
      const next = transitionCampaign("scheduled", { type: "start_sending" });
      if (!next.ok) throw new Error("발송 시작 전이가 막혀 있다");
      // 시작 시각을 덮어쓰지 않도록 예약 상태인 건만 바꾼다.
      const { error } = await supabase
        .from("campaigns")
        .update({ status: next.status, started_at: new Date().toISOString() })
        .in("id", [...ids])
        .eq("status", "scheduled");
      if (error) throw new Error(`발송 시작 실패: ${error.message}`);
    },

    async applyUpdates(updates: readonly MessageUpdate[]) {
      const { data, error } = await supabase.rpc("apply_message_updates", {
        p_updates: updates.map((update) => ({
          id: update.id,
          expected_status: update.expectedStatus,
          status: update.state.status,
          provider: update.provider,
          provider_message_id: update.state.providerMessageId,
          fail_code: update.state.failCode,
          sent_at: toIso(update.state.sentAt),
          finalized_at: toIso(update.state.finalizedAt),
          next_attempt_at: toIso(update.nextAttemptAt),
          attempt_count: update.attemptCount ?? null,
        })),
      });
      if (error) throw new Error(`결과 저장 실패: ${error.message}`);
      return data;
    },

    settleCampaigns: (ids) => settleCampaigns(supabase, ids),

    recordEvents: (events) => recordMessageEvents(supabase, events),

    async readStates(ids) {
      const { data, error } = await supabase
        .from("messages")
        .select(
          "id, status, provider_message_id, fail_code, sent_at, finalized_at",
        )
        .in("id", [...ids]);
      if (error) throw new Error(`메시지 조회 실패: ${error.message}`);
      return new Map(
        data.map((row): [number, MessageState] => [
          row.id,
          {
            status: row.status,
            providerMessageId: row.provider_message_id,
            failCode: row.fail_code,
            sentAt: toDate(row.sent_at),
            finalizedAt: toDate(row.finalized_at),
          },
        ]),
      );
    },
  };
}
