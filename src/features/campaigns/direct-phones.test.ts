import { describe, expect, it } from "vitest";
import {
  MAX_DIRECT_PHONES,
  directPhoneMessage,
  parseDirectPhones,
} from "./direct-phones";

describe("parseDirectPhones", () => {
  it("줄바꿈·쉼표·세미콜론·탭으로 나누고 정규화한다", () => {
    const result = parseDirectPhones(
      "010-1234-5678\n01022223333, 010 4444 5555;\t+82 10-6666-7777",
      [],
    );
    expect(result.added).toEqual([
      "01012345678",
      "01022223333",
      "01044445555",
      "01066667777",
    ]);
    expect(result.invalid).toEqual([]);
  });

  it("띄어 쓴 번호를 공백에서 나누지 않는다", () => {
    expect(parseDirectPhones("010 1234 5678", []).added).toEqual([
      "01012345678",
    ]);
  });

  it("빈 줄과 앞뒤 공백은 무시한다", () => {
    const result = parseDirectPhones("\n\n  01012345678  \n,,\n", []);
    expect(result).toEqual({
      added: ["01012345678"],
      invalid: [],
      duplicates: 0,
      overLimit: 0,
    });
  });

  it("형식이 틀린 조각은 원문 그대로 돌려준다", () => {
    const result = parseDirectPhones("0101234567\nabc\n010-1234-567a", []);
    expect(result.added).toEqual([]);
    expect(result.invalid).toEqual(["0101234567", "abc", "010-1234-567a"]);
  });

  it("이미 넣은 번호와 입력 안의 중복을 센다", () => {
    const result = parseDirectPhones(
      "010-1234-5678\n01012345678\n01099998888",
      ["01099998888"],
    );
    expect(result.added).toEqual(["01012345678"]);
    expect(result.duplicates).toBe(2);
  });

  it("상한까지만 넣고 넘친 수를 센다", () => {
    const existing = Array.from(
      { length: MAX_DIRECT_PHONES - 1 },
      (_, index) => `010${String(index).padStart(8, "0")}`,
    );
    const result = parseDirectPhones(
      "01090000001\n01090000002\n01090000003",
      existing,
    );
    expect(result.added).toEqual(["01090000001"]);
    expect(result.overLimit).toBe(2);
  });

  it("상한에 닿아도 중복은 넘친 수가 아니라 중복으로 센다", () => {
    const existing = Array.from(
      { length: MAX_DIRECT_PHONES },
      (_, index) => `010${String(index).padStart(8, "0")}`,
    );
    const result = parseDirectPhones("01000000000\n01090000001", existing);
    expect(result.duplicates).toBe(1);
    expect(result.overLimit).toBe(1);
  });
});

describe("directPhoneMessage", () => {
  it("추가만 있으면 한 마디다", () => {
    expect(
      directPhoneMessage({
        added: ["01012345678"],
        invalid: [],
        duplicates: 0,
        overLimit: 0,
      }),
    ).toBe("1개 추가");
  });

  it("중복·형식 오류·상한 초과를 함께 알린다", () => {
    expect(
      directPhoneMessage({
        added: [],
        invalid: ["abc", "def"],
        duplicates: 3,
        overLimit: 1_200,
      }),
    ).toBe(
      "0개 추가 · 중복 3개 제외 · 형식이 틀린 2개는 입력창에 남겼어요 · 1,000개를 넘는 1,200개는 넣지 못했어요",
    );
  });
});
