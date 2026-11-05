import { describe, expect, it } from "vitest";
import { demoRecipient, demoSmsSchema } from "./demo-schema";

describe("demoRecipient", () => {
  it.each([
    ["010-1234-5678", "01012345678"],
    ["+82 10 1234 5678", "01012345678"],
    ["0111234567", "0111234567"],
  ])("%s → %s", (input, expected) => {
    expect(demoRecipient(input)).toBe(expected);
  });

  it.each(["02-1234-5678", "1588-0000", "080-123-4567", "abc", ""])(
    "휴대전화가 아닌 %s는 받지 않는다",
    (input) => {
      expect(demoRecipient(input)).toBeNull();
    },
  );
});

describe("demoSmsSchema", () => {
  it("번호와 동의가 모두 있어야 한다", () => {
    expect(
      demoSmsSchema.safeParse({ phone: "01012345678", consent: true }).success,
    ).toBe(true);
    expect(
      demoSmsSchema.safeParse({ phone: "01012345678", consent: false }).success,
    ).toBe(false);
    expect(
      demoSmsSchema.safeParse({ phone: "0212345678", consent: true }).success,
    ).toBe(false);
  });

  it("본문은 입력으로 받지 않는다", () => {
    const parsed = demoSmsSchema.parse({
      phone: "01012345678",
      consent: true,
      body: "아무 내용",
    });
    expect(parsed).not.toHaveProperty("body");
  });
});
