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

/**
 * 표에서 가운데 자리를 가린 번호. 010-****-0001, 011-***-4567, 02-***-4567.
 * 목록은 여러 사람이 한 화면에 모여 어깨 너머로 보이기 쉬워 가리고, 한 사람을 고른 상세(드로어)에서만 전체를 보인다.
 * 하이픈·공백이 섞여 와도 숫자만 보고 판단한다. 번호 형식이 아니면 끝 4자리만 남기고 모두 가린다.
 * 원래 값을 그대로 돌려주지 않는 이유: 잘못 저장된 값이라도 실제 번호일 수 있어, 가리는 함수가 새는 길이 되면 안 된다.
 */
export function maskPhone(value: string): string {
  const digits = value.replace(/[\s-]/g, "");
  if (!/^[0-9]+$/.test(digits)) return "****";
  const formatted = formatPhone(digits);
  const parts = formatted.split("-");
  if (parts.length === 3) {
    const [head = "", middle = "", tail = ""] = parts;
    return `${head}-${"*".repeat(middle.length)}-${tail}`;
  }
  if (digits.length <= 4) return "*".repeat(digits.length);
  return `${"*".repeat(digits.length - 4)}${digits.slice(-4)}`;
}
