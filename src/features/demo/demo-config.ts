import { normalizePhone } from "@/lib/phone";

/**
 * 값이 없으면 체험 문자 화면을 숨긴다. 미구현 기능은 숨기는 규칙이고, 설정 실수에도 닫혀 있게 한다.
 * 워커도 자기 환경의 같은 이름 값과 대조하므로 한쪽만 설정하면 문자가 나가지 않는다.
 */
export function demoSenderNumber(): string | null {
  return normalizePhone(process.env.DEMO_SENDER_NUMBER ?? "");
}
