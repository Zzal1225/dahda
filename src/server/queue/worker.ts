import {
  isNightKst,
  nextAdSendableAt,
} from "../../features/campaigns/ad-hours.ts";
import {
  transitionCampaign,
  transitionMessage,
  type CampaignStatus,
  type MessageEvent,
  type MessageState,
  type MessageStatus,
} from "../../features/campaigns/status.ts";
import type {
  SendRequest,
  SendResult,
  SmsProvider,
} from "../providers/sms-provider.ts";
import { MAX_ATTEMPTS, retryDelayMs } from "./retry.ts";

/**
 * 워커 한 번의 동작. 집기 → 업체 호출 → 결과 저장.
 *
 * DB와 업체를 인터페이스로 받는 이유: 런타임이 Deno(Edge Function)여서 Next.js 코드를 그대로 못 쓰고,
 * 실패·경합 조합을 가짜 구현으로 단위 테스트하려면 호출부가 바깥에 있어야 한다.
 * 이 폴더는 Deno에서도 불러오므로 import에 확장자를 적는다.
 */

export type ClaimedMessage = {
  id: number;
  campaignId: string;
  campaignStatus: CampaignStatus;
  phone: string;
  idempotencyKey: string;
  attemptCount: number;
  body: string;
  kind: "sms" | "lms";
  senderPhone: string;
  isAd: boolean;
  isTrial: boolean;
};

export type MessageUpdate = {
  id: number;
  expectedStatus: MessageStatus;
  state: MessageState;
  provider: string | null;
  nextAttemptAt?: Date;
  attemptCount?: number;
};

export interface QueueStore {
  claim(limit: number, leaseSeconds: number): Promise<ClaimedMessage[]>;
  startCampaigns(ids: readonly string[]): Promise<void>;
  /** 조건이 맞아 실제로 바꾼 id를 돌려준다. */
  applyUpdates(updates: readonly MessageUpdate[]): Promise<number[]>;
  readStates(ids: readonly number[]): Promise<Map<number, MessageState>>;
}

export type WorkerOptions = {
  store: QueueStore;
  /** 메시지마다 고른다. 체험 계정은 설정과 무관하게 가짜 발송기여야 해서 전역 값으로 두지 않았다. */
  providerFor: (message: ClaimedMessage) => SmsProvider;
  now?: () => Date;
  batchSize: number;
  /** 업체 호출과 저장에 걸리는 시간보다 충분히 길어야 한다. 짧으면 처리 중인 행을 다음 워커가 또 집는다. */
  leaseSeconds: number;
};

export type WorkerSummary = {
  claimed: number;
  accepted: number;
  retried: number;
  failed: number;
  deferred: number;
};

const QUEUED: MessageState = {
  status: "queued",
  providerMessageId: null,
  failCode: null,
  sentAt: null,
  finalizedAt: null,
};

/** 보내지 못한 채 임대만 반복된 행의 실패 코드. 워커가 업체 호출 전후로 계속 죽는 경우다. */
export const RETRY_EXHAUSTED = "RETRY_EXHAUSTED";
const PROVIDER_ERROR = "PROVIDER_ERROR";
const NO_RESULT = "NO_RESULT";
const CONFLICT_RETRIES = 3;

export async function runWorkerTick(
  options: WorkerOptions,
): Promise<WorkerSummary> {
  const { store, providerFor, batchSize, leaseSeconds } = options;
  const now = options.now ?? (() => new Date());

  const claimed = await store.claim(batchSize, leaseSeconds);
  const summary: WorkerSummary = {
    claimed: claimed.length,
    accepted: 0,
    retried: 0,
    failed: 0,
    deferred: 0,
  };
  if (claimed.length === 0) return summary;

  const startedAt = now();
  const plain: MessageUpdate[] = [];
  const events = new Map<number, { event: MessageEvent; provider: string }>();
  const sendable: ClaimedMessage[] = [];

  for (const message of claimed) {
    if (message.isAd && isNightKst(startedAt)) {
      // 접수 때 낮이어도 재시도나 긴 발송이 21시를 넘길 수 있다. 법 위반이지 업체 오류가 아니므로 시도 횟수를 돌려준다.
      plain.push({
        id: message.id,
        expectedStatus: "queued",
        state: QUEUED,
        provider: null,
        nextAttemptAt: nextAdSendableAt(startedAt),
        attemptCount: message.attemptCount - 1,
      });
      summary.deferred += 1;
    } else if (message.attemptCount > MAX_ATTEMPTS) {
      events.set(message.id, {
        event: {
          type: "send_failed",
          failCode: RETRY_EXHAUSTED,
          at: startedAt,
        },
        provider: providerFor(message).name,
      });
      summary.failed += 1;
    } else {
      sendable.push(message);
    }
  }

  await startCampaigns(store, sendable);

  for (const [provider, group] of groupByProvider(sendable, providerFor)) {
    const results = await sendSafely(provider, group);
    const at = now();
    for (const message of group) {
      const result = results.get(message.idempotencyKey);
      if (result?.outcome === "accepted") {
        events.set(message.id, {
          event: {
            type: "accepted",
            providerMessageId: result.providerMessageId,
            at,
          },
          provider: provider.name,
        });
        summary.accepted += 1;
        continue;
      }

      // 결과가 빠졌으면 접수됐는지 알 수 없다. 영구 실패로 확정하면 실제 도착과 어긋날 수 있어 재시도한다. 멱등 키가 중복을 막는다.
      const retryable = result?.retryable ?? true;
      const failCode = result?.failCode ?? NO_RESULT;
      const delay = retryable ? retryDelayMs(message.attemptCount) : null;
      if (delay !== null) {
        plain.push({
          id: message.id,
          expectedStatus: "queued",
          state: QUEUED,
          provider: null,
          nextAttemptAt: new Date(at.getTime() + delay),
        });
        summary.retried += 1;
      } else {
        events.set(message.id, {
          event: { type: "send_failed", failCode, at },
          provider: provider.name,
        });
        summary.failed += 1;
      }
    }
  }

  if (plain.length > 0) await store.applyUpdates(plain);
  await applyEvents(store, events);
  return summary;
}

async function startCampaigns(
  store: QueueStore,
  messages: readonly ClaimedMessage[],
): Promise<void> {
  const ids = new Set<string>();
  for (const message of messages) {
    if (
      transitionCampaign(message.campaignStatus, { type: "start_sending" }).ok
    ) {
      ids.add(message.campaignId);
    }
  }
  if (ids.size > 0) await store.startCampaigns([...ids]);
}

function groupByProvider(
  messages: readonly ClaimedMessage[],
  providerFor: (message: ClaimedMessage) => SmsProvider,
): Map<SmsProvider, ClaimedMessage[]> {
  const groups = new Map<SmsProvider, ClaimedMessage[]>();
  for (const message of messages) {
    const provider = providerFor(message);
    groups.set(provider, [...(groups.get(provider) ?? []), message]);
  }
  return groups;
}

async function sendSafely(
  provider: SmsProvider,
  messages: readonly ClaimedMessage[],
): Promise<Map<string, SendResult>> {
  const requests: SendRequest[] = messages.map((message) => ({
    idempotencyKey: message.idempotencyKey,
    to: message.phone,
    from: message.senderPhone,
    body: message.body,
    kind: message.kind,
  }));
  try {
    const results = await provider.send(requests);
    return new Map(results.map((result) => [result.idempotencyKey, result]));
  } catch {
    // 약속상 던지지 않지만, 던지면 저장 없이 임대가 끝날 때까지 멈춘다. 건별 일시 오류로 바꿔 재시도 규칙을 그대로 태운다.
    return new Map(
      requests.map((request) => [
        request.idempotencyKey,
        {
          idempotencyKey: request.idempotencyKey,
          outcome: "rejected",
          failCode: PROVIDER_ERROR,
          retryable: true,
        },
      ]),
    );
  }
}

/** 웹훅이 먼저 온 행은 조건이 어긋나 빠진다. 다시 읽어 status.ts에 맡긴다. 접수 시각만 채우고 끝날 수 있다. */
async function applyEvents(
  store: QueueStore,
  events: ReadonlyMap<number, { event: MessageEvent; provider: string }>,
): Promise<void> {
  let states = new Map<number, MessageState>(
    [...events.keys()].map((id) => [id, QUEUED]),
  );

  for (let round = 0; round < CONFLICT_RETRIES && states.size > 0; round += 1) {
    const updates: MessageUpdate[] = [];
    for (const [id, state] of states) {
      const pending = events.get(id);
      if (!pending) continue;
      const transition = transitionMessage(state, pending.event);
      if (
        transition.outcome === "applied" ||
        transition.outcome === "recorded_late"
      ) {
        updates.push({
          id,
          expectedStatus: state.status,
          state: transition.state,
          provider: pending.provider,
        });
      }
    }
    if (updates.length === 0) return;

    const applied = new Set(await store.applyUpdates(updates));
    const conflicted = updates
      .map((update) => update.id)
      .filter((id) => !applied.has(id));
    if (conflicted.length === 0) return;
    states = await store.readStates(conflicted);
  }
}
