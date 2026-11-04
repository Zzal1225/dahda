/**
 * 재시도 간격. 짧은 장애는 1분이면 지나가고, 업체 점검처럼 긴 장애에 계속 두드려 봐야 실패만 쌓이므로 간격을 늘린다.
 * 집을 때 시도 횟수를 올리므로 attemptCount는 방금 끝난 시도까지 포함한 값이다.
 */
const RETRY_DELAYS_MS = [60_000, 5 * 60_000, 30 * 60_000] as const;

/** 첫 시도 + 재시도 3회 */
export const MAX_ATTEMPTS = RETRY_DELAYS_MS.length + 1;

/** 다음 시도까지의 시간. null이면 재시도 소진이다. */
export function retryDelayMs(attemptCount: number): number | null {
  return RETRY_DELAYS_MS[attemptCount - 1] ?? null;
}
