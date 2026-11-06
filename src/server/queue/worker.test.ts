import { describe, expect, it } from "vitest";
import type { MessageState } from "../../features/campaigns/status";
import type { SendResult, SmsProvider } from "../providers/sms-provider";
import {
  RETRY_EXHAUSTED,
  runWorkerTick,
  type ClaimedMessage,
  type MessageUpdate,
  type QueueStore,
} from "./worker";
import type { MessageEventLog } from "./event-log";

const DAY = new Date("2026-11-04T03:00:00Z"); // KST 12:00
const NIGHT = new Date("2026-11-04T13:00:00Z"); // KST 22:00

function message(
  id: number,
  patch: Partial<ClaimedMessage> = {},
): ClaimedMessage {
  return {
    id,
    campaignId: "c1",
    campaignStatus: "scheduled",
    phone: "01000000000",
    idempotencyKey: `key-${id}`,
    attemptCount: 1,
    body: "본문",
    kind: "sms",
    senderPhone: "0212345678",
    isAd: false,
    isRealDemo: false,
    isTrial: true,
    ...patch,
  };
}

function setup(
  claimed: ClaimedMessage[],
  options: {
    send?: SmsProvider["send"];
    conflictOnce?: number[];
    remote?: Record<number, MessageState>;
    failRecord?: boolean;
  } = {},
) {
  const updates: MessageUpdate[] = [];
  const started: string[] = [];
  const sent: string[] = [];
  const settled: string[] = [];
  const logs: MessageEventLog[] = [];
  const conflicts = new Set(options.conflictOnce ?? []);
  const store: QueueStore = {
    claim: async () => claimed,
    startCampaigns: async (ids) => void started.push(...ids),
    applyUpdates: async (batch) => {
      const applied: number[] = [];
      for (const update of batch) {
        if (conflicts.delete(update.id)) continue;
        updates.push(update);
        applied.push(update.id);
      }
      return applied;
    },
    settleCampaigns: async (ids) => void settled.push(...ids),
    recordEvents: async (events) => {
      if (options.failRecord) throw new Error("기록 실패");
      logs.push(...events);
    },
    readStates: async (ids) =>
      new Map(
        ids.flatMap((id) => {
          const state = options.remote?.[id];
          return state ? [[id, state] as const] : [];
        }),
      ),
  };
  const provider: SmsProvider = {
    name: "fake",
    send:
      options.send ??
      (async (batch) =>
        batch.map((request) => ({
          idempotencyKey: request.idempotencyKey,
          outcome: "accepted",
          providerMessageId: `p-${request.idempotencyKey}`,
        }))),
    parseWebhook: () => [],
    verifySignature: async () => true,
  };
  const spied: SmsProvider = {
    ...provider,
    send: (batch) => {
      sent.push(...batch.map((request) => request.idempotencyKey));
      return provider.send(batch);
    },
  };
  return {
    updates,
    started,
    sent,
    settled,
    logs,
    tick: (now = DAY) =>
      runWorkerTick({
        store,
        providerFor: () => spied,
        now: () => now,
        batchSize: 100,
        leaseSeconds: 300,
      }),
  };
}

const rejected =
  (retryable: boolean, failCode = "E1"): SmsProvider["send"] =>
  async (batch) =>
    batch.map((request): SendResult => ({
      idempotencyKey: request.idempotencyKey,
      outcome: "rejected",
      failCode,
      retryable,
    }));

describe("runWorkerTick", () => {
  it("집은 것이 없으면 업체를 부르지 않는다", async () => {
    const t = setup([]);
    expect((await t.tick()).claimed).toBe(0);
    expect(t.sent).toEqual([]);
  });

  it("접수되면 sent로 저장하고 예약 상태의 발송 건을 시작한다", async () => {
    const t = setup([message(1), message(2)]);

    const summary = await t.tick();

    expect(summary).toMatchObject({ claimed: 2, accepted: 2 });
    expect(t.started).toEqual(["c1"]);
    expect(t.updates[0]).toMatchObject({
      id: 1,
      expectedStatus: "queued",
      provider: "fake",
      state: { status: "sent", providerMessageId: "p-key-1" },
    });
  });

  it("이미 발송 중인 건은 다시 시작하지 않는다", async () => {
    const t = setup([message(1, { campaignStatus: "sending" })]);
    await t.tick();
    expect(t.started).toEqual([]);
  });

  it("일시 오류는 상태를 두고 다음 시도를 미룬다", async () => {
    const t = setup([message(1)], { send: rejected(true) });

    expect((await t.tick()).retried).toBe(1);

    const [update] = t.updates;
    expect(update?.state.status).toBe("queued");
    expect(update?.nextAttemptAt?.getTime()).toBe(DAY.getTime() + 60_000);
  });

  it("영구 오류는 재시도 없이 failed로 확정한다", async () => {
    const t = setup([message(1)], { send: rejected(false, "BAD_NUMBER") });

    expect((await t.tick()).failed).toBe(1);

    expect(t.updates[0]?.state).toMatchObject({
      status: "failed",
      failCode: "BAD_NUMBER",
      finalizedAt: DAY,
    });
  });

  it("재시도를 다 쓴 일시 오류는 업체의 코드로 확정한다", async () => {
    const t = setup([message(1, { attemptCount: 4 })], {
      send: rejected(true, "E503"),
    });
    await t.tick();
    expect(t.updates[0]?.state).toMatchObject({
      status: "failed",
      failCode: "E503",
    });
  });

  it("임대만 반복돼 횟수를 넘긴 행은 보내지 않고 실패로 확정한다", async () => {
    const t = setup([message(1, { attemptCount: 5 })]);
    await t.tick();
    expect(t.sent).toEqual([]);
    expect(t.updates[0]?.state).toMatchObject({
      status: "failed",
      failCode: RETRY_EXHAUSTED,
    });
  });

  it("업체 호출이 던져도 멈추지 않고 재시도로 바꾼다", async () => {
    const t = setup([message(1)], {
      send: async () => {
        throw new Error("network");
      },
    });
    expect((await t.tick()).retried).toBe(1);
  });

  it("결과가 빠진 건은 실패로 확정하지 않고 재시도한다", async () => {
    const t = setup([message(1)], { send: async () => [] });
    expect((await t.tick()).retried).toBe(1);
    expect(t.updates[0]?.state.status).toBe("queued");
  });

  it("임대만 반복돼 실패한 건도 발송을 시작해 완료될 수 있게 한다", async () => {
    const t = setup([message(1, { attemptCount: 5 })]);
    await t.tick();
    expect(t.started).toEqual(["c1"]);
    expect(t.settled).toEqual(["c1"]);
  });

  it("미루기만 한 묶음은 정산하지 않는다", async () => {
    const t = setup([message(1, { isAd: true })]);
    await t.tick(NIGHT);
    expect(t.settled).toEqual([]);
  });

  describe("야간 광고", () => {
    it("보내지 않고 8시로 미루며 시도 횟수를 돌려준다", async () => {
      const t = setup([message(1, { isAd: true, attemptCount: 2 })]);

      const summary = await t.tick(NIGHT);

      expect(summary.deferred).toBe(1);
      expect(t.sent).toEqual([]);
      expect(t.started).toEqual([]);
      expect(t.updates[0]).toMatchObject({
        attemptCount: 1,
        nextAttemptAt: new Date("2026-11-04T23:00:00Z"),
      });
    });

    it("광고가 아니면 밤에도 보낸다", async () => {
      const t = setup([message(1)]);
      expect((await t.tick(NIGHT)).accepted).toBe(1);
    });

    it("같은 묶음의 광고만 미룬다", async () => {
      const t = setup([message(1, { isAd: true }), message(2)]);
      expect(await t.tick(NIGHT)).toMatchObject({ deferred: 1, accepted: 1 });
      expect(t.sent).toEqual(["key-2"]);
    });
  });

  describe("웹훅이 먼저 온 경우", () => {
    const delivered: MessageState = {
      status: "delivered",
      providerMessageId: "p-key-1",
      failCode: null,
      sentAt: null,
      finalizedAt: DAY,
    };

    it("최종 상태를 지키고 접수 시각만 채운다", async () => {
      const t = setup([message(1)], {
        conflictOnce: [1],
        remote: { 1: delivered },
      });

      await t.tick();

      expect(t.updates).toHaveLength(1);
      expect(t.updates[0]).toMatchObject({
        expectedStatus: "delivered",
        state: { status: "delivered", sentAt: DAY },
      });
    });

    it("접수 정보까지 있으면 더 저장하지 않는다", async () => {
      const t = setup([message(1)], {
        conflictOnce: [1],
        remote: { 1: { ...delivered, sentAt: DAY } },
      });
      await t.tick();
      expect(t.updates).toEqual([]);
    });
  });

  describe("메시지 기록", () => {
    const pick = (logs: MessageEventLog[]) =>
      logs.map(({ messageId, kind, outcome, failCode }) => ({
        messageId,
        kind,
        outcome,
        failCode,
      }));

    it("접수·재시도·영구 실패를 한 번에 남긴다", async () => {
      const t = setup([message(1), message(2), message(3)], {
        send: async (batch) =>
          batch.map((request): SendResult => {
            if (request.idempotencyKey === "key-1") {
              return {
                idempotencyKey: request.idempotencyKey,
                outcome: "accepted",
                providerMessageId: "p-1",
              };
            }
            return {
              idempotencyKey: request.idempotencyKey,
              outcome: "rejected",
              failCode: "E1",
              retryable: request.idempotencyKey === "key-2",
            };
          }),
      });
      await t.tick();
      expect(pick(t.logs)).toEqual([
        { messageId: 2, kind: "retry", outcome: "scheduled", failCode: "E1" },
        { messageId: 1, kind: "accepted", outcome: "applied", failCode: null },
        {
          messageId: 3,
          kind: "send_failed",
          outcome: "applied",
          failCode: "E1",
        },
      ]);
    });

    it("웹훅이 먼저 왔으면 늦게 기록했다고 남긴다", async () => {
      const t = setup([message(1)], {
        conflictOnce: [1],
        remote: {
          1: {
            status: "delivered",
            providerMessageId: "p-key-1",
            failCode: null,
            sentAt: null,
            finalizedAt: DAY,
          },
        },
      });
      await t.tick();
      expect(pick(t.logs)).toEqual([
        {
          messageId: 1,
          kind: "accepted",
          outcome: "recorded_late",
          failCode: null,
        },
      ]);
    });

    it("야간 광고 보류도 남긴다", async () => {
      const t = setup([message(1, { isAd: true })]);
      await t.tick(NIGHT);
      expect(pick(t.logs)).toEqual([
        {
          messageId: 1,
          kind: "deferred",
          outcome: "scheduled",
          failCode: null,
        },
      ]);
    });

    it("기록 저장이 실패해도 발송 결과와 정산은 그대로다", async () => {
      const t = setup([message(1)], { failRecord: true });
      expect(await t.tick()).toMatchObject({ accepted: 1 });
      expect(t.updates).toHaveLength(1);
      expect(t.settled).toEqual(["c1"]);
    });
  });
});
