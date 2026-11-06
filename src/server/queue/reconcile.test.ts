// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import type { LookupResult, SmsProvider } from "../providers/sms-provider";
import {
  RESULT_TIMEOUT_CODE,
  runReconcileTick,
  type StaleMessage,
} from "./reconcile";
import type { MessageEventLog } from "./event-log";
import type { MessageUpdate } from "./worker";

const NOW = new Date("2026-11-08T00:00:00Z");
const HOUR = 3_600_000;

const stale = (
  id: number,
  ageHours: number,
  over: Partial<StaleMessage> = {},
): StaleMessage => ({
  id,
  campaignId: `c${id}`,
  provider: "solapi",
  providerMessageId: `p${id}`,
  state: {
    status: "sent",
    providerMessageId: `p${id}`,
    failCode: null,
    sentAt: new Date(NOW.getTime() - ageHours * HOUR),
    finalizedAt: null,
  },
  ...over,
});

function setup(
  messages: StaleMessage[],
  lookup?: (ids: readonly string[]) => Promise<LookupResult[]>,
) {
  const saved: MessageUpdate[] = [];
  const settled: string[] = [];
  const logs: MessageEventLog[] = [];
  const store = {
    listStaleSent: vi.fn(async () => messages),
    applyUpdates: vi.fn(async (updates: readonly MessageUpdate[]) => {
      saved.push(...updates);
      return updates.map((u) => u.id);
    }),
    settleCampaigns: vi.fn(async (ids: readonly string[]) => {
      settled.push(...ids);
    }),
    recordEvents: vi.fn(async (events: readonly MessageEventLog[]) => {
      logs.push(...events);
    }),
  };
  const provider = {
    name: "solapi",
    fetchResults: lookup,
  } as unknown as SmsProvider;
  const run = () =>
    runReconcileTick({ store, providerFor: () => provider, now: () => NOW });
  return { store, saved, settled, logs, run };
}

describe("runReconcileTick", () => {
  it("대상이 1시간 넘게 지난 메시지다", async () => {
    const { store, run } = setup([], async () => []);
    await run();
    expect(store.listStaleSent).toHaveBeenCalledWith(
      new Date(NOW.getTime() - HOUR),
      500,
    );
  });

  it("조회 결과가 도착이면 도착으로 확정하고 정산한다", async () => {
    const at = new Date("2026-11-07T23:00:00Z");
    const { saved, settled, run } = setup([stale(1, 2)], async () => [
      { providerMessageId: "p1", status: "delivered", occurredAt: at },
    ]);
    const summary = await run();
    expect(summary.delivered).toBe(1);
    expect(saved[0]).toMatchObject({
      id: 1,
      expectedStatus: "sent",
      provider: "solapi",
      state: { status: "delivered", finalizedAt: at },
    });
    expect(settled).toEqual(["c1"]);
  });

  it("조회 결과가 실패면 업체 코드로 확정한다", async () => {
    const { saved, run } = setup([stale(1, 2)], async () => [
      {
        providerMessageId: "p1",
        status: "failed",
        failCode: "3032",
        occurredAt: null,
      },
    ]);
    await run();
    expect(saved[0]?.state).toMatchObject({
      status: "failed",
      failCode: "3032",
    });
  });

  it("아직 진행 중이면 그대로 둔다", async () => {
    const { saved, store, run } = setup([stale(1, 2)], async () => [
      { providerMessageId: "p1", status: "pending" },
    ]);
    expect((await run()).pending).toBe(1);
    expect(saved).toEqual([]);
    expect(store.settleCampaigns).not.toHaveBeenCalled();
  });

  it("72시간이 지나도 결과가 없으면 실패로 확정한다", async () => {
    const { saved, settled, run } = setup([stale(1, 72)], async () => [
      { providerMessageId: "p1", status: "pending" },
    ]);
    expect((await run()).timedOut).toBe(1);
    expect(saved[0]?.state.failCode).toBe(RESULT_TIMEOUT_CODE);
    expect(settled).toEqual(["c1"]);
  });

  it("업체가 모르는 메시지도 72시간 전에는 포기하지 않는다", async () => {
    const { saved, run } = setup([stale(1, 71), stale(2, 73)], async () => []);
    const summary = await run();
    expect(summary).toMatchObject({ pending: 1, timedOut: 1 });
    expect(saved.map((u) => u.id)).toEqual([2]);
  });

  it("조회가 실패하면 72시간이 지났어도 확정하지 않는다", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const { saved, run } = setup([stale(1, 100)], async () => {
      throw new Error("업체 장애");
    });
    expect((await run()).lookupFailed).toBe(1);
    expect(saved).toEqual([]);
    error.mockRestore();
  });

  it("조회 기능이 없는 발송기는 건드리지 않는다", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const { saved, run } = setup([stale(1, 100)]);
    expect((await run()).lookupFailed).toBe(1);
    expect(saved).toEqual([]);
    error.mockRestore();
  });

  it("그 사이 웹훅이 먼저 처리한 행은 정산 대상에서 뺀다", async () => {
    const { store, settled, run } = setup([stale(1, 2)], async () => [
      { providerMessageId: "p1", status: "delivered", occurredAt: null },
    ]);
    store.applyUpdates.mockResolvedValueOnce([]);
    await run();
    expect(settled).toEqual([]);
  });

  it("조회 결과를 기록하고, 웹훅에 밀린 결과는 무시했다고 남긴다", async () => {
    const { store, logs, run } = setup([stale(1, 2), stale(2, 2)], async () => [
      { providerMessageId: "p1", status: "delivered", occurredAt: null },
      { providerMessageId: "p2", status: "delivered", occurredAt: null },
    ]);
    store.applyUpdates.mockResolvedValueOnce([1]);
    await run();
    expect(
      logs.map(({ messageId, source, kind, outcome }) => ({
        messageId,
        source,
        kind,
        outcome,
      })),
    ).toEqual([
      {
        messageId: 1,
        source: "reconcile",
        kind: "delivered",
        outcome: "applied",
      },
      {
        messageId: 2,
        source: "reconcile",
        kind: "delivered",
        outcome: "ignored_final",
      },
    ]);
  });

  it("같은 발송 건은 한 번만 정산한다", async () => {
    const { settled, run } = setup(
      [
        stale(1, 2, { campaignId: "same" }),
        stale(2, 2, { campaignId: "same" }),
      ],
      async () => [
        { providerMessageId: "p1", status: "delivered", occurredAt: null },
        { providerMessageId: "p2", status: "delivered", occurredAt: null },
      ],
    );
    await run();
    expect(settled).toEqual(["same"]);
  });
});
