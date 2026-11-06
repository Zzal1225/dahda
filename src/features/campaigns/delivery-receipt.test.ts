import { describe, expect, it } from "vitest";
import {
  receiptNumber,
  receiptStages,
  webhookSummary,
  type ReceiptTotals,
} from "./delivery-receipt";

const totals = (over: Partial<ReceiptTotals> = {}): ReceiptTotals => ({
  startedAt: "2026-11-06T05:00:00.000Z",
  completedAt: null,
  queued: 0,
  awaiting: 0,
  delivered: 0,
  carrierFailed: 0,
  vendorFailed: 0,
  firstAcceptedAt: null,
  firstResultAt: null,
  firstDeliveredAt: null,
  webhookCount: 0,
  webhookIgnored: 0,
  acceptedLate: 0,
  ...over,
});

const states = (value: ReceiptTotals) =>
  receiptStages(value).map((stage) => stage.state);
const counts = (value: ReceiptTotals) =>
  receiptStages(value).map((stage) => stage.count);

describe("receiptStages", () => {
  it("큐에 넣기 전이면 모두 대기이고 건수는 0이다", () => {
    const value = totals({ startedAt: null, queued: 30 });
    expect(states(value)).toEqual(["waiting", "waiting", "waiting", "waiting"]);
    expect(counts(value)).toEqual([0, 0, 0, 0]);
  });

  it("큐에 넣었지만 업체가 아직 한 건도 받지 않았다", () => {
    const value = totals({ queued: 30 });
    expect(states(value)).toEqual(["done", "waiting", "waiting", "waiting"]);
    expect(counts(value)).toEqual([30, 0, 0, 0]);
  });

  it("한 건이라도 남아 있으면 발송은 진행 중이다", () => {
    expect(states(totals({ queued: 1, awaiting: 29 }))).toEqual([
      "done",
      "active",
      "waiting",
      "waiting",
    ]);
  });

  it("대기가 0이 되는 순간 발송이 끝나고, 결과를 기다리는 건이 있으면 뒤 단계는 진행 중이다", () => {
    const value = totals({ awaiting: 1, delivered: 28, carrierFailed: 1 });
    expect(states(value)).toEqual(["done", "done", "active", "active"]);
    expect(counts(value)).toEqual([30, 30, 29, 28]);
  });

  it("마지막 결과가 오면 모든 단계가 끝난다", () => {
    expect(states(totals({ delivered: 30 }))).toEqual([
      "done",
      "done",
      "done",
      "done",
    ]);
  });

  it("업체 접수 거절은 발송·통신사 전달에 세지 않는다", () => {
    const value = totals({ delivered: 27, vendorFailed: 3 });
    expect(counts(value)).toEqual([30, 27, 27, 27]);
  });

  it("전부 업체 접수 거절이면 뒤 단계는 기다리지 않고 해당 없음이다", () => {
    expect(states(totals({ vendorFailed: 30 }))).toEqual([
      "done",
      "empty",
      "empty",
      "empty",
    ]);
  });

  it("전부 통신사에서 실패하면 통신사 전달은 끝나고 도착은 해당 없음이다", () => {
    const value = totals({ carrierFailed: 30 });
    expect(states(value)).toEqual(["done", "done", "done", "empty"]);
    expect(counts(value)).toEqual([30, 30, 30, 0]);
  });

  it("수신자가 0명이면 접수부터 해당 없음이다", () => {
    expect(states(totals())).toEqual(["empty", "empty", "empty", "empty"]);
  });

  it("뒤 단계 건수는 앞 단계를 넘지 않는다", () => {
    const value = totals({
      queued: 4,
      awaiting: 7,
      delivered: 20,
      carrierFailed: 2,
      vendorFailed: 3,
    });
    const [queued = 0, accepted = 0, carrier = 0, delivered = 0] =
      counts(value);
    expect(queued).toBeGreaterThanOrEqual(accepted);
    expect(accepted).toBeGreaterThanOrEqual(carrier);
    expect(carrier).toBeGreaterThanOrEqual(delivered);
  });

  it("시각은 KST HH:mm:ss이고 없으면 null이다", () => {
    const stages = receiptStages(
      totals({
        awaiting: 1,
        firstAcceptedAt: "2026-11-06T05:00:01.400Z",
        firstResultAt: null,
      }),
    );
    expect(stages.map((stage) => stage.time)).toEqual([
      "14:00:00",
      "14:00:01",
      null,
      null,
    ]);
  });

  it("자정을 넘는 시각도 KST 날짜 기준으로 바꾼다", () => {
    const [first] = receiptStages(
      totals({ startedAt: "2026-11-05T15:00:00.000Z", queued: 1 }),
    );
    expect(first?.time).toBe("00:00:00");
  });
});

describe("webhookSummary", () => {
  it("기록이 없으면 null이다", () => {
    expect(webhookSummary(totals())).toBeNull();
  });

  it("받은 횟수만 있으면 한 항목이다", () => {
    expect(webhookSummary(totals({ webhookCount: 30 }))).toBe(
      "결과 웹훅 30회 수신",
    );
  });

  it("중복과 순서 바뀜을 함께 쓴다", () => {
    expect(
      webhookSummary(
        totals({ webhookCount: 1312, webhookIgnored: 2, acceptedLate: 1 }),
      ),
    ).toBe(
      "결과 웹훅 1,312회 수신 · 중복·지난 결과 2회는 반영 안 함 · 접수 기록보다 먼저 온 결과 1건",
    );
  });
});

describe("receiptNumber", () => {
  it("하이픈을 빼고 앞 8자리를 대문자로 쓴다", () => {
    expect(receiptNumber("3f2a9c1b-0d4e-4c3a-9b1e-7a6f5d4c3b2a")).toBe(
      "No. 3F2A9C1B",
    );
  });
});
