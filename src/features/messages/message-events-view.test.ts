import { describe, expect, it } from "vitest";
import { toEventViews, type MessageEventRow } from "./message-events-view";

const row = (
  id: number,
  occurredAt: string,
  receivedAt: string,
  over: Partial<MessageEventRow> = {},
): MessageEventRow => ({
  id,
  source: "webhook",
  kind: "delivered",
  outcome: "applied",
  failCode: null,
  occurredAt: `2026-11-06T00:00:${occurredAt}Z`,
  receivedAt: `2026-11-06T00:00:${receivedAt}Z`,
  ...over,
});

describe("toEventViews", () => {
  it("받은 시각순으로 정렬한다", () => {
    expect(
      toEventViews([row(2, "05", "06"), row(1, "01", "02")]).map((v) => v.id),
    ).toEqual([1, 2]);
  });

  it("같은 시각은 id순이다", () => {
    expect(
      toEventViews([row(3, "01", "02"), row(2, "01", "02")]).map((v) => v.id),
    ).toEqual([2, 3]);
  });

  it("업체 시각이 앞 줄보다 이르면 순서 바뀜이다", () => {
    // 도착 결과(03초)를 먼저 받고, 그보다 이른 접수(01초)를 나중에 기록했다.
    const views = toEventViews([
      row(1, "03", "04"),
      row(2, "01", "05", { source: "worker", kind: "accepted" }),
    ]);
    expect(views.map((v) => v.outOfOrder)).toEqual([false, true]);
  });

  it("바로 앞이 아니라 앞 줄 전체에서 가장 늦은 시각과 비교한다", () => {
    const views = toEventViews([
      row(1, "09", "10"),
      row(2, "02", "11"),
      row(3, "05", "12"),
    ]);
    expect(views.map((v) => v.outOfOrder)).toEqual([false, true, true]);
  });

  it("중복은 같은 업체 시각이라 순서 바뀜이 아니다", () => {
    const views = toEventViews([
      row(1, "03", "04"),
      row(2, "03", "06", { outcome: "ignored_final" }),
    ]);
    expect(views.map((v) => v.outOfOrder)).toEqual([false, false]);
  });
});
