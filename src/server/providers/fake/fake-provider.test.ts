// @vitest-environment node
// 서명은 Web Crypto를 쓴다. jsdom의 ArrayBuffer는 Node의 Web Crypto가 다른 타입으로 거부할 수 있어 실제 런타임에 맞춘다.
import { describe, expect, it, vi } from "vitest";
import type { SendRequest, WebhookRequest } from "../sms-provider";
import {
  createFakeProvider,
  FAKE_SIGNATURE_HEADER,
  type FakeProviderOptions,
} from "./fake-provider";

const SECRET = "test-secret";
const NOW = new Date("2026-11-04T00:00:00.000Z");

function requestOf(key: string): SendRequest {
  return {
    idempotencyKey: key,
    to: "01000000001",
    from: "0212345678",
    body: "안녕",
    kind: "sms",
  };
}

/** 예약된 콜백을 모아 두었다가 테스트가 원할 때 실행한다. 실제 시간을 기다리지 않는다. */
function setup(overrides: Partial<FakeProviderOptions> = {}) {
  const scheduled: { run: () => void; delayMs: number }[] = [];
  const delivered: WebhookRequest[] = [];
  const onDeliveryError = vi.fn();
  const provider = createFakeProvider({
    secret: SECRET,
    deliver: async (request) => {
      delivered.push(request);
    },
    onDeliveryError,
    schedule: (run, delayMs) => scheduled.push({ run, delayMs }),
    now: () => NOW,
    random: () => 0.5,
    ...overrides,
  });

  async function flush(): Promise<void> {
    for (const { run } of scheduled.splice(0)) run();
    await vi.waitFor(() => {
      expect(
        delivered.length + onDeliveryError.mock.calls.length,
      ).toBeGreaterThan(0);
    });
  }

  return { provider, scheduled, delivered, onDeliveryError, flush };
}

describe("send", () => {
  it("요청마다 접수 결과를 같은 순서로 바로 돌려준다", async () => {
    const { provider } = setup();

    const results = await provider.send([requestOf("a"), requestOf("b")]);

    expect(results).toEqual([
      { idempotencyKey: "a", outcome: "accepted", providerMessageId: "fake-a" },
      { idempotencyKey: "b", outcome: "accepted", providerMessageId: "fake-b" },
    ]);
  });

  it("빈 묶음은 빈 결과를 돌려준다", async () => {
    const { provider, scheduled } = setup();

    await expect(provider.send([])).resolves.toEqual([]);
    expect(scheduled).toHaveLength(0);
  });

  it("같은 키로 재시도하면 같은 id를 돌려주고 웹훅을 한 번만 예약한다", async () => {
    const { provider, scheduled } = setup();

    const [first] = await provider.send([requestOf("a")]);
    const [second] = await provider.send([requestOf("a")]);

    expect(second).toEqual(first);
    expect(scheduled).toHaveLength(1);
  });

  it("접수 시점에는 결과가 아직 오지 않는다", async () => {
    const { provider, delivered } = setup();

    await provider.send([requestOf("a")]);

    expect(delivered).toHaveLength(0);
  });
});

describe("웹훅 지연", () => {
  it.each([
    { random: 0, delayMs: 1000 },
    { random: 0.5, delayMs: 3000 },
    { random: 0.999, delayMs: 4996 },
  ])(
    "난수 $random이면 $delayMs ms 뒤로 예약한다",
    async ({ random, delayMs }) => {
      const { provider, scheduled } = setup({ random: () => random });

      await provider.send([requestOf("a")]);

      expect(scheduled[0]?.delayMs).toBe(delayMs);
    },
  );
});

describe("웹훅 결과", () => {
  it("실패율 경계: 난수가 실패율 미만일 때만 실패한다", async () => {
    // 호출 순서: 지연 → 성공 여부 → (실패면) 코드 선택
    const failing = setup({
      random: vi.fn().mockReturnValueOnce(0.5).mockReturnValue(0.099),
    });
    await failing.provider.send([requestOf("a")]);
    await failing.flush();
    expect(
      failing.provider.parseWebhook(failing.delivered[0]!)[0]?.status,
    ).toBe("failed");

    const passing = setup({
      random: vi.fn().mockReturnValueOnce(0.5).mockReturnValue(0.1),
    });
    await passing.provider.send([requestOf("a")]);
    await passing.flush();
    expect(
      passing.provider.parseWebhook(passing.delivered[0]!)[0]?.status,
    ).toBe("delivered");
  });

  it("도착 웹훅을 우리 메시지로 되짚을 수 있다", async () => {
    const { provider, delivered, flush } = setup();
    await provider.send([requestOf("a")]);
    await flush();

    expect(provider.parseWebhook(delivered[0]!)).toEqual([
      {
        status: "delivered",
        providerMessageId: "fake-a",
        idempotencyKey: "a",
        occurredAt: NOW,
      },
    ]);
  });

  it("실패 웹훅에는 실패 코드가 있다", async () => {
    const { provider, delivered, flush } = setup({ failureRate: 1 });
    await provider.send([requestOf("a")]);
    await flush();

    const [event] = provider.parseWebhook(delivered[0]!);
    expect(event).toMatchObject({ status: "failed", failCode: "E410" });
  });

  it("전달이 실패해도 예외를 밖으로 던지지 않고 보고한다", async () => {
    const failure = new Error("연결 실패");
    const { provider, onDeliveryError, flush } = setup({
      deliver: () => Promise.reject(failure),
    });
    await provider.send([requestOf("a")]);
    await flush();

    expect(onDeliveryError).toHaveBeenCalledWith(failure);
  });
});

describe("verifySignature", () => {
  async function signedRequest() {
    const context = setup();
    await context.provider.send([requestOf("a")]);
    await context.flush();
    return { ...context, request: context.delivered[0]! };
  }

  it("직접 서명한 웹훅을 통과시킨다", async () => {
    const { provider, request } = await signedRequest();

    await expect(provider.verifySignature(request)).resolves.toBe(true);
  });

  it("본문이 한 글자라도 바뀌면 거부한다", async () => {
    const { provider, request } = await signedRequest();

    await expect(
      provider.verifySignature({
        ...request,
        rawBody: request.rawBody.replace("delivered", "failed"),
      }),
    ).resolves.toBe(false);
  });

  it("다른 키로 서명한 웹훅을 거부한다", async () => {
    const { request } = await signedRequest();
    const other = setup({ secret: "other-secret" }).provider;

    await expect(other.verifySignature(request)).resolves.toBe(false);
  });

  it("서명 헤더가 없으면 거부한다", async () => {
    const { provider, request } = await signedRequest();

    await expect(
      provider.verifySignature({
        rawBody: request.rawBody,
        headers: new Headers(),
      }),
    ).resolves.toBe(false);
  });

  it.each(["", "zz", "abc", "not-hex!", "00"])(
    "서명 형식 오류 %j를 거부한다",
    async (signature) => {
      const { provider, request } = await signedRequest();

      await expect(
        provider.verifySignature({
          rawBody: request.rawBody,
          headers: new Headers({ [FAKE_SIGNATURE_HEADER]: signature }),
        }),
      ).resolves.toBe(false);
    },
  );
});

describe("parseWebhook", () => {
  const { provider } = setup();
  const parse = (rawBody: string) =>
    provider.parseWebhook({ rawBody, headers: new Headers() });
  const base = {
    providerMessageId: "p",
    idempotencyKey: "k",
    occurredAt: NOW.toISOString(),
  };

  it.each([
    { name: "JSON이 아님", rawBody: "not json" },
    { name: "events 없음", rawBody: "{}" },
    {
      name: "알 수 없는 상태",
      rawBody: JSON.stringify({ events: [{ ...base, status: "sent" }] }),
    },
    {
      name: "실패 코드 없음",
      rawBody: JSON.stringify({ events: [{ ...base, status: "failed" }] }),
    },
    {
      name: "날짜 형식 오류",
      rawBody: JSON.stringify({
        events: [{ ...base, status: "delivered", occurredAt: "어제" }],
      }),
    },
  ])("$name이면 던진다", ({ rawBody }) => {
    expect(() => parse(rawBody)).toThrow();
  });
});

describe("생성", () => {
  it("빈 서명 키를 거부한다", () => {
    expect(() =>
      createFakeProvider({
        secret: "",
        deliver: async () => {},
        onDeliveryError: () => {},
      }),
    ).toThrow();
  });
});
