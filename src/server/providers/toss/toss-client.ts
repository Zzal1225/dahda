import { z } from "zod";

/**
 * 토스 서버 API. 근거는 docs/decisions/2026-11-05-토스-충전.md.
 * 시크릿 키는 이 폴더 밖으로 나가지 않는다.
 */
const BASE_URL = "https://api.tosspayments.com";
const TIMEOUT_MS = 30_000;

const paymentSchema = z.object({
  paymentKey: z.string().min(1),
  orderId: z.string().min(1),
  status: z.string().min(1),
  totalAmount: z.number(),
  approvedAt: z.string().nullish(),
});
export type TossPayment = z.infer<typeof paymentSchema>;

/**
 * unknown을 따로 둔다. 타임아웃과 5xx는 승인이 됐는지 알 수 없어, 실패로 처리하면
 * 돈은 나갔는데 충전이 안 된 상태를 확정하게 된다.
 */
export type TossResult =
  | { kind: "ok"; payment: TossPayment }
  | { kind: "rejected"; code: string }
  | { kind: "unknown" };

export interface TossClient {
  confirm(
    input: { paymentKey: string; orderId: string; amount: number },
    idempotencyKey: string,
  ): Promise<TossResult>;
  getPayment(paymentKey: string): Promise<TossResult>;
}

const errorSchema = z.object({ code: z.string() });

export function createTossClient(secretKey: string): TossClient {
  // 콜론까지 인코딩한다. 토스 문서의 "비밀번호 없음" 표시다.
  const authorization = `Basic ${Buffer.from(`${secretKey}:`).toString("base64")}`;

  async function call(
    path: string,
    init: { method: string; body?: string; idempotencyKey?: string },
  ): Promise<TossResult> {
    let response: Response;
    try {
      response = await fetch(`${BASE_URL}${path}`, {
        method: init.method,
        body: init.body,
        headers: {
          Authorization: authorization,
          "Content-Type": "application/json",
          ...(init.idempotencyKey
            ? { "Idempotency-Key": init.idempotencyKey }
            : {}),
        },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch {
      return { kind: "unknown" };
    }

    const json: unknown = await response.json().catch(() => null);
    if (response.ok) {
      const parsed = paymentSchema.safeParse(json);
      return parsed.success
        ? { kind: "ok", payment: parsed.data }
        : { kind: "unknown" };
    }
    // 409는 같은 멱등 키의 앞선 요청이 처리 중이라는 뜻이다. 결과가 아직 없다.
    if (response.status >= 500 || response.status === 409) {
      return { kind: "unknown" };
    }
    const error = errorSchema.safeParse(json);
    return error.success
      ? { kind: "rejected", code: error.data.code }
      : { kind: "unknown" };
  }

  return {
    confirm: (input, idempotencyKey) =>
      call("/v1/payments/confirm", {
        method: "POST",
        body: JSON.stringify(input),
        idempotencyKey,
      }),
    getPayment: (paymentKey) =>
      call(`/v1/payments/${encodeURIComponent(paymentKey)}`, { method: "GET" }),
  };
}
