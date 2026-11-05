import { describe, expect, it } from "vitest";
import { contactSchema, groupSchema, optOutSchema } from "./contact-schema";

const GROUP = "5eed0000-0000-4000-8000-000000000011";

describe("contactSchema", () => {
  it("번호를 정규화하고 빈 값을 null로 바꾼다", () => {
    expect(
      contactSchema.parse({
        phone: "010-0000-0001",
        name: "  ",
        memo: "",
        groupIds: [GROUP],
      }),
    ).toEqual({
      phone: "01000000001",
      name: null,
      memo: null,
      consent: false,
      groupIds: [GROUP],
    });
  });

  it.each([
    [{ phone: "abc" }, "전화번호 형식을 확인해 주세요"],
    [{ name: "가".repeat(31) }, "이름은 30자까지 쓸 수 있어요"],
    [{ memo: "가".repeat(201) }, "메모는 200자까지 쓸 수 있어요"],
  ])("%j → %s", (patch, message) => {
    const result = contactSchema.safeParse({
      phone: "01000000001",
      name: "",
      memo: "",
      groupIds: [],
      ...patch,
    });
    expect(result.error?.issues[0]?.message).toBe(message);
  });

  it("그룹 id 형식이 틀리면 거부한다", () => {
    const result = contactSchema.safeParse({
      phone: "01000000001",
      name: "",
      memo: "",
      groupIds: ["abc"],
    });
    expect(result.success).toBe(false);
  });
});

describe("폼과 서버의 이중 검사", () => {
  // 폼이 변환한 값을 Server Action이 같은 스키마로 다시 검사한다.
  // 이름을 비운 연락처가 전부 저장에 실패하던 버그의 회귀 테스트다.
  it("변환한 연락처를 다시 검사해도 같은 값이다", () => {
    const once = contactSchema.parse({
      phone: "010-0000-0001",
      name: "",
      memo: " ",
      groupIds: [],
    });
    expect(contactSchema.parse(once)).toEqual(once);
  });

  it("변환한 수신거부를 다시 검사해도 같은 값이다", () => {
    const once = optOutSchema.parse({ phone: "010-0000-0001", reason: "" });
    expect(optOutSchema.parse(once)).toEqual(once);
  });
});

describe("체크박스 값", () => {
  const parseGroups = (groupIds: unknown) =>
    contactSchema.parse({
      phone: "01000000001",
      name: "",
      memo: "",
      groupIds,
    }).groupIds;

  it.each([
    ["배열", [GROUP], [GROUP]],
    ["체크박스 하나의 값", GROUP, [GROUP]],
    ["체크 안 한 체크박스 하나", false, []],
    ["그룹이 없어 값이 없음", undefined, []],
  ])("%s", (_, input, expected) => {
    expect(parseGroups(input)).toEqual(expected);
  });
});

describe("groupSchema", () => {
  it.each(["", "   "])("빈 이름 %j를 거부한다", (name) => {
    expect(groupSchema.safeParse({ name }).success).toBe(false);
  });

  it("앞뒤 공백을 지운다", () => {
    expect(groupSchema.parse({ name: " 단골 " }).name).toBe("단골");
  });
});

describe("optOutSchema", () => {
  it("번호를 정규화한다", () => {
    expect(optOutSchema.parse({ phone: "010 0000 0001", reason: "" })).toEqual({
      phone: "01000000001",
      reason: null,
    });
  });
});
