import { describe, expect, it } from "vitest";
import { loginSchema } from "./login-schema";

describe("loginSchema", () => {
  it("올바른 입력을 통과시킨다", () => {
    expect(
      loginSchema.safeParse({ email: "a@b.co", password: "x" }).success,
    ).toBe(true);
  });

  it.each(["", "abc", "a@", "@b.co"])("이메일 %j를 거부한다", (email) => {
    const result = loginSchema.safeParse({ email, password: "x" });
    expect(result.error?.issues[0]?.message).toBe(
      "이메일 형식을 확인해 주세요",
    );
  });

  it("빈 비밀번호를 거부한다", () => {
    const result = loginSchema.safeParse({ email: "a@b.co", password: "" });
    expect(result.error?.issues[0]?.message).toBe("비밀번호를 입력해 주세요");
  });
});
