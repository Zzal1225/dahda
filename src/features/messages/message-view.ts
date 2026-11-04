import type { StatusTone } from "@/features/campaigns/campaign-view";
import type { MessageRow } from "./message-query";

export const MESSAGE_STATUS_VIEW: Record<
  MessageRow["status"],
  { label: string; tone: StatusTone }
> = {
  queued: { label: "대기", tone: "idle" },
  sent: { label: "접수", tone: "sent" },
  delivered: { label: "도착", tone: "delivered" },
  failed: { label: "실패", tone: "failed" },
};

// 시안의 샘플 코드다. 실제 업체 코드는 step4에서 공식 문서를 확인해 어댑터에서 바꾼다.
const FAIL_REASONS: Record<string, string> = {
  E301: "결번",
  E302: "수신 거부(080)",
  E410: "단말기 꺼짐",
  E503: "통신사 일시 오류",
  E201: "스팸 차단",
};

export function failReason(code: string | null): string {
  return code ? (FAIL_REASONS[code] ?? "") : "";
}

/** 표의 줄 번호를 페이지 번호로 바꾼다. 페이지와 줄 번호 모두 화면 기준이고 page는 1부터다. */
export function pageOfIndex(index: number, pageSize: number): number {
  return Math.floor(index / pageSize) + 1;
}

/** 화면에 보이는 줄 범위를 덮는 페이지 목록. 서버에는 이 페이지들만 요청한다. */
export function pagesForRange(
  startIndex: number,
  endIndex: number,
  pageSize: number,
): number[] {
  if (endIndex < startIndex) return [];
  const first = pageOfIndex(startIndex, pageSize);
  const last = pageOfIndex(endIndex, pageSize);
  return Array.from(
    { length: last - first + 1 },
    (_, offset) => first + offset,
  );
}
