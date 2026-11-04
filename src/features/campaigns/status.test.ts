import { describe, expect, it } from "vitest";
import {
  submitEventType,
  transitionCampaign,
  transitionMessage,
  type CampaignEvent,
  type CampaignStatus,
  type MessageEvent,
  type MessageOutcome,
  type MessageState,
  type MessageStatus,
} from "./status";

const T0 = new Date("2026-11-04T00:00:00Z");
const T1 = new Date("2026-11-04T00:00:01Z");
const T2 = new Date("2026-11-04T00:00:02Z");

function stateOf(status: MessageStatus): MessageState {
  switch (status) {
    case "queued":
      return {
        status,
        providerMessageId: null,
        failCode: null,
        sentAt: null,
        finalizedAt: null,
      };
    case "sent":
      return {
        status,
        providerMessageId: "p0",
        failCode: null,
        sentAt: T0,
        finalizedAt: null,
      };
    case "delivered":
      return {
        status,
        providerMessageId: "p0",
        failCode: null,
        sentAt: T0,
        finalizedAt: T0,
      };
    case "failed":
      return {
        status,
        providerMessageId: "p0",
        failCode: "E0",
        sentAt: T0,
        finalizedAt: T0,
      };
  }
}

const events = {
  accepted: { type: "accepted", providerMessageId: "p1", at: T1 },
  send_failed: { type: "send_failed", failCode: "E1", at: T1 },
  delivered: { type: "delivered", providerMessageId: "p1", at: T1 },
  failed: { type: "failed", providerMessageId: "p1", failCode: "E1", at: T1 },
} satisfies Record<string, MessageEvent>;

describe("transitionMessage 전체 조합", () => {
  // 상태 4개 × 이벤트 4개를 모두 적어, 새 이벤트를 추가할 때 빠진 칸이 없게 한다.
  const table: [
    MessageStatus,
    keyof typeof events,
    MessageStatus,
    MessageOutcome,
  ][] = [
    ["queued", "accepted", "sent", "applied"],
    ["queued", "send_failed", "failed", "applied"],
    ["queued", "delivered", "delivered", "applied"],
    ["queued", "failed", "failed", "applied"],
    ["sent", "accepted", "sent", "ignored_stale"],
    ["sent", "send_failed", "sent", "ignored_stale"],
    ["sent", "delivered", "delivered", "applied"],
    ["sent", "failed", "failed", "applied"],
    ["delivered", "accepted", "delivered", "ignored_final"],
    ["delivered", "send_failed", "delivered", "ignored_final"],
    ["delivered", "delivered", "delivered", "ignored_final"],
    ["delivered", "failed", "delivered", "ignored_final"],
    ["failed", "accepted", "failed", "ignored_final"],
    ["failed", "send_failed", "failed", "ignored_final"],
    ["failed", "delivered", "failed", "ignored_final"],
    ["failed", "failed", "failed", "ignored_final"],
  ];

  it.each(table)("%s + %s → %s (%s)", (from, event, to, outcome) => {
    const result = transitionMessage(stateOf(from), events[event]);
    expect(result.state.status).toBe(to);
    expect(result.outcome).toBe(outcome);
  });

  it.each(table.filter(([, , , outcome]) => outcome.startsWith("ignored")))(
    "무시된 조합은 행의 어떤 값도 바꾸지 않는다: %s + %s",
    (from, event) => {
      const state = stateOf(from);
      expect(transitionMessage(state, events[event]).state).toEqual(state);
    },
  );
});

describe("정상 흐름의 값", () => {
  it("접수되면 업체 id와 접수 시각을 남긴다", () => {
    const { state } = transitionMessage(stateOf("queued"), events.accepted);
    expect(state).toMatchObject({
      providerMessageId: "p1",
      sentAt: T1,
      finalizedAt: null,
    });
  });

  it("도착하면 확정 시각을 남기고 접수 정보를 유지한다", () => {
    const { state } = transitionMessage(stateOf("sent"), events.delivered);
    expect(state).toMatchObject({
      providerMessageId: "p0",
      sentAt: T0,
      finalizedAt: T1,
      failCode: null,
    });
  });

  it("실패하면 코드와 확정 시각을 남긴다", () => {
    const { state } = transitionMessage(stateOf("sent"), events.failed);
    expect(state).toMatchObject({ failCode: "E1", finalizedAt: T1 });
  });

  it("보내기 전 영구 오류는 업체 id 없이 실패로 확정한다", () => {
    const { state } = transitionMessage(stateOf("queued"), events.send_failed);
    expect(state).toMatchObject({
      status: "failed",
      providerMessageId: null,
      sentAt: null,
      failCode: "E1",
      finalizedAt: T1,
    });
  });
});

describe("웹훅이 워커의 접수 기록보다 먼저 도착", () => {
  it("상태는 최종으로 유지하고 늦게 온 접수 시각만 채운다", () => {
    const webhook = transitionMessage(stateOf("queued"), {
      type: "delivered",
      providerMessageId: "p1",
      at: T1,
    });
    expect(webhook.state).toMatchObject({ status: "delivered", sentAt: null });

    const worker = transitionMessage(webhook.state, {
      type: "accepted",
      providerMessageId: "p1",
      at: T2,
    });
    expect(worker.outcome).toBe("recorded_late");
    expect(worker.state).toEqual({
      status: "delivered",
      providerMessageId: "p1",
      failCode: null,
      sentAt: T2,
      finalizedAt: T1,
    });
  });

  it("어느 순서로 도착해도 최종 상태와 업체 id가 같다", () => {
    const accepted: MessageEvent = {
      type: "accepted",
      providerMessageId: "p1",
      at: T1,
    };
    const delivered: MessageEvent = {
      type: "delivered",
      providerMessageId: "p1",
      at: T2,
    };

    const inOrder = [accepted, delivered].reduce(
      (state, event) => transitionMessage(state, event).state,
      stateOf("queued"),
    );
    const reversed = [delivered, accepted].reduce(
      (state, event) => transitionMessage(state, event).state,
      stateOf("queued"),
    );

    expect(reversed.status).toBe(inOrder.status);
    expect(reversed.providerMessageId).toBe(inOrder.providerMessageId);
    expect(reversed.finalizedAt).toEqual(inOrder.finalizedAt);
  });

  it("접수 정보가 모두 있으면 다시 와도 덮어쓰지 않는다", () => {
    const result = transitionMessage(stateOf("delivered"), events.accepted);
    expect(result.outcome).toBe("ignored_final");
    expect(result.state.sentAt).toBe(T0);
  });

  it("늦은 접수는 빈 값만 채우고 이미 있는 접수 시각을 덮어쓰지 않는다", () => {
    const state: MessageState = {
      ...stateOf("delivered"),
      providerMessageId: null,
    };

    const result = transitionMessage(state, events.accepted);

    expect(result.outcome).toBe("recorded_late");
    expect(result.state.providerMessageId).toBe("p1");
    expect(result.state.sentAt).toBe(T0);
  });
});

describe("중복과 충돌하는 결과", () => {
  it("같은 웹훅이 두 번 와도 첫 확정 시각이 유지된다", () => {
    const first = transitionMessage(stateOf("sent"), events.delivered);
    const second = transitionMessage(first.state, {
      ...events.delivered,
      at: T2,
    });

    expect(second.outcome).toBe("ignored_final");
    expect(second.state.finalizedAt).toBe(T1);
  });

  it("도착 뒤에 실패가 와도 먼저 온 결과를 유지하고 실패 코드를 남기지 않는다", () => {
    const first = transitionMessage(stateOf("sent"), events.delivered);
    const second = transitionMessage(first.state, events.failed);

    expect(second.state.status).toBe("delivered");
    expect(second.state.failCode).toBeNull();
  });
});

describe("transitionCampaign 전체 조합", () => {
  const eventsByType = {
    submit_for_approval: { type: "submit_for_approval" },
    schedule: { type: "schedule" },
    approve: { type: "approve" },
    reject: { type: "reject", reason: "문구 수정 필요" },
    start_sending: { type: "start_sending" },
    complete: {
      type: "complete",
      recipientCount: 2,
      deliveredCount: 1,
      failedCount: 1,
    },
    cancel: { type: "cancel", approved: false },
  } satisfies Record<CampaignEvent["type"], CampaignEvent>;

  const allowed: [CampaignStatus, CampaignEvent["type"], CampaignStatus][] = [
    ["draft", "submit_for_approval", "pending_approval"],
    ["draft", "schedule", "scheduled"],
    ["pending_approval", "approve", "scheduled"],
    ["pending_approval", "reject", "rejected"],
    ["scheduled", "start_sending", "sending"],
    ["scheduled", "cancel", "canceled"],
    ["sending", "complete", "completed"],
  ];

  it.each(allowed)("%s + %s → %s", (from, event, to) => {
    expect(transitionCampaign(from, eventsByType[event])).toMatchObject({
      ok: true,
      status: to,
    });
  });

  const statuses: CampaignStatus[] = [
    "draft",
    "pending_approval",
    "rejected",
    "scheduled",
    "sending",
    "completed",
    "canceled",
  ];
  const eventTypes = Object.keys(eventsByType) as CampaignEvent["type"][];
  const forbidden = statuses.flatMap((status) =>
    eventTypes
      .filter(
        (type) =>
          !allowed.some(([from, event]) => from === status && event === type),
      )
      .map((type): [CampaignStatus, CampaignEvent["type"]] => [status, type]),
  );

  it("모든 조합을 검사한다", () => {
    expect(allowed.length + forbidden.length).toBe(
      statuses.length * eventTypes.length,
    );
  });

  it.each(forbidden)("%s + %s는 거부한다", (from, event) => {
    expect(transitionCampaign(from, eventsByType[event])).toEqual({
      ok: false,
      error: "invalid_transition",
    });
  });
});

describe("발송 건 규칙", () => {
  it("반려 사유의 앞뒤 공백을 지워 저장한다", () => {
    expect(
      transitionCampaign("pending_approval", {
        type: "reject",
        reason: " 수정 필요 ",
      }),
    ).toEqual({ ok: true, status: "rejected", rejectedReason: "수정 필요" });
  });

  it.each(["", "   "])("빈 반려 사유 %j를 거부한다", (reason) => {
    expect(
      transitionCampaign("pending_approval", { type: "reject", reason }),
    ).toEqual({
      ok: false,
      error: "reason_required",
    });
  });

  it("승인되지 않은 예약 건은 취소할 수 있다", () => {
    expect(
      transitionCampaign("scheduled", { type: "cancel", approved: false }),
    ).toEqual({
      ok: true,
      status: "canceled",
    });
  });

  it("승인된 예약 건은 취소할 수 없다", () => {
    expect(
      transitionCampaign("scheduled", { type: "cancel", approved: true }),
    ).toEqual({
      ok: false,
      error: "approved_cannot_cancel",
    });
  });

  it.each([
    {
      recipientCount: 3,
      deliveredCount: 1,
      failedCount: 1,
      ok: false,
      name: "1건 남음",
    },
    {
      recipientCount: 3,
      deliveredCount: 3,
      failedCount: 0,
      ok: true,
      name: "모두 도착",
    },
    {
      recipientCount: 3,
      deliveredCount: 0,
      failedCount: 3,
      ok: true,
      name: "모두 실패",
    },
    {
      recipientCount: 3,
      deliveredCount: 2,
      failedCount: 1,
      ok: true,
      name: "도착과 실패",
    },
    {
      recipientCount: 3,
      deliveredCount: 3,
      failedCount: 1,
      ok: false,
      name: "집계 초과",
    },
  ])("완료 판정: $name", ({ ok, ...counts }) => {
    expect(
      transitionCampaign("sending", { type: "complete", ...counts }).ok,
    ).toBe(ok);
  });
});

describe("submitEventType", () => {
  it.each([
    { isAd: true, authorRole: "branch", expected: "submit_for_approval" },
    { isAd: true, authorRole: "hq", expected: "schedule" },
    { isAd: false, authorRole: "branch", expected: "schedule" },
    { isAd: false, authorRole: "hq", expected: "schedule" },
  ] as const)(
    "광고 $isAd · 작성자 $authorRole → $expected",
    ({ expected, ...input }) => {
      expect(submitEventType(input)).toBe(expected);
    },
  );
});
