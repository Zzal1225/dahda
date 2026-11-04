const wonFormatter = new Intl.NumberFormat("ko-KR");

/** 핸드오프 형식 ₩1,234,567. Intl의 통화 형식은 환경에 따라 기호가 달라져 숫자만 맡긴다. */
export function formatWon(amount: number): string {
  const sign = amount < 0 ? "-" : "";
  return `${sign}₩${wonFormatter.format(Math.abs(amount))}`;
}

/** 핸드오프의 "잔액 적음" 기준은 100만 원 미만이다. */
export const LOW_BALANCE_THRESHOLD = 1_000_000;

export function isLowBalance(amount: number): boolean {
  return amount < LOW_BALANCE_THRESHOLD;
}
