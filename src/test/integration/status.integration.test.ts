import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  transitionMessage,
  type MessageEvent,
  type MessageState,
} from "@/features/campaigns/status";
import { createFixture, must, service, type Fixture } from "./fixture";

/**
 * 전이 함수와 DB 제약이 규칙을 따로 들고 있으므로 어긋날 수 있다.
 * 함수가 "가능하다"고 한 결과를 DB가 거부하면 웹훅 처리 도중에 터지므로, 실제 저장으로 맞물림을 확인한다.
 */
let f: Fixture;
let campaignId: string;

beforeAll(async () => {
  f = await createFixture();
  campaignId = f.campaigns.find((c) => c.branch_id === f.branch1)?.id ?? "";
  // 집계 트리거가 확정 수를 올리므로, 시험하는 메시지 수만큼 수신자 수가 있어야 제약에 걸리지 않는다.
  must(
    await service
      .from("campaigns")
      .update({ recipient_count: 100, unit_price: 0, estimated_cost: 0 })
      .eq("id", campaignId)
      .select("id"),
  );
});

afterAll(async () => {
  await f.cleanup();
});

const QUEUED: MessageState = {
  status: "queued",
  providerMessageId: null,
  failCode: null,
  sentAt: null,
  finalizedAt: null,
};
const at = new Date("2026-11-04T00:00:00.000Z");
const accepted: MessageEvent = { type: "accepted", providerMessageId: "p", at };
const delivered: MessageEvent = {
  type: "delivered",
  providerMessageId: "p",
  at,
};
const failed: MessageEvent = {
  type: "failed",
  providerMessageId: "p",
  failCode: "E1",
  at,
};
const sendFailed: MessageEvent = { type: "send_failed", failCode: "E1", at };

// 같은 발송 건 안에서 번호가 겹치면 제약에 걸리므로 테스트마다 새 번호를 쓴다.
let nextPhone = 1_000_000_100;

describe("전이 결과를 DB에 저장", () => {
  it.each([
    { name: "접수", sequence: [accepted] },
    { name: "접수 → 도착", sequence: [accepted, delivered] },
    { name: "접수 → 실패", sequence: [accepted, failed] },
    { name: "보내기 전 영구 실패", sequence: [sendFailed] },
    { name: "웹훅 먼저: 도착", sequence: [delivered] },
    { name: "웹훅 먼저: 실패", sequence: [failed] },
    { name: "웹훅 먼저: 도착 → 늦은 접수", sequence: [delivered, accepted] },
  ])("$name", async ({ sequence }) => {
    nextPhone += 1;
    const { id } = must(
      await service
        .from("messages")
        .insert({
          campaign_id: campaignId,
          org_id: f.orgA,
          phone: `0${nextPhone}`,
          provider: "fake",
        })
        .select("id")
        .single(),
    );

    let state = QUEUED;
    for (const event of sequence) {
      state = transitionMessage(state, event).state;
      const { error } = await service
        .from("messages")
        .update({
          status: state.status,
          // 같은 발송 건 안에서 업체 id가 겹치지 않게 행 id를 붙인다.
          provider_message_id:
            state.providerMessageId && `${state.providerMessageId}-${id}`,
          fail_code: state.failCode,
          sent_at: state.sentAt?.toISOString() ?? null,
          finalized_at: state.finalizedAt?.toISOString() ?? null,
        })
        .eq("id", id);
      expect(error).toBeNull();
    }
  });
});
