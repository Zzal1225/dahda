const wonFormatter = new Intl.NumberFormat("ko-KR");

/** 핸드오프 형식 ₩1,234,567. Intl의 통화 형식은 환경에 따라 기호가 달라져 숫자만 맡긴다. */
export function formatWon(amount: number): string {
  const sign = amount < 0 ? "-" : "";
  return `${sign}₩${wonFormatter.format(Math.abs(amount))}`;
}

/** 010-1234-5678, 02-123-4567 형식. DB에는 숫자만 있고 표시할 때만 나눈다. 모르는 길이는 그대로 둔다. */
export function formatPhone(digits: string): string {
  if (
    digits.startsWith("02") &&
    (digits.length === 9 || digits.length === 10)
  ) {
    return `02-${digits.slice(2, -4)}-${digits.slice(-4)}`;
  }
  if (digits.length === 10 || digits.length === 11) {
    return `${digits.slice(0, 3)}-${digits.slice(3, -4)}-${digits.slice(-4)}`;
  }
  if (digits.length === 8) return `${digits.slice(0, 4)}-${digits.slice(4)}`;
  return digits;
}
