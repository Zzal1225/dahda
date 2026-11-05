/**
 * 업로드의 수신 동의 칸을 해석한다. 동의를 잘못 추측하면 광고가 동의 없이 나가므로,
 * 모르는 값은 미동의로 넘기지 않고 오류로 보여 사용자가 고치게 한다.
 */
const YES = new Set(["y", "yes", "o", "true", "1", "예", "네", "동의"]);
const NO = new Set([
  "n",
  "no",
  "x",
  "false",
  "0",
  "아니오",
  "아니요",
  "미동의",
]);

const DAY_MS = 86_400_000;
// 엑셀 날짜 칸은 1899-12-30부터의 일수로 온다.
const EXCEL_EPOCH_MS = Date.UTC(1899, 11, 30);
const EXCEL_DAY_MIN = 36_526; // 2000-01-01
const EXCEL_DAY_MAX = 73_050; // 2099-12-31

/** 시트의 칸을 글자로 바꾼다. Worker에서 메인 스레드로 넘기고 고친 뒤 다시 검사하려면 글자여야 한다. */
export function cellToConsentText(cell: unknown): string | null {
  if (cell instanceof Date) return cell.toISOString().slice(0, 10);
  if (
    typeof cell === "number" &&
    cell >= EXCEL_DAY_MIN &&
    cell <= EXCEL_DAY_MAX
  ) {
    return new Date(EXCEL_EPOCH_MS + Math.floor(cell) * DAY_MS)
      .toISOString()
      .slice(0, 10);
  }
  const text = cell === null || cell === undefined ? "" : String(cell).trim();
  return text || null;
}

export type ConsentParse =
  { ok: true; consentAt: string | null } | { ok: false };

/** 비어 있거나 N이면 미동의, Y면 지금, 날짜면 그날(KST 0시)이다. 미래 날짜는 있을 수 없어 오류다. */
export function parseConsent(input: string | null, now: Date): ConsentParse {
  const text = input?.trim().toLowerCase() ?? "";
  if (!text || NO.has(text)) return { ok: true, consentAt: null };
  if (YES.has(text)) return { ok: true, consentAt: now.toISOString() };

  const match = /^(\d{4})[-./](\d{1,2})[-./](\d{1,2})$/.exec(text);
  if (!match) return { ok: false };
  const [year, month, day] = [
    Number(match[1]),
    Number(match[2]),
    Number(match[3]),
  ];
  const utc = new Date(Date.UTC(year, month - 1, day));
  // 2월 31일처럼 넘어가는 날짜를 거른다.
  if (utc.getUTCMonth() !== month - 1 || utc.getUTCDate() !== day) {
    return { ok: false };
  }
  const at = new Date(utc.getTime() - 9 * 3_600_000);
  if (at.getTime() > now.getTime()) return { ok: false };
  return { ok: true, consentAt: at.toISOString() };
}
