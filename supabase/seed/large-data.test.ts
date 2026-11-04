import { describe, expect, it } from "vitest";
import {
  buildSmallCampaigns,
  LARGE_MESSAGE_COUNT,
  seedCounts,
  seedMessage,
  seedPhone,
  seedStatus,
} from "./large-data.mts";

describe("seedPhone", () => {
  it("전체 범위에서 11자리 숫자이고 서로 겹치지 않는다", () => {
    const phones = new Set<string>();
    for (let index = 0; index < LARGE_MESSAGE_COUNT; index += 1) {
      phones.add(seedPhone(index));
    }
    expect(phones.size).toBe(LARGE_MESSAGE_COUNT);
    expect(seedPhone(0)).toBe("01000000000");
    expect(seedPhone(LARGE_MESSAGE_COUNT - 1)).toBe("01000099999");
  });
});

describe("seedStatus", () => {
  it("워커가 집어 갈 queued 행을 만들지 않는다", () => {
    const statuses = new Set<string>();
    for (let index = 0; index < LARGE_MESSAGE_COUNT; index += 1) {
      statuses.add(seedStatus(index));
    }
    expect([...statuses].sort()).toEqual(["delivered", "failed", "sent"]);
  });

  it("도착 85%, 확인 중 8%, 실패 7%로 나뉜다", () => {
    expect(seedCounts(LARGE_MESSAGE_COUNT)).toEqual({
      delivered: 85_000,
      sent: 8_000,
      failed: 7_000,
    });
  });

  it("같은 상태가 앞쪽에 뭉치지 않는다", () => {
    const first = Array.from({ length: 100 }, (_, index) => seedStatus(index));
    expect(new Set(first).size).toBe(3);
  });

  it("실행할 때마다 같은 값이 나온다", () => {
    expect(seedMessage(12345)).toEqual(seedMessage(12345));
  });
});

describe("seedMessage", () => {
  // DB 제약과 같은 규칙이다. 어기면 시드가 10만 행 중간에 실패한다.
  it.each([
    { name: "확인 중", status: "sent" },
    { name: "도착", status: "delivered" },
    { name: "실패", status: "failed" },
  ] as const)("$name 행이 DB 제약을 지킨다", ({ status }) => {
    let index = 0;
    while (seedStatus(index) !== status) index += 1;
    const message = seedMessage(index);

    expect(message.provider_message_id).toBeTruthy();
    expect(message.fail_code !== null).toBe(status === "failed");
    expect(message.finalized_at !== null).toBe(status !== "sent");
  });
});

describe("buildSmallCampaigns", () => {
  const campaigns = buildSmallCampaigns(["b1", "b2", "b3"]);

  it("메시지에 queued가 없다", () => {
    const statuses = campaigns.flatMap((c) => c.messages.map((m) => m.status));
    expect(statuses).not.toContain("queued");
    expect(statuses.length).toBeGreaterThan(0);
  });

  it("완료된 건에는 확인 중인 메시지가 없고 집계가 수신자 수와 같다", () => {
    for (const campaign of campaigns.filter((c) => c.status === "completed")) {
      expect(campaign.messages.map((m) => m.status)).not.toContain("sent");
      expect(campaign.delivered_count + campaign.failed_count).toBe(
        campaign.recipient_count,
      );
    }
  });

  it("보내기 전인 건에는 메시지가 없다", () => {
    for (const campaign of campaigns.filter(
      (c) => c.status !== "completed" && c.status !== "sending",
    )) {
      expect(campaign.messages).toEqual([]);
    }
  });

  it("반려에만 사유가 있다", () => {
    for (const campaign of campaigns) {
      expect(campaign.rejected_reason !== null).toBe(
        campaign.status === "rejected",
      );
    }
  });
});
