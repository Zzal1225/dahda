import type { SendRequest, SendResult, SmsProvider } from "./sms-provider.ts";

/**
 * 실제 발송 안전장치. 어댑터 앞단에서 코드로 막는다(CLAUDE.md).
 * 설정이 비어 있거나 상한 확인이 실패하면 보내지 않는다. 안전장치가 고장 났을 때 열리면 장치가 아니다.
 */
export type GuardOptions = {
  /** 허용 수신번호. 비어 있으면 아무에게도 보내지 않는다. */
  allowedRecipients: ReadonlySet<string>;
  dailyLimit: number;
  /** 보내기 전에 상한을 예약하고, 보내도 되는 건수를 돌려준다. */
  reserve: (count: number, limit: number) => Promise<number>;
};

export function parseAllowedRecipients(value: string | undefined): Set<string> {
  return new Set(
    (value ?? "")
      .split(",")
      .map((phone) => phone.replace(/\D/g, ""))
      .filter((phone) => phone.length > 0),
  );
}

export function createGuardedProvider(
  inner: SmsProvider,
  options: GuardOptions,
): SmsProvider {
  const reject = (
    request: SendRequest,
    failCode: string,
    retryable: boolean,
  ): SendResult => ({
    idempotencyKey: request.idempotencyKey,
    outcome: "rejected",
    failCode,
    retryable,
  });

  return {
    ...inner,
    async send(batch) {
      const allowed = batch.filter((request) =>
        options.allowedRecipients.has(request.to),
      );
      const blocked = batch
        .filter((request) => !options.allowedRecipients.has(request.to))
        .map((request) => reject(request, "BLOCKED_RECIPIENT", false));
      if (allowed.length === 0) return blocked;

      let granted: number;
      try {
        granted = await options.reserve(allowed.length, options.dailyLimit);
      } catch {
        return [
          ...blocked,
          ...allowed.map((request) =>
            reject(request, "GUARD_UNAVAILABLE", true),
          ),
        ];
      }

      const overLimit = allowed
        .slice(granted)
        .map((request) => reject(request, "DAILY_LIMIT", false));
      const sendable = allowed.slice(0, granted);
      const sent = sendable.length > 0 ? await inner.send(sendable) : [];
      return [...blocked, ...overLimit, ...sent];
    },
  };
}

/** 체험 계정은 설정과 무관하게 가짜 발송기다. 이 판단은 전역 설정보다 앞선다. */
export function usesRealProvider(input: {
  isTrial: boolean;
  smsProvider: string | undefined;
}): boolean {
  return !input.isTrial && input.smsProvider === "solapi";
}
