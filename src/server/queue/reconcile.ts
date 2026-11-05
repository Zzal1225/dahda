import {
  transitionMessage,
  type MessageEvent,
  type MessageState,
} from "../../features/campaigns/status.ts";
import type { SmsProvider } from "../providers/sms-provider.ts";
import type { MessageUpdate, QueueStore } from "./worker.ts";

/** 조회해도 결과가 없는 메시지를 포기할 때 쓰는 우리 쪽 실패 코드. */
export const RESULT_TIMEOUT_CODE = "RESULT_TIMEOUT";

export const DEFAULT_STALE_AFTER_MS = 60 * 60 * 1000;
// 확인 필요: 솔라피 문서에 통신사 결과의 최대 대기 시간이 없다. 체험 데이터 보존과 같은 3일로 두고 환경 변수로 바꿀 수 있게 했다.
export const DEFAULT_RESULT_TIMEOUT_MS = 72 * 60 * 60 * 1000;
export const DEFAULT_RECONCILE_LIMIT = 500;

export type StaleMessage = {
  id: number;
  campaignId: string;
  provider: string;
  providerMessageId: string;
  state: MessageState;
};

export interface ReconcileStore extends Pick<
  QueueStore,
  "applyUpdates" | "settleCampaigns"
> {
  listStaleSent(
    sentBefore: Date,
    limit: number,
  ): Promise<readonly StaleMessage[]>;
}

export type ReconcileSummary = {
  checked: number;
  delivered: number;
  failed: number;
  timedOut: number;
  pending: number;
  lookupFailed: number;
};

/**
 * 웹훅을 놓친 메시지를 업체 조회로 맞춘다. 웹훅과 같은 전이 함수를 써서, 그 사이 웹훅이 먼저 오면 조건부 저장에서 걸러진다.
 *
 * 조회 자체가 실패하면 시간이 지났어도 포기하지 않는다. 업체 장애를 "결과 없음"으로 읽으면
 * 실제로 도착한 문자를 실패로 확정하고 환불하게 된다.
 */
export async function runReconcileTick(options: {
  store: ReconcileStore;
  providerFor: (name: string) => SmsProvider | null;
  now?: () => Date;
  staleAfterMs?: number;
  resultTimeoutMs?: number;
  limit?: number;
}): Promise<ReconcileSummary> {
  const { store, providerFor } = options;
  const now = options.now?.() ?? new Date();
  const timeoutMs = options.resultTimeoutMs ?? DEFAULT_RESULT_TIMEOUT_MS;
  const stale = await store.listStaleSent(
    new Date(now.getTime() - (options.staleAfterMs ?? DEFAULT_STALE_AFTER_MS)),
    options.limit ?? DEFAULT_RECONCILE_LIMIT,
  );

  const summary: ReconcileSummary = {
    checked: stale.length,
    delivered: 0,
    failed: 0,
    timedOut: 0,
    pending: 0,
    lookupFailed: 0,
  };

  const byProvider = new Map<string, StaleMessage[]>();
  for (const message of stale) {
    const group = byProvider.get(message.provider) ?? [];
    group.push(message);
    byProvider.set(message.provider, group);
  }

  const updates: MessageUpdate[] = [];
  const campaignOf = new Map<number, string>();

  for (const [name, messages] of byProvider) {
    let results;
    try {
      // 키가 없어 발송기를 만들지 못하는 경우도 조회 실패로 다룬다. 한 업체 문제로 작업 전체가 멈추면 안 된다.
      const lookup = providerFor(name)?.fetchResults;
      if (!lookup) throw new Error(`${name} 발송기에 조회 기능이 없다`);
      results = await lookup(messages.map((m) => m.providerMessageId));
    } catch (error) {
      console.error("결과 조회 실패", name, error);
      summary.lookupFailed += messages.length;
      continue;
    }
    const resultOf = new Map(results.map((r) => [r.providerMessageId, r]));

    for (const message of messages) {
      const result = resultOf.get(message.providerMessageId);
      let event: MessageEvent | null = null;
      if (result?.status === "delivered") {
        event = {
          type: "delivered",
          providerMessageId: message.providerMessageId,
          at: result.occurredAt ?? now,
        };
        summary.delivered += 1;
      } else if (result?.status === "failed") {
        event = {
          type: "failed",
          providerMessageId: message.providerMessageId,
          failCode: result.failCode,
          at: result.occurredAt ?? now,
        };
        summary.failed += 1;
      } else if (
        message.state.sentAt &&
        now.getTime() - message.state.sentAt.getTime() >= timeoutMs
      ) {
        event = {
          type: "failed",
          providerMessageId: message.providerMessageId,
          failCode: RESULT_TIMEOUT_CODE,
          at: now,
        };
        summary.timedOut += 1;
      } else {
        summary.pending += 1;
      }
      if (!event) continue;

      updates.push({
        id: message.id,
        expectedStatus: "sent",
        state: transitionMessage(message.state, event).state,
        provider: name,
      });
      campaignOf.set(message.id, message.campaignId);
    }
  }

  if (updates.length === 0) return summary;
  const applied = await store.applyUpdates(updates);
  await store.settleCampaigns([
    ...new Set(
      applied.flatMap((id) => {
        const campaign = campaignOf.get(id);
        return campaign ? [campaign] : [];
      }),
    ),
  ]);
  return summary;
}
