import "server-only";
import { createTossClient, type TossClient } from "./toss-client";

/**
 * 테스트 키만 받는다. 실수로 라이브 키를 넣으면 실제 카드에서 돈이 나가므로 문서 규칙이 아니라 코드로 막는다.
 * 클라이언트 키는 공개 값이지만 NEXT_PUBLIC으로 두지 않는다. 빌드 없이 환경 변수로 바꾸고, 없으면 버튼을 숨기기 위해서다.
 */
export function tossClientKey(): string | null {
  const key = process.env.TOSS_CLIENT_KEY;
  return key?.startsWith("test_ck_") ? key : null;
}

export function tossClient(): TossClient | null {
  const key = process.env.TOSS_SECRET_KEY;
  return key?.startsWith("test_sk_") ? createTossClient(key) : null;
}

export function tossWebhookSecret(): string | undefined {
  return process.env.TOSS_WEBHOOK_SECRET || undefined;
}
