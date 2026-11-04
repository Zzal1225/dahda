import { z } from "zod";
import type {
  SendRequest,
  SendResult,
  SmsProvider,
  WebhookEvent,
  WebhookRequest,
} from "../sms-provider";

/**
 * 체험 계정·CI·테스트가 쓰는 가짜 발송기. 실제 문자는 나가지 않는다.
 *
 * 메모리 안에서 결과만 돌려주지 않고 서명한 웹훅을 실제로 보낸다. 그래야 비동기 결과 경로
 * (서명 검증 → 원문 저장 → 상태 전이)를 실제 업체 없이 끝까지 돌릴 수 있다.
 *
 * node:crypto 대신 Web Crypto를 쓰는 이유: 워커가 Deno 기반 Edge Function에서 돌아 Next.js와 런타임이 다르다.
 */

export const FAKE_SIGNATURE_HEADER = "x-fake-signature";

// 화면에서 볼 만한 실패 사유를 섞으려고 시안의 샘플 코드를 쓴다. 실제 업체 코드와는 무관하다.
const FAKE_FAIL_CODES = ["E301", "E302", "E410", "E503", "E201"] as const;

const DEFAULT_FAILURE_RATE = 0.1;
const DEFAULT_MIN_DELAY_MS = 1_000;
const DEFAULT_MAX_DELAY_MS = 5_000;

const payloadSchema = z.object({
  events: z.array(
    z.discriminatedUnion("status", [
      z.object({
        status: z.literal("delivered"),
        providerMessageId: z.string().min(1),
        idempotencyKey: z.string().min(1),
        occurredAt: z.iso.datetime(),
      }),
      z.object({
        status: z.literal("failed"),
        failCode: z.string().min(1),
        providerMessageId: z.string().min(1),
        idempotencyKey: z.string().min(1),
        occurredAt: z.iso.datetime(),
      }),
    ]),
  ),
});

export type FakeProviderOptions = {
  /** 웹훅 서명 키. 비어 있으면 누구나 위조할 수 있으므로 생성 시점에 막는다. */
  secret: string;
  /** 웹훅을 보내는 방법. 호출부가 주소를 정한다(운영은 fetch, 테스트는 함수 호출). */
  deliver: (request: WebhookRequest) => Promise<void>;
  /** 웹훅 전달 실패 보고. 예약 콜백에서 던지면 잡을 곳이 없어 프로세스가 죽을 수 있다. */
  onDeliveryError: (error: unknown) => void;
  // 아래는 테스트에서 시간과 난수를 고정하기 위한 주입점이다.
  random?: () => number;
  /**
   * 기본값 setTimeout은 응답 뒤 실행이 끊기는 서버리스 환경에서 보장되지 않는다.
   * 워커를 만드는 step4에서 그 런타임에 맞는 예약 방법을 넘긴다.
   */
  schedule?: (run: () => void, delayMs: number) => void;
  now?: () => Date;
  failureRate?: number;
  minDelayMs?: number;
  maxDelayMs?: number;
};

export function createFakeProvider(options: FakeProviderOptions): SmsProvider {
  if (!options.secret) throw new Error("가짜 발송기의 서명 키가 비어 있다");

  const random = options.random ?? Math.random;
  const schedule =
    options.schedule ??
    ((run: () => void, delayMs: number) => void setTimeout(run, delayMs));
  const now = options.now ?? (() => new Date());
  const failureRate = options.failureRate ?? DEFAULT_FAILURE_RATE;
  const minDelayMs = options.minDelayMs ?? DEFAULT_MIN_DELAY_MS;
  const maxDelayMs = options.maxDelayMs ?? DEFAULT_MAX_DELAY_MS;

  // 업체의 멱등 처리를 흉내 낸다. 재시도한 요청에 웹훅을 또 보내면 실제 업체와 다른 환경에서 테스트하게 된다.
  const accepted = new Set<string>();

  function scheduleResult(
    request: SendRequest,
    providerMessageId: string,
  ): void {
    const delayMs = minDelayMs + random() * (maxDelayMs - minDelayMs);

    schedule(() => {
      const occurredAt = now().toISOString();
      const event =
        random() < failureRate
          ? {
              status: "failed" as const,
              failCode:
                FAKE_FAIL_CODES[
                  Math.floor(random() * FAKE_FAIL_CODES.length)
                ] ?? FAKE_FAIL_CODES[0],
              providerMessageId,
              idempotencyKey: request.idempotencyKey,
              occurredAt,
            }
          : {
              status: "delivered" as const,
              providerMessageId,
              idempotencyKey: request.idempotencyKey,
              occurredAt,
            };

      void signRequest(options.secret, JSON.stringify({ events: [event] }))
        .then(options.deliver)
        .catch(options.onDeliveryError);
    }, delayMs);
  }

  return {
    name: "fake",

    async send(batch: readonly SendRequest[]): Promise<SendResult[]> {
      return batch.map((request) => {
        const providerMessageId = `fake-${request.idempotencyKey}`;
        if (!accepted.has(request.idempotencyKey)) {
          accepted.add(request.idempotencyKey);
          scheduleResult(request, providerMessageId);
        }
        return {
          idempotencyKey: request.idempotencyKey,
          outcome: "accepted",
          providerMessageId,
        };
      });
    },

    parseWebhook(request: WebhookRequest): WebhookEvent[] {
      const payload = payloadSchema.parse(JSON.parse(request.rawBody));
      return payload.events.map((event) => ({
        ...event,
        occurredAt: new Date(event.occurredAt),
      }));
    },

    async verifySignature(request: WebhookRequest): Promise<boolean> {
      const signature = request.headers.get(FAKE_SIGNATURE_HEADER);
      if (!signature) return false;

      const bytes = hexToBytes(signature);
      if (!bytes) return false;

      // 문자열 비교는 일치하는 앞부분 길이가 응답 시간에 드러난다. subtle.verify는 시간이 일정하다.
      return crypto.subtle.verify(
        "HMAC",
        await importKey(options.secret),
        bytes,
        new TextEncoder().encode(request.rawBody),
      );
    },
  };
}

async function signRequest(
  secret: string,
  rawBody: string,
): Promise<WebhookRequest> {
  const signature = await crypto.subtle.sign(
    "HMAC",
    await importKey(secret),
    new TextEncoder().encode(rawBody),
  );
  const hex = Array.from(new Uint8Array(signature), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");

  return {
    rawBody,
    headers: new Headers({
      "content-type": "application/json",
      [FAKE_SIGNATURE_HEADER]: hex,
    }),
  };
}

function importKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

function hexToBytes(hex: string): Uint8Array<ArrayBuffer> | null {
  if (hex.length === 0 || hex.length % 2 !== 0 || !/^[0-9a-f]+$/i.test(hex))
    return null;

  const bytes = new Uint8Array(hex.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}
