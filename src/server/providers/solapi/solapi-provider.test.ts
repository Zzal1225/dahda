import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { SendRequest, WebhookRequest } from "../sms-provider";
import {
  createSolapiProvider,
  type SolapiStoredMessage,
  SolapiRejected,
  type SolapiClient,
  type SolapiMessage,
} from "./solapi-provider";

const SECRET = "webhook-secret";
const NOW = new Date("2026-11-04T00:00:00Z");

const request = (key: string, kind: "sms" | "lms" = "sms"): SendRequest => ({
  idempotencyKey: key,
  to: "01012345678",
  from: "0212345678",
  body: "본문",
  kind,
});

function provider(send: SolapiClient["send"]) {
  return createSolapiProvider({
    webhookSecret: SECRET,
    client: { send },
    now: () => NOW,
  });
}

const webhook = (
  body: unknown,
  headers: Record<string, string> = { "x-solapi-event-name": "SINGLE-REPORT" },
): WebhookRequest => ({
  rawBody: JSON.stringify(body),
  headers: new Headers(headers),
});

describe("send", () => {
  it("요청을 솔라피 형식으로 바꾸고 우리 키를 customFields에 싣는다", async () => {
    let sent: readonly SolapiMessage[] = [];
    await provider(async (messages) => {
      sent = messages;
      return { failedMessageList: [] };
    }).send([request("a", "lms")]);

    expect(sent).toEqual([
      {
        to: "01012345678",
        from: "0212345678",
        text: "본문",
        type: "LMS",
        customFields: { k: "a" },
      },
    ]);
  });

  it("접수와 거절을 키로 나눈다", async () => {
    const results = await provider(async () => ({
      messageList: [
        { messageId: "M1", statusCode: "2000", customFields: { k: "a" } },
      ],
      failedMessageList: [{ statusCode: "1062", customFields: { k: "b" } }],
    })).send([request("a"), request("b")]);

    expect(results).toEqual([
      { idempotencyKey: "a", outcome: "accepted", providerMessageId: "M1" },
      {
        idempotencyKey: "b",
        outcome: "rejected",
        failCode: "1062",
        retryable: false,
      },
    ]);
  });

  it("서버 오류 코드만 재시도한다", async () => {
    const [result] = await provider(async () => ({
      failedMessageList: [{ statusCode: "2024", customFields: { k: "a" } }],
    })).send([request("a")]);
    expect(result).toMatchObject({ retryable: true, failCode: "2024" });
  });

  it("응답에서 찾지 못한 건은 다시 보내지 않는다", async () => {
    const [result] = await provider(async () => ({
      failedMessageList: [],
    })).send([request("a")]);
    expect(result).toEqual({
      idempotencyKey: "a",
      outcome: "rejected",
      failCode: "SOLAPI_NO_RESULT",
      retryable: false,
    });
  });

  it("네트워크 오류는 던지지 않고 재시도로 돌려준다", async () => {
    const [result] = await provider(async () => {
      throw new Error("network");
    }).send([request("a")]);
    expect(result).toMatchObject({
      failCode: "SOLAPI_UNAVAILABLE",
      retryable: true,
    });
  });

  it("다시 보내도 같은 오류는 재시도하지 않고 사유를 남긴다", async () => {
    const [result] = await provider(async () => {
      throw new SolapiRejected("SOLAPI_InvalidApiKey", "bad");
    }).send([request("a")]);
    expect(result).toMatchObject({
      failCode: "SOLAPI_InvalidApiKey",
      retryable: false,
    });
  });

  it("웹훅 전용 인스턴스는 보내지 않는다", async () => {
    const [result] = await createSolapiProvider({
      webhookSecret: SECRET,
    }).send([request("a")]);
    expect(result).toMatchObject({ outcome: "rejected", retryable: false });
  });

  it("웹훅 키 없이는 만들 수 없다", () => {
    expect(() => createSolapiProvider({ webhookSecret: "" })).toThrow();
  });
});

describe("parseWebhook", () => {
  const p = provider(async () => ({ failedMessageList: [] }));
  const report = {
    messageId: "M1",
    statusCode: "4000",
    customFields: { k: "a" },
    dateReceived: "2026-11-04T01:00:00.000Z",
  };

  it("4000은 도착이다", () => {
    expect(p.parseWebhook(webhook([report]))).toEqual([
      {
        status: "delivered",
        providerMessageId: "M1",
        idempotencyKey: "a",
        occurredAt: new Date("2026-11-04T01:00:00.000Z"),
      },
    ]);
  });

  it("그 외 코드는 실패다", () => {
    expect(
      p.parseWebhook(webhook([{ ...report, statusCode: "3043" }])),
    ).toMatchObject([{ status: "failed", failCode: "3043" }]);
  });

  it.each(["2000", "3000"])("%s는 진행 중이라 무시한다", (statusCode) => {
    expect(p.parseWebhook(webhook([{ ...report, statusCode }]))).toEqual([]);
  });

  it("한 요청의 여러 건을 모두 읽는다", () => {
    expect(p.parseWebhook(webhook([report, report]))).toHaveLength(2);
  });

  it("customFields가 없으면 키를 비운다", () => {
    const { customFields: _, ...plain } = report;
    expect(p.parseWebhook(webhook([plain]))[0]?.idempotencyKey).toBeNull();
    expect(
      p.parseWebhook(webhook([{ ...plain, customFields: null }]))[0]
        ?.idempotencyKey,
    ).toBeNull();
  });

  it.each([
    [
      "접수 시각만",
      { dateReceived: null, dateReported: "2026-11-04T02:00:00Z" },
      "2026-11-04T02:00:00Z",
    ],
    [
      "처리 시각만",
      { dateReceived: null, dateProcessed: "2026-11-04T03:00:00Z" },
      "2026-11-04T03:00:00Z",
    ],
    ["형식이 틀린 시각", { dateReceived: "어제" }, NOW.toISOString()],
    ["시각 없음", { dateReceived: null }, NOW.toISOString()],
  ])("%s", (_, patch, expected) => {
    expect(
      p.parseWebhook(webhook([{ ...report, ...patch }]))[0]?.occurredAt,
    ).toEqual(new Date(expected));
  });

  it("다른 이벤트는 메시지 결과가 아니다", () => {
    expect(
      p.parseWebhook(
        webhook({ groupId: "G" }, { "x-solapi-event-name": "GROUP-REPORT" }),
      ),
    ).toEqual([]);
  });

  it("형식이 틀리면 던진다", () => {
    expect(() => p.parseWebhook(webhook({ not: "array" }))).toThrow();
    expect(() => p.parseWebhook(webhook([{ statusCode: "4000" }]))).toThrow();
  });
});

describe("verifySignature", () => {
  const p = createSolapiProvider({ webhookSecret: SECRET });
  const sha1 = createHash("sha1").update(SECRET).digest("hex");
  const verify = (headers: Record<string, string>) =>
    p.verifySignature(webhook([], headers));

  it("비밀값의 SHA1이 맞으면 통과한다", async () => {
    expect(await verify({ "x-solapi-secret": sha1 })).toBe(true);
    expect(await verify({ "x-solapi-secret": sha1.toUpperCase() })).toBe(true);
  });

  it.each([
    ["헤더 없음", {}],
    ["비밀값 원문", { "x-solapi-secret": SECRET }],
    ["다른 값", { "x-solapi-secret": "0".repeat(40) }],
    ["앞부분만", { "x-solapi-secret": sha1.slice(0, 20) }],
    ["뒤에 덧붙임", { "x-solapi-secret": `${sha1}00` }],
  ])("%s는 거부한다", async (_, headers) => {
    expect(await verify(headers as Record<string, string>)).toBe(false);
  });
});

describe("fetchResults", () => {
  const lookup = (items: SolapiStoredMessage[]) => {
    const getMessages = vi.fn(async () => items);
    const provider = createSolapiProvider({
      webhookSecret: "secret",
      client: { send: async () => ({ failedMessageList: [] }), getMessages },
    });
    return { provider, getMessages };
  };

  it("코드를 도착, 실패, 진행 중으로 나눈다", async () => {
    const { provider } = lookup([
      {
        messageId: "A",
        statusCode: "4000",
        dateReceived: "2026-11-05T04:55:50.000Z",
      },
      { messageId: "B", statusCode: "3032" },
      { messageId: "C", statusCode: "3000" },
      { messageId: "D", statusCode: "2000" },
      { messageId: "E", statusCode: null },
    ]);
    expect(await provider.fetchResults?.(["A"])).toEqual([
      {
        providerMessageId: "A",
        status: "delivered",
        occurredAt: new Date("2026-11-05T04:55:50.000Z"),
      },
      {
        providerMessageId: "B",
        status: "failed",
        failCode: "3032",
        occurredAt: null,
      },
      { providerMessageId: "C", status: "pending" },
      { providerMessageId: "D", status: "pending" },
      { providerMessageId: "E", status: "pending" },
    ]);
  });

  it("많으면 100건씩 나눠 묻는다", async () => {
    const { provider, getMessages } = lookup([]);
    await provider.fetchResults?.(
      Array.from({ length: 250 }, (_, index) => `M${index}`),
    );
    expect(getMessages).toHaveBeenCalledTimes(3);
  });

  it("클라이언트가 없으면 예외를 던진다", async () => {
    const provider = createSolapiProvider({ webhookSecret: "secret" });
    await expect(provider.fetchResults?.(["A"])).rejects.toThrow();
  });
});
