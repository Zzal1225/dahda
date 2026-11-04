// Edge Function(Deno)도 이 파일을 불러온다. Deno는 타입 전용 import도 경로를 확인하므로 별칭 없이 확장자까지 적는다.
import type { Database } from "../../server/db/database.types.ts";

/**
 * 상태 전이 규칙은 이 파일 하나에만 둔다. 큐 워커와 웹훅이 각자 판단하면 한쪽만 고쳐져 어긋난다.
 *
 * DB를 부르지 않는 순수 함수인 이유: 역행·중복·역순의 모든 조합을 DB 없이 표로 검사할 수 있다.
 * 대신 "읽고 판단하고 쓰기" 사이에 다른 요청이 끼어들 수 있으므로, 호출하는 쪽은 저장할 때
 * `where status = 읽은 상태` 조건을 붙이고 0건이면 다시 읽어 판단해야 한다.
 */

type Enums = Database["public"]["Enums"];
export type MessageStatus = Enums["message_status"];
export type CampaignStatus = Enums["campaign_status"];
export type MemberRole = Enums["member_role"];

// ---------------------------------------------------------------------------
// 메시지
// ---------------------------------------------------------------------------

export type MessageState = {
  status: MessageStatus;
  providerMessageId: string | null;
  failCode: string | null;
  sentAt: Date | null;
  finalizedAt: Date | null;
};

export type MessageEvent =
  // 워커: 업체가 접수함
  | { type: "accepted"; providerMessageId: string; at: Date }
  // 워커: 영구 오류이거나 재시도 소진
  | { type: "send_failed"; failCode: string; at: Date }
  // 웹훅: 결과 확정
  | { type: "delivered"; providerMessageId: string; at: Date }
  | { type: "failed"; providerMessageId: string; failCode: string; at: Date };

/**
 * webhook_events.process_result에 그대로 남겨 중복·역순 도착을 나중에 추적한다.
 * - applied: 상태가 바뀜
 * - recorded_late: 상태는 그대로, 늦게 온 접수 정보만 채움
 * - ignored_final / ignored_stale: 저장할 것 없음
 */
export type MessageOutcome =
  "applied" | "recorded_late" | "ignored_final" | "ignored_stale";

export type MessageTransition = {
  state: MessageState;
  outcome: MessageOutcome;
};

export function isFinalMessageStatus(status: MessageStatus): boolean {
  return status === "delivered" || status === "failed";
}

export function transitionMessage(
  state: MessageState,
  event: MessageEvent,
): MessageTransition {
  switch (event.type) {
    case "accepted":
      return applyAccepted(state, event);
    case "send_failed":
      if (state.status !== "queued") {
        // sent라면 업체가 이미 받았으므로 결과는 웹훅이 정한다. 여기서 실패로 확정하면 실제 도착과 어긋난다.
        return ignore(state);
      }
      return {
        state: {
          ...state,
          status: "failed",
          failCode: event.failCode,
          finalizedAt: event.at,
        },
        outcome: "applied",
      };
    case "delivered":
      return applyResult(state, event, "delivered", null);
    case "failed":
      return applyResult(state, event, "failed", event.failCode);
  }
}

function applyAccepted(
  state: MessageState,
  event: Extract<MessageEvent, { type: "accepted" }>,
): MessageTransition {
  if (state.status === "queued") {
    return {
      state: {
        ...state,
        status: "sent",
        providerMessageId: event.providerMessageId,
        sentAt: event.at,
      },
      outcome: "applied",
    };
  }

  if (state.status === "sent") return ignore(state); // 같은 접수를 두 번 기록하는 경우

  // 웹훅이 워커의 기록보다 먼저 온 경우다. 최종 상태는 유지하고, 웹훅에 없던 접수 시각만 채운다.
  if (state.sentAt !== null && state.providerMessageId !== null)
    return ignore(state);
  return {
    state: {
      ...state,
      providerMessageId: state.providerMessageId ?? event.providerMessageId,
      sentAt: state.sentAt ?? event.at,
    },
    outcome: "recorded_late",
  };
}

function applyResult(
  state: MessageState,
  event: Extract<MessageEvent, { type: "delivered" | "failed" }>,
  status: "delivered" | "failed",
  failCode: string | null,
): MessageTransition {
  // 먼저 도착한 결과를 확정으로 본다. 같은 이벤트의 중복은 결과가 같지만,
  // delivered와 failed가 모두 오는 경우에는 도착 순서에 따라 결과가 달라진다. 그런 응답은 webhook_events에서 찾는다.
  if (isFinalMessageStatus(state.status)) return ignore(state);

  // queued에서도 받는다. 업체 결과는 이미 사실이므로, 버리면 웹훅이 다시 오지 않을 때 영영 확정되지 않는다.
  return {
    state: {
      ...state,
      status,
      providerMessageId: state.providerMessageId ?? event.providerMessageId,
      failCode,
      finalizedAt: event.at,
    },
    outcome: "applied",
  };
}

function ignore(state: MessageState): MessageTransition {
  return {
    state,
    outcome: isFinalMessageStatus(state.status)
      ? "ignored_final"
      : "ignored_stale",
  };
}

// ---------------------------------------------------------------------------
// 발송 건
// ---------------------------------------------------------------------------

export type CampaignEvent =
  | { type: "submit_for_approval" }
  | { type: "schedule" }
  | { type: "approve" }
  | { type: "reject"; reason: string }
  | { type: "start_sending" }
  | {
      type: "complete";
      recipientCount: number;
      deliveredCount: number;
      failedCount: number;
    }
  | { type: "cancel"; approved: boolean };

export type CampaignTransitionError =
  | "invalid_transition"
  | "reason_required"
  | "not_all_final"
  | "approved_cannot_cancel";

export type CampaignTransition =
  | { ok: true; status: CampaignStatus; rejectedReason?: string }
  | { ok: false; error: CampaignTransitionError };

// 적힌 칸만 허용한다. 빠뜨린 전이는 실패로 드러나지만, 금지 목록 방식은 빠뜨리면 조용히 열린다.
// 작성 중이거나 승인 대기인 건의 취소는 넣지 않았다. 그 동작을 쓰는 화면이 정해지면 추가한다.
const CAMPAIGN_TRANSITIONS: Readonly<
  Record<CampaignStatus, Partial<Record<CampaignEvent["type"], CampaignStatus>>>
> = {
  draft: { submit_for_approval: "pending_approval", schedule: "scheduled" },
  pending_approval: { approve: "scheduled", reject: "rejected" },
  scheduled: { start_sending: "sending", cancel: "canceled" },
  sending: { complete: "completed" },
  rejected: {},
  completed: {},
  canceled: {},
};

export function transitionCampaign(
  current: CampaignStatus,
  event: CampaignEvent,
): CampaignTransition {
  const next = CAMPAIGN_TRANSITIONS[current][event.type];
  if (!next) return { ok: false, error: "invalid_transition" };

  if (event.type === "reject") {
    const reason = event.reason.trim();
    if (!reason) return { ok: false, error: "reason_required" };
    return { ok: true, status: next, rejectedReason: reason };
  }

  // 승인 대화상자가 "승인 후에는 취소할 수 없어요"라고 안내한다. 승인 여부는 상태에 남지 않아 입력으로 받는다.
  if (event.type === "cancel" && event.approved) {
    return { ok: false, error: "approved_cannot_cancel" };
  }

  if (event.type === "complete") {
    const finalCount = event.deliveredCount + event.failedCount;
    if (finalCount !== event.recipientCount)
      return { ok: false, error: "not_all_final" };
  }

  return { ok: true, status: next };
}

/** 광고 승인 규칙. 본사가 직접 쓴 광고는 승인할 사람이 자신이라 단계를 건너뛴다. */
export function submitEventType(input: {
  isAd: boolean;
  authorRole: MemberRole;
}): "submit_for_approval" | "schedule" {
  return input.isAd && input.authorRole === "branch"
    ? "submit_for_approval"
    : "schedule";
}
