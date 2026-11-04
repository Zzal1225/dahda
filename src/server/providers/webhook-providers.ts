import "server-only";
import { createFakeProvider } from "./fake/fake-provider";
import type { SmsProvider } from "./sms-provider";

/**
 * 웹훅 경로의 이름으로 발송기를 찾는다. 서명 키가 없으면 없는 업체로 취급한다.
 * 키 없이 열어 두면 아무나 결과를 위조해 발송 건을 완료시키고 실패분을 환불받을 수 있다.
 */
export function webhookProviderFor(name: string): SmsProvider | null {
  if (name === "fake") {
    const secret = process.env.FAKE_WEBHOOK_SECRET;
    if (!secret) return null;
    return createFakeProvider({
      secret,
      // 여기서는 검증과 해석만 한다. 발송은 워커 쪽 인스턴스가 한다.
      deliver: async () => {},
      onDeliveryError: () => {},
    });
  }
  return null;
}
