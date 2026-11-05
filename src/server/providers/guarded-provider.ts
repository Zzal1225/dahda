import { DEMO_SMS_BODY } from "./demo-sms.ts";
import type { SendRequest, SendResult, SmsProvider } from "./sms-provider.ts";

/**
 * 실제 발송 안전장치. 어댑터 앞단에서 코드로 막는다(CLAUDE.md).
 * 설정이 비어 있거나 상한 확인이 실패하면 보내지 않는다. 안전장치가 고장 났을 때 열리면 장치가 아니다.
 */
export type GuardOptions = {
  /** 이 요청을 보내도 되는지. 경로마다 규칙이 다르고 상한은 같다. */
  isAllowed: (request: SendRequest) => boolean;
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

/** 일반 실제 발송. 허용 목록이 비어 있으면 아무에게도 보내지 않는다. */
export function allowRecipients(
  recipients: ReadonlySet<string>,
): (request: SendRequest) => boolean {
  return (request) => recipients.has(request.to);
}

/**
 * 체험 문자. 수신번호가 열려 있는 유일한 경로라 내용과 발신번호를 여기서 다시 확인한다.
 * DB 플래그만 믿으면 다른 경로의 실수가 임의 내용을 임의 번호로 보내는 사고가 된다.
 * 발신번호 설정이 없으면 어떤 요청도 일치하지 않아 닫힌다.
 */
export function allowDemoRequest(
  senderNumber: string | undefined,
): (request: SendRequest) => boolean {
  return (request) =>
    Boolean(senderNumber) &&
    request.from === senderNumber &&
    request.body === DEMO_SMS_BODY &&
    request.kind === "sms" &&
    request.to.startsWith("01");
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
      const allowed = batch.filter(options.isAllowed);
      const blocked = batch
        .filter((request) => !options.isAllowed(request))
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

/**
 * 체험 계정이 실제로 보내는 유일한 경우. SMS_PROVIDER가 solapi가 아니면(CI, 테스트, 로컬) 플래그가 있어도 가짜다.
 */
export function usesRealDemo(input: {
  isRealDemo: boolean;
  smsProvider: string | undefined;
}): boolean {
  return input.isRealDemo && input.smsProvider === "solapi";
}

/** 체험 계정의 일반 발송은 설정과 무관하게 가짜 발송기다. 이 판단은 전역 설정보다 앞선다. */
export function usesRealProvider(input: {
  isTrial: boolean;
  smsProvider: string | undefined;
}): boolean {
  return !input.isTrial && input.smsProvider === "solapi";
}
