import type { MessageOutcome } from "../../features/campaigns/status.ts";

/**
 * 메시지별 결과 기록(message_events) 한 줄. 화면의 "수신자 기록"이 이 줄을 시간순으로 보여 준다.
 * 상태 열은 최종 결과만 남기므로, 중복·역순 도착을 어떻게 처리했는지는 여기서만 보인다.
 * 이 폴더는 Deno(Edge Function)에서도 불러오므로 import에 확장자를 적는다.
 */
export type MessageEventSource = "worker" | "webhook" | "reconcile";

export type MessageEventKind =
  "accepted" | "retry" | "deferred" | "send_failed" | "delivered" | "failed";

/** retry·deferred는 상태 전이가 아니라 다시 줄을 세운 것이라 scheduled다. */
export type MessageEventOutcome = MessageOutcome | "scheduled";

export type MessageEventLog = {
  messageId: number;
  source: MessageEventSource;
  kind: MessageEventKind;
  outcome: MessageEventOutcome;
  failCode: string | null;
  /** 업체나 워커가 말한 시각. 받은 시각(DB 기본값)과 비교해 역순 도착을 읽는다. */
  occurredAt: Date;
};

export interface EventLogStore {
  recordEvents(events: readonly MessageEventLog[]): Promise<void>;
}

/**
 * 기록은 보여 주기용이라 실패해도 상태 전이를 되돌리거나 재시도를 유도하지 않는다.
 * 여기서 던지면 웹훅이 500을 돌려 업체가 다시 보내고, 워커는 이미 저장한 결과를 두고 멈춘다.
 * 원본 사실은 webhook_events에 남아 있다.
 */
export async function recordSafely(
  store: EventLogStore,
  events: readonly MessageEventLog[],
): Promise<void> {
  if (events.length === 0) return;
  try {
    await store.recordEvents(events);
  } catch (error) {
    console.error("메시지 기록 저장 실패", error);
  }
}
