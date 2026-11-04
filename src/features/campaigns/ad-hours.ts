import { kstHour, nextKstHour } from "../../lib/kst.ts";

/**
 * 광고 야간 전송 제한(21시~8시). 출처는 docs/decisions/2026-11-04-광고-문자-규칙과-바이트-기준.md.
 *
 * 작성 스키마에서 분리한 이유: Edge Function의 워커도 같은 규칙을 써야 하는데, 스키마는 폼 전용 의존성을 끌고 온다.
 * Deno에서도 불러오므로 확장자까지 적는다.
 */
const NIGHT_START_HOUR = 21;
const NIGHT_END_HOUR = 8;

export function isNightKst(date: Date): boolean {
  const hour = kstHour(date);
  return hour >= NIGHT_START_HOUR || hour < NIGHT_END_HOUR;
}

/** 야간에 걸린 광고를 다시 보낼 수 있는 가장 빠른 시각 */
export function nextAdSendableAt(now: Date): Date {
  return nextKstHour(now, NIGHT_END_HOUR);
}
