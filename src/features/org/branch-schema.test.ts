import { describe, expect, it } from "vitest";
import { branchAccountSchema, branchNameSchema } from "./branch-schema";

describe("branchNameSchema", () => {
  it("앞뒤 공백을 지운다", () => {
    expect(branchNameSchema.parse({ name: "  성수점 " }).name).toBe("성수점");
  });

  it.each(["", "   "])("빈 이름 %j를 거부한다", (name) => {
    expect(branchNameSchema.safeParse({ name }).error?.issues[0]?.message).toBe(
      "지점 이름을 입력해 주세요",
    );
  });

  it("30자는 통과하고 31자는 거부한다", () => {
    expect(branchNameSchema.safeParse({ name: "가".repeat(30) }).success).toBe(
      true,
    );
    expect(branchNameSchema.safeParse({ name: "가".repeat(31) }).success).toBe(
      false,
    );
  });
});

describe("branchAccountSchema", () => {
  const valid = {
    displayName: "성수 담당",
    email: "a@b.co",
    password: "12345678",
  };

  it("올바른 입력을 통과시킨다", () => {
    expect(branchAccountSchema.safeParse(valid).success).toBe(true);
  });

  it.each([
    [{ ...valid, displayName: " " }, "담당자 이름을 입력해 주세요"],
    [{ ...valid, email: "abc" }, "이메일 형식을 확인해 주세요"],
    [{ ...valid, password: "1234567" }, "비밀번호는 8자 이상이어야 해요"],
  ])("%j → %s", (input, message) => {
    expect(branchAccountSchema.safeParse(input).error?.issues[0]?.message).toBe(
      message,
    );
  });
});
