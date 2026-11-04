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

// E로 시작하는 코드는 가짜 발송기가 쓰는 시안의 샘플이다.
const FAIL_REASONS: Record<string, string> = {
  E301: "결번",
  E302: "수신 거부(080)",
  E410: "단말기 꺼짐",
  E503: "통신사 일시 오류",
  E201: "스팸 차단",
  // 우리가 정한 코드
  BLOCKED_RECIPIENT: "허용되지 않은 번호",
  DAILY_LIMIT: "하루 발송 상한 초과",
  RETRY_EXHAUSTED: "재시도 횟수 초과",
  SOLAPI_NO_RESULT: "접수 결과 확인 불가",
  SOLAPI_BAD_REQUEST: "잘못된 발송 요청",
  SOLAPI_UNAVAILABLE: "문자 업체 일시 오류",
  // 솔라피. 출처: https://solapi.com/developers/api/msgstatus (2026-11-04 확인)
  "1060": "차단된 발신번호",
  "1062": "발신번호 미등록",
  "2062": "발신번호 미등록",
  "1061": "수신 거부(080)",
  "2061": "수신 거부(080)",
  "3061": "수신 거부(080)",
  "1030": "문자 업체 잔액 부족",
  "2230": "문자 업체 잔액 부족",
  "3010": "수신번호 형식 오류",
  "3032": "미가입 번호",
  "3047": "착신 거절",
  "3050": "문자를 받을 수 없는 단말기",
  "3054": "스팸 차단",
  "3055": "스팸 차단",
  "3040": "전송 시간 초과",
  "3041": "단말기 통화 중",
  "3042": "음영 지역",
  "3043": "단말기 꺼짐",
  "3044": "단말기 저장 공간 초과",
  "5000": "수신 실패",
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

/**
 * 다시 보내도 실패할 가능성이 높은 코드. 재발송 확인 대화상자의 경고에 쓴다(핸드오프).
 * 확인 필요: 솔라피 문서는 코드를 영구·일시로 나누지 않는다. 설명을 보고 고른 값이다.
 */
export const HOPELESS_FAIL_CODES = [
  "E301",
  "E302",
  "E201",
  "1061",
  "2061",
  "3061",
  "3010",
  "3032",
  "3054",
  "3055",
] as const;
