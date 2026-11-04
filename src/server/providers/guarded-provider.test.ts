import { describe, expect, it, vi } from "vitest";
import {
  createGuardedProvider,
  parseAllowedRecipients,
  usesRealProvider,
} from "./guarded-provider";
import type { SendRequest, SendResult, SmsProvider } from "./sms-provider";

const MINE = "01011112222";
const OTHER = "01033334444";

const request = (key: string, to = MINE): SendRequest => ({
  idempotencyKey: key,
  to,
  from: "0212345678",
  body: "본문",
  kind: "sms",
});

function setup(
  options: { limit?: number; granted?: number; fail?: boolean } = {},
) {
  const inner = vi.fn(
    async (batch: readonly SendRequest[]): Promise<SendResult[]> =>
      batch.map((item) => ({
        idempotencyKey: item.idempotencyKey,
        outcome: "accepted",
        providerMessageId: `p-${item.idempotencyKey}`,
      })),
  );
  const reserve = vi.fn(async (count: number) => {
    if (options.fail) throw new Error("db");
    return Math.min(count, options.granted ?? count);
  });
  const provider = createGuardedProvider(
    {
      name: "real",
      send: inner,
      parseWebhook: () => [],
      verifySignature: async () => true,
    } satisfies SmsProvider,
    {
      allowedRecipients: new Set([MINE]),
      dailyLimit: options.limit ?? 10,
      reserve,
    },
  );
  return { provider, inner, reserve };
}

describe("허용 번호", () => {
  it("목록에 없는 번호는 업체를 부르지 않고 영구 실패다", async () => {
    const { provider, inner, reserve } = setup();

    const results = await provider.send([request("a", OTHER)]);

    expect(inner).not.toHaveBeenCalled();
    expect(reserve).not.toHaveBeenCalled();
    expect(results).toEqual([
      {
        idempotencyKey: "a",
        outcome: "rejected",
        failCode: "BLOCKED_RECIPIENT",
        retryable: false,
      },
    ]);
  });

  it("섞여 있으면 허용된 건만 보내고 상한도 그만큼만 쓴다", async () => {
    const { provider, inner, reserve } = setup();

    const results = await provider.send([request("a"), request("b", OTHER)]);

    expect(inner.mock.calls[0]?.[0].map((item) => item.to)).toEqual([MINE]);
    expect(reserve).toHaveBeenCalledWith(1, 10);
    expect(results).toHaveLength(2);
  });

  it("목록이 비면 아무에게도 보내지 않는다", async () => {
    const inner = vi.fn();
    const provider = createGuardedProvider(
      {
        name: "real",
        send: inner,
        parseWebhook: () => [],
        verifySignature: async () => true,
      },
      {
        allowedRecipients: parseAllowedRecipients(undefined),
        dailyLimit: 10,
        reserve: async (count) => count,
      },
    );
    await provider.send([request("a")]);
    expect(inner).not.toHaveBeenCalled();
  });
});

describe("하루 상한", () => {
  it("남은 건수만 보내고 나머지는 영구 실패다", async () => {
    const { provider, inner } = setup({ granted: 1 });

    const results = await provider.send([request("a"), request("b")]);

    expect(inner.mock.calls[0]?.[0]).toHaveLength(1);
    expect(results).toContainEqual({
      idempotencyKey: "b",
      outcome: "rejected",
      failCode: "DAILY_LIMIT",
      retryable: false,
    });
  });

  it("다 쓰면 업체를 부르지 않는다", async () => {
    const { provider, inner } = setup({ granted: 0 });
    await provider.send([request("a")]);
    expect(inner).not.toHaveBeenCalled();
  });

  it("상한을 확인하지 못하면 보내지 않고 재시도한다", async () => {
    const { provider, inner } = setup({ fail: true });
    const [result] = await provider.send([request("a")]);
    expect(inner).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      failCode: "GUARD_UNAVAILABLE",
      retryable: true,
    });
  });
});

describe("parseAllowedRecipients", () => {
  it.each([
    [undefined, []],
    ["", []],
    ["010-1111-2222", ["01011112222"]],
    ["01011112222, 010 3333 4444,", ["01011112222", "01033334444"]],
  ])("%j", (value, expected) => {
    expect([...parseAllowedRecipients(value)]).toEqual(expected);
  });
});

describe("usesRealProvider", () => {
  it.each([
    [true, "solapi", false],
    [false, "solapi", true],
    [false, "fake", false],
    [false, undefined, false],
    [true, undefined, false],
  ])("체험 %s, 설정 %s → %s", (isTrial, smsProvider, expected) => {
    expect(usesRealProvider({ isTrial, smsProvider })).toBe(expected);
  });
});
