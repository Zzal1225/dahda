/**
 * 날짜의 KST 변환은 이 파일에서만 한다(CLAUDE.md 규칙). DB는 UTC로 저장하고 화면은 KST로 보여 준다.
 * 실행 환경의 시간대에 기대면 로컬(KST)에서는 맞고 서버(UTC)에서는 틀리는 버그가 나므로 항상 명시한다.
 */
const TIME_ZONE = "Asia/Seoul";
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

const dateTimeParts = new Intl.DateTimeFormat("en-CA", {
  timeZone: TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

function parts(value: Date | string) {
  const map = new Map(
    dateTimeParts
      .formatToParts(new Date(value))
      .map((part) => [part.type, part.value]),
  );
  const get = (type: Intl.DateTimeFormatPartTypes) => map.get(type) ?? "";
  return {
    date: `${get("year")}.${get("month")}.${get("day")}`,
    day: `${get("year")}-${get("month")}-${get("day")}`,
    minute: `${get("hour")}:${get("minute")}`,
    second: `${get("hour")}:${get("minute")}:${get("second")}`,
  };
}

/** 2026.11.04 14:30 */
export function formatKstDateTime(value: Date | string): string {
  const { date, minute } = parts(value);
  return `${date} ${minute}`;
}

/** 14:30:05 */
export function formatKstTime(value: Date | string): string {
  return parts(value).second;
}

/** KST 그 날짜 0시의 UTC 시각. YYYY-MM-DD를 받는다. */
function kstDayStart(day: string): Date {
  return new Date(Date.parse(`${day}T00:00:00Z`) - KST_OFFSET_MS);
}

const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function validDay(day: string | null): day is string {
  return (
    day !== null &&
    DAY_PATTERN.test(day) &&
    !Number.isNaN(Date.parse(`${day}T00:00:00Z`))
  );
}

export type DateRange = { from: string | null; to: string | null };

/**
 * 기간 필터를 UTC 범위로 바꾼다. to는 포함하지 않는 끝이다(그날 23:59:59.999를 다루지 않으려고).
 * custom의 잘못된 날짜는 URL 입력이므로 조건 없음으로 처리한다.
 */
export function periodToRange(
  period: "today" | "7d" | "30d" | "custom",
  from: string | null,
  to: string | null,
  now: Date,
): DateRange {
  if (period === "custom") {
    return {
      from: validDay(from) ? kstDayStart(from).toISOString() : null,
      to: validDay(to)
        ? new Date(kstDayStart(to).getTime() + DAY_MS).toISOString()
        : null,
    };
  }

  const todayStart = kstDayStart(parts(now).day).getTime();
  // "7일"은 오늘을 포함한 7일이다.
  const days = period === "today" ? 1 : period === "7d" ? 7 : 30;
  return {
    from: new Date(todayStart - (days - 1) * DAY_MS).toISOString(),
    to: null,
  };
}
