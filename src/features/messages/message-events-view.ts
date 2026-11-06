import type {
  MessageEventKind,
  MessageEventOutcome,
  MessageEventSource,
} from "@/server/queue/event-log";

/**
 * 수신자 기록 한 줄. 받은 시각 순서로 보여 주고, 업체가 말한 시각이 앞 줄보다 이르면 "순서 바뀜"으로 표시한다.
 * 상태 열은 최종 결과만 보여 주므로, 중복·역순 도착을 어떻게 처리했는지는 이 기록에서만 보인다.
 */
export type MessageEventRow = {
  id: number;
  source: MessageEventSource;
  kind: MessageEventKind;
  outcome: MessageEventOutcome;
  failCode: string | null;
  occurredAt: string;
  receivedAt: string;
};

export const SOURCE_LABEL: Record<MessageEventSource, string> = {
  worker: "워커",
  webhook: "웹훅",
  reconcile: "업체 조회",
};

export const KIND_LABEL: Record<MessageEventKind, string> = {
  accepted: "업체 접수",
  retry: "재시도 예약",
  deferred: "야간이라 보류",
  send_failed: "발송 실패",
  delivered: "도착",
  failed: "실패",
};

/** 운영자가 읽을 말로 쓴다. "ignored_final"은 코드라 뜻을 모른다. */
export const OUTCOME_VIEW: Record<
  MessageEventOutcome,
  { label: string; muted: boolean }
> = {
  applied: { label: "반영", muted: false },
  recorded_late: { label: "결과가 먼저 와서 접수 정보만 채움", muted: false },
  ignored_final: { label: "이미 확정돼 무시(중복)", muted: true },
  ignored_stale: { label: "이미 지난 단계라 무시", muted: true },
  scheduled: { label: "다시 대기", muted: false },
};

export type MessageEventView = MessageEventRow & {
  /** 업체가 말한 시각이 앞서 받은 줄보다 이르다. 늦게 도착한 사실이다. */
  outOfOrder: boolean;
};

/**
 * 받은 시각순으로 정렬해 순서 바뀜을 표시한다. 같은 시각은 id로 정해 새로고침해도 순서가 같다.
 * 비교 기준을 "앞 줄들 중 가장 늦은 업체 시각"으로 둔다. 바로 앞 줄만 보면 두 줄이 연달아 늦게 오면 두 번째를 놓친다.
 */
export function toEventViews(
  rows: readonly MessageEventRow[],
): MessageEventView[] {
  const sorted = [...rows].sort(
    (a, b) =>
      Date.parse(a.receivedAt) - Date.parse(b.receivedAt) || a.id - b.id,
  );
  let latest = -Infinity;
  return sorted.map((row) => {
    const occurred = Date.parse(row.occurredAt);
    const outOfOrder = occurred < latest;
    latest = Math.max(latest, occurred);
    return { ...row, outOfOrder };
  });
}
