import { describe, expect, it } from "vitest";
import {
  chargeAmountSchema,
  chargeResultMessage,
  newOrderId,
} from "./charge-schema";

describe("chargeAmountSchema", () => {
  it.each([10_000, 30_000, 50_000, 100_000])("%i원은 받는다", (amount) => {
    expect(chargeAmountSchema.safeParse(amount).success).toBe(true);
  });

  it.each([0, -10_000, 1, 10_001, 1_000_000, Number.NaN, "abc"])(
    "%s는 거부한다",
    (amount) => {
      expect(chargeAmountSchema.safeParse(amount).success).toBe(false);
    },
  );
});

describe("newOrderId", () => {
  it("토스 주문번호 규칙에 맞는다", () => {
    const id = newOrderId("3b241101-e2bb-4255-8caf-4136c566a962");
    expect(id).toMatch(/^[A-Za-z0-9\-_=]{6,64}$/);
  });
});

describe("chargeResultMessage", () => {
  it("결과가 없으면 아무것도 보이지 않는다", () => {
    expect(chargeResultMessage(undefined, undefined)).toBeNull();
    expect(chargeResultMessage("<script>", undefined)).toBeNull();
  });

  it("사용자 취소는 실패와 구분한다", () => {
    expect(chargeResultMessage("failed", "PAY_PROCESS_CANCELED")?.text).toBe(
      "결제를 취소했어요",
    );
  });

  it("주소의 코드를 문구에 넣지 않는다", () => {
    expect(chargeResultMessage("failed", "해킹문구")?.text).not.toContain(
      "해킹문구",
    );
  });

  it("대기 중에는 다시 결제하지 말라고 안내한다", () => {
    expect(chargeResultMessage("pending", undefined)?.text).toContain(
      "다시 결제하지",
    );
  });
});
