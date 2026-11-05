// @vitest-environment node
import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createTossClient } from "./toss-client";
import { verifyTossSignature } from "./toss-webhook";

const PAYMENT = {
  paymentKey: "pk",
  orderId: "dh-1",
  status: "DONE",
  totalAmount: 10_000,
  approvedAt: "2026-11-05T10:00:00+09:00",
};

function stub(status: number, body: unknown) {
  const mock = vi.fn(
    async (_url: string, _init: RequestInit) =>
      new Response(JSON.stringify(body), { status }),
  );
  vi.stubGlobal("fetch", mock);
  return mock;
}

afterEach(() => vi.unstubAllGlobals());

const confirm = () =>
  createTossClient("test_sk_x").confirm(
    { paymentKey: "pk", orderId: "dh-1", amount: 10_000 },
    "dh-1",
  );

describe("createTossClient", () => {
  it("Basic 인증과 멱등 키로 승인 API를 부른다", async () => {
    const mock = stub(200, PAYMENT);
    expect((await confirm()).kind).toBe("ok");
    const [url, init] = mock.mock.calls[0] ?? [];
    expect(url).toBe("https://api.tosspayments.com/v1/payments/confirm");
    const headers = init?.headers as Record<string, string>;
    expect(headers.Authorization).toBe(
      `Basic ${Buffer.from("test_sk_x:").toString("base64")}`,
    );
    expect(headers["Idempotency-Key"]).toBe("dh-1");
  });

  it("4xx는 코드와 함께 거절이다", async () => {
    stub(400, { code: "REJECT_CARD_COMPANY", message: "x" });
    expect(await confirm()).toEqual({
      kind: "rejected",
      code: "REJECT_CARD_COMPANY",
    });
  });

  it.each([
    [500, { code: "FAILED_PAYMENT_INTERNAL_SYSTEM_PROCESSING" }],
    [409, { code: "IDEMPOTENT_REQUEST_PROCESSING" }],
    [200, { unexpected: true }],
  ])("%i 응답은 결과를 모르는 것으로 본다", async (status, body) => {
    stub(status, body);
    expect((await confirm()).kind).toBe("unknown");
  });

  it("네트워크 오류도 결과를 모르는 것으로 본다", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("timeout");
      }),
    );
    expect((await confirm()).kind).toBe("unknown");
  });

  it("조회 경로의 결제 키를 인코딩한다", async () => {
    const mock = stub(200, PAYMENT);
    await createTossClient("test_sk_x").getPayment("a/b");
    expect(mock.mock.calls[0]?.[0]).toBe(
      "https://api.tosspayments.com/v1/payments/a%2Fb",
    );
  });
});

describe("verifyTossSignature", () => {
  const body = '{"eventType":"PAYMENT_STATUS_CHANGED"}';
  const time = "2026-11-05T10:00:00.000000";
  const sign = (secret: string, payload = body) =>
    createHmac("sha256", secret).update(`${payload}:${time}`).digest("base64");
  const headers = (signature: string) =>
    new Headers({
      "tosspayments-webhook-signature": signature,
      "tosspayments-webhook-transmission-time": time,
    });

  it("여러 값 중 하나가 맞으면 통과한다", () => {
    expect(
      verifyTossSignature(body, headers(`v1:AAAA,v1:${sign("key")}`), "key"),
    ).toBe("valid");
  });

  it("키나 본문이 다르면 거부한다", () => {
    expect(verifyTossSignature(body, headers(`v1:${sign("x")}`), "key")).toBe(
      "invalid",
    );
    expect(
      verifyTossSignature(body, headers(`v1:${sign("key", "{}")}`), "key"),
    ).toBe("invalid");
  });

  it("헤더나 키가 없으면 없음으로 구분한다", () => {
    expect(verifyTossSignature(body, new Headers(), "key")).toBe("missing");
    expect(verifyTossSignature(body, headers("v1:x"), undefined)).toBe(
      "missing",
    );
  });
});
