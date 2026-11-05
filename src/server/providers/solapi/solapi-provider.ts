import { z } from "zod";
import type {
  LookupResult,
  SendRequest,
  SendResult,
  SmsProvider,
  WebhookEvent,
  WebhookRequest,
} from "../sms-provider.ts";

/**
 * 솔라피 어댑터. 근거와 확인 못 한 것은 docs/decisions/2026-11-04-솔라피-연동.md.
 *
 * SDK를 직접 부르지 않고 SolapiClient로 받는다. 웹훅만 처리하는 Next.js 쪽은 SDK를 불러올 필요가 없고,
 * 응답 조합을 테스트하기 쉽다.
 */

/** customFields의 키 이름. 응답과 웹훅에 그대로 돌아와 우리 메시지와 잇는 유일한 수단이다. */
const KEY_FIELD = "k";
const SECRET_HEADER = "x-solapi-secret";
const EVENT_HEADER = "x-solapi-event-name";

const DELIVERED_CODE = "4000";
// 접수 단계의 코드다. 결과가 아니므로 무시해야 한다. 실패로 처리하면 곧 도착할 문자를 환불하게 된다.
const IN_PROGRESS_CODES = new Set(["2000", "3000"]);
// 확인 필요: 문서는 일시·영구를 구분하지 않는다. "서버 오류" 설명을 보고 일시 오류로 판단한 값이다.
const RETRYABLE_CODES = new Set(["1024", "2024", "3024"]);

export type SolapiMessage = {
  to: string;
  from: string;
  text: string;
  type: "SMS" | "LMS";
  customFields: Record<string, string>;
};

type ResultItem = {
  messageId?: string;
  statusCode: string;
  customFields?: Readonly<Record<string, string>> | null;
};

export type SolapiStoredMessage = {
  messageId: string;
  statusCode?: string | null;
  dateReceived?: string | null;
  dateReported?: string | null;
};

export type SolapiResponse = {
  messageList?: readonly ResultItem[];
  failedMessageList: readonly ResultItem[];
};

export interface SolapiClient {
  send(messages: readonly SolapiMessage[]): Promise<SolapiResponse>;
  getMessages?(ids: readonly string[]): Promise<SolapiStoredMessage[]>;
}

/** 다시 보내도 결과가 같은 경우. failCode는 그대로 메시지의 실패 사유가 된다. */
export class SolapiRejected extends Error {
  readonly failCode: string;
  constructor(failCode: string, message: string) {
    super(message);
    this.failCode = failCode;
  }
}

// 조회 한 번에 묻는 수. 문서상 응답 상한은 500건이고, 주소 길이가 먼저 한계가 되지 않게 작게 둔다.
const LOOKUP_CHUNK = 100;

const reportSchema = z.array(
  z.object({
    messageId: z.string().min(1),
    statusCode: z.string().min(1),
    customFields: z.record(z.string(), z.string()).nullish(),
    dateReceived: z.string().nullish(),
    dateReported: z.string().nullish(),
    dateProcessed: z.string().nullish(),
  }),
);

export function createSolapiProvider(options: {
  webhookSecret: string;
  /** 없으면 웹훅 전용이다. */
  client?: SolapiClient;
  now?: () => Date;
}): SmsProvider {
  if (!options.webhookSecret) throw new Error("솔라피 웹훅 키가 비어 있다");
  const now = options.now ?? (() => new Date());

  return {
    name: "solapi",

    async send(batch: readonly SendRequest[]): Promise<SendResult[]> {
      const rejectAll = (failCode: string, retryable: boolean): SendResult[] =>
        batch.map((request) => ({
          idempotencyKey: request.idempotencyKey,
          outcome: "rejected",
          failCode,
          retryable,
        }));

      if (!options.client) return rejectAll("SOLAPI_NO_CLIENT", false);

      let response: SolapiResponse;
      try {
        response = await options.client.send(
          batch.map((request) => ({
            to: request.to,
            from: request.from,
            text: request.body,
            type: request.kind === "lms" ? "LMS" : "SMS",
            customFields: { [KEY_FIELD]: request.idempotencyKey },
          })),
        );
      } catch (cause) {
        // 삼키면 왜 안 나갔는지 알 길이 없다. 키는 SDK 메시지에 들어가지 않고, 수신번호도 넣지 않는다.
        console.error("솔라피 발송 실패", describeError(cause));
        if (cause instanceof SolapiRejected) {
          return rejectAll(cause.failCode, false);
        }
        // 확인 필요: 솔라피에는 멱등 키가 없다. 응답만 끊긴 경우 재시도가 중복 발송이 될 수 있다.
        // 기획서대로 네트워크·5xx는 재시도하되 위험은 결정 기록에 남겼다.
        return rejectAll("SOLAPI_UNAVAILABLE", true);
      }

      const accepted = new Map<string, string>();
      for (const item of response.messageList ?? []) {
        const key = item.customFields?.[KEY_FIELD];
        if (key && item.messageId) accepted.set(key, item.messageId);
      }
      const failed = new Map<string, string>();
      for (const item of response.failedMessageList) {
        const key = item.customFields?.[KEY_FIELD];
        if (key) failed.set(key, item.statusCode);
      }

      return batch.map((request): SendResult => {
        const key = request.idempotencyKey;
        const providerMessageId = accepted.get(key);
        if (providerMessageId) {
          return {
            idempotencyKey: key,
            outcome: "accepted",
            providerMessageId,
          };
        }
        const failCode = failed.get(key);
        if (failCode) {
          return {
            idempotencyKey: key,
            outcome: "rejected",
            failCode,
            retryable: RETRYABLE_CODES.has(failCode),
          };
        }
        // 응답은 성공인데 이 건을 찾지 못했다. 접수됐을 수 있으므로 다시 보내지 않는다.
        // 실제 문자라 중복 발송이 환불보다 나쁘다. 결과 코드로 찾아낼 수 있게 남긴다.
        return {
          idempotencyKey: key,
          outcome: "rejected",
          failCode: "SOLAPI_NO_RESULT",
          retryable: false,
        };
      });
    },

    async fetchResults(ids: readonly string[]): Promise<LookupResult[]> {
      const getMessages = options.client?.getMessages;
      if (!getMessages) throw new Error("솔라피 조회 클라이언트가 없다");

      const results: LookupResult[] = [];
      for (let start = 0; start < ids.length; start += LOOKUP_CHUNK) {
        const items = await getMessages(ids.slice(start, start + LOOKUP_CHUNK));
        for (const item of items) {
          const code = item.statusCode;
          const providerMessageId = item.messageId;
          const reported = item.dateReceived ?? item.dateReported;
          const parsed = reported ? new Date(reported) : null;
          const occurredAt =
            parsed && !Number.isNaN(parsed.getTime()) ? parsed : null;
          if (!code || IN_PROGRESS_CODES.has(code)) {
            results.push({ providerMessageId, status: "pending" });
          } else if (code === DELIVERED_CODE) {
            results.push({
              providerMessageId,
              status: "delivered",
              occurredAt,
            });
          } else {
            results.push({
              providerMessageId,
              status: "failed",
              failCode: code,
              occurredAt,
            });
          }
        }
      }
      return results;
    },

    parseWebhook(request: WebhookRequest): WebhookEvent[] {
      // GROUP-REPORT 같은 다른 이벤트는 메시지 결과가 아니다.
      if (request.headers.get(EVENT_HEADER) !== "SINGLE-REPORT") return [];

      const reports = reportSchema.parse(JSON.parse(request.rawBody));
      return reports.flatMap((report): WebhookEvent[] => {
        if (IN_PROGRESS_CODES.has(report.statusCode)) return [];
        const shared = {
          providerMessageId: report.messageId,
          idempotencyKey: report.customFields?.[KEY_FIELD] ?? null,
          occurredAt: reportTime(report, now()),
        };
        return report.statusCode === DELIVERED_CODE
          ? [{ ...shared, status: "delivered" }]
          : [{ ...shared, status: "failed", failCode: report.statusCode }];
      });
    },

    /**
     * 솔라피는 본문 서명을 주지 않고 비밀값의 SHA1을 그대로 헤더에 싣는다.
     * 그래서 본문 위조와 재전송은 여기서 막지 못한다. 재전송은 상태 전이가 무시하고, 값이 새지 않게 HTTPS만 쓴다.
     */
    async verifySignature(request: WebhookRequest): Promise<boolean> {
      const actual = request.headers.get(SECRET_HEADER);
      if (!actual) return false;

      const digest = await crypto.subtle.digest(
        "SHA-1",
        new TextEncoder().encode(options.webhookSecret),
      );
      const expected = Array.from(new Uint8Array(digest), (byte) =>
        byte.toString(16).padStart(2, "0"),
      ).join("");
      return timingSafeEqual(actual.toLowerCase(), expected);
    },
  };
}

function describeError(cause: unknown): string {
  const text =
    cause instanceof Error ? `${cause.name}: ${cause.message}` : String(cause);
  return text.slice(0, 300);
}

function reportTime(
  report: z.infer<typeof reportSchema>[number],
  fallback: Date,
): Date {
  for (const value of [
    report.dateReceived,
    report.dateReported,
    report.dateProcessed,
  ]) {
    if (value) {
      const date = new Date(value);
      if (!Number.isNaN(date.getTime())) return date;
    }
  }
  return fallback;
}

/** 문자열 비교는 일치하는 앞부분 길이가 응답 시간에 드러난다. */
function timingSafeEqual(a: string, b: string): boolean {
  let difference = a.length ^ b.length;
  for (let index = 0; index < b.length; index += 1) {
    difference |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }
  return difference === 0;
}
