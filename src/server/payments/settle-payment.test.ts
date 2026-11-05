// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import type {
  TossClient,
  TossResult,
} from "@/server/providers/toss/toss-client";
import { confirmCharge, syncFromWebhook } from "./settle-payment";

const ORDER = "dh-order-1";
const done = (over = {}): TossResult => ({
  kind: "ok",
  payment: {
    paymentKey: "pk",
    orderId: ORDER,
    status: "DONE",
    totalAmount: 10_000,
    approvedAt: "2026-11-05T10:00:00+09:00",
    ...over,
  },
});

/** Supabase 호출 모양만 흉내 낸다. 실제 함수 동작은 통합 테스트가 본다. */
function fakeDb(
  row: { order_id: string; amount: number; status: string } | null,
  rpcError: { code: string } | null = null,
) {
  const updates: unknown[] = [];
  const rpc = vi.fn(async () => ({ data: "charged", error: rpcError }));
  const chain = {
    select: () => chain,
    eq: () => chain,
    is: () => chain,
    update: (value: unknown) => {
      updates.push(value);
      return chain;
    },
    maybeSingle: async () => ({ data: row, error: null }),
    then: (resolve: (value: unknown) => void) => resolve({ error: null }),
  };
  return {
    client: { from: () => chain, rpc } as never,
    rpc,
    updates,
  };
}

function fakeToss(confirm: TossResult, get: TossResult = done()) {
  return {
    confirm: vi.fn(async () => confirm),
    getPayment: vi.fn(async () => get),
  } satisfies TossClient;
}

const run = (
  db: ReturnType<typeof fakeDb>,
  toss: TossClient,
  amount = 10_000,
) =>
  confirmCharge({
    supabase: db.client,
    toss,
    account: { orgId: "org", branchId: null },
    paymentKey: "pk",
    orderId: ORDER,
    amount,
  });

const ready = { order_id: ORDER, amount: 10_000, status: "ready" };

describe("confirmCharge", () => {
  it("승인되면 DB 금액과 주문번호 멱등 키로 기록한다", async () => {
    const db = fakeDb(ready);
    const toss = fakeToss(done());
    expect(await run(db, toss)).toBe("done");
    expect(toss.confirm).toHaveBeenCalledWith(
      { paymentKey: "pk", orderId: ORDER, amount: 10_000 },
      ORDER,
    );
    expect(db.rpc).toHaveBeenCalledOnce();
  });

  it("주소의 금액이 DB와 다르면 토스를 부르지 않고 실패한다", async () => {
    const db = fakeDb(ready);
    const toss = fakeToss(done());
    expect(await run(db, toss, 100)).toBe("failed");
    expect(toss.confirm).not.toHaveBeenCalled();
    expect(db.updates).toEqual([{ status: "failed" }]);
  });

  it("없거나 다른 계정의 주문은 토스를 부르지 않는다", async () => {
    const toss = fakeToss(done());
    expect(await run(fakeDb(null), toss)).toBe("failed");
    expect(toss.confirm).not.toHaveBeenCalled();
  });

  it("이미 완료된 주문을 새로고침하면 다시 승인하지 않는다", async () => {
    const toss = fakeToss(done());
    expect(await run(fakeDb({ ...ready, status: "done" }), toss)).toBe("done");
    expect(toss.confirm).not.toHaveBeenCalled();
  });

  it("거절되면 실패로 기록한다", async () => {
    const db = fakeDb(ready);
    const toss = fakeToss({ kind: "rejected", code: "REJECT_CARD_COMPANY" });
    expect(await run(db, toss)).toBe("failed");
    expect(db.updates).toEqual([{ status: "failed" }]);
    expect(db.rpc).not.toHaveBeenCalled();
  });

  it("이미 처리된 결제면 조회해서 충전한다", async () => {
    const db = fakeDb(ready);
    const toss = fakeToss({
      kind: "rejected",
      code: "ALREADY_PROCESSED_PAYMENT",
    });
    expect(await run(db, toss)).toBe("done");
    expect(toss.getPayment).toHaveBeenCalledWith("pk");
  });

  it("응답이 끊겨도 조회로 승인을 확인하면 충전한다", async () => {
    const db = fakeDb(ready);
    expect(await run(db, fakeToss({ kind: "unknown" }))).toBe("done");
    expect(db.rpc).toHaveBeenCalledOnce();
  });

  it("조회까지 모르면 실패로 확정하지 않는다", async () => {
    const db = fakeDb(ready);
    const toss = fakeToss({ kind: "unknown" }, { kind: "unknown" });
    expect(await run(db, toss)).toBe("pending");
    expect(db.updates).toEqual([]);
  });

  it("승인 후 기록이 실패하면 대기로 둔다", async () => {
    const db = fakeDb(ready, { code: "XX000" });
    expect(await run(db, fakeToss(done()))).toBe("pending");
  });

  it("승인 금액이 다르면 충전하지 않는다", async () => {
    const db = fakeDb(ready);
    const toss = fakeToss(done({ totalAmount: 1 }));
    expect(await run(db, toss)).toBe("failed");
    expect(db.rpc).not.toHaveBeenCalled();
  });
});

describe("syncFromWebhook", () => {
  const sync = (db: ReturnType<typeof fakeDb>, get: TossResult) =>
    syncFromWebhook({
      supabase: db.client,
      toss: fakeToss({ kind: "unknown" }, get),
      paymentKey: "pk",
    });

  it("조회 결과가 승인이면 충전한다", async () => {
    const db = fakeDb(ready);
    expect(await sync(db, done())).toBe("applied");
    expect(db.rpc).toHaveBeenCalledOnce();
  });

  it("토스에 없는 결제는 충전하지 않는다", async () => {
    const db = fakeDb(ready);
    expect(
      await sync(db, { kind: "rejected", code: "NOT_FOUND_PAYMENT" }),
    ).toBe("failed");
    expect(db.rpc).not.toHaveBeenCalled();
  });

  it("조회가 안 되면 재시도하게 한다", async () => {
    expect(await sync(fakeDb(ready), { kind: "unknown" })).toBe("retry");
  });

  it("우리 주문이 아니면 받은 것으로 끝낸다", async () => {
    expect(await sync(fakeDb(null), done())).toBe("unknown_order");
  });

  it("승인이 아닌 진행 상태는 충전하지 않는다", async () => {
    const db = fakeDb(ready);
    expect(await sync(db, done({ status: "IN_PROGRESS" }))).toBe("pending");
    expect(db.rpc).not.toHaveBeenCalled();
  });

  it("만료되면 실패로 표시한다", async () => {
    const db = fakeDb(ready);
    expect(await sync(db, done({ status: "EXPIRED" }))).toBe("failed");
    expect(db.updates).toEqual([{ status: "failed" }]);
  });

  it("승인됐는데 기록이 실패하면 재시도하게 한다", async () => {
    expect(await sync(fakeDb(ready, { code: "XX000" }), done())).toBe("retry");
  });
});
