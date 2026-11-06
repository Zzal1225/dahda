import { describe, expect, it } from "vitest";
import { normalizePhone } from "@/lib/phone";
import { buildSampleRows, SAMPLE_ROWS } from "./sample-sheet";

/** 같은 순서를 매번 만드는 난수(선형 합동). 결과를 고정해 경계값을 본다. */
function seeded(seed = 1) {
  let state = seed;
  return () => {
    state = (state * 1_103_515_245 + 12_345) % 2 ** 31;
    return state / 2 ** 31;
  };
}

const existingPhones = ["01001234567", "01001234568"];
const optOutPhones = ["01009999999"];

describe("buildSampleRows", () => {
  const sheet = buildSampleRows({
    existingPhones,
    optOutPhones,
    random: seeded(),
  });
  const [header, ...rows] = sheet;
  const phones = rows.map((row) => row[1] ?? "");

  it("머리글 + 1만 행이다", () => {
    expect(header).toEqual(["이름", "전화번호", "그룹", "메모", "수신동의"]);
    expect(rows).toHaveLength(SAMPLE_ROWS);
  });

  it("첫 5행은 정상 번호다(미리보기가 오류로만 보이지 않게)", () => {
    for (const phone of phones.slice(0, 5)) {
      expect(normalizePhone(phone)).not.toBeNull();
    }
  });

  it("형식 오류·파일 안 중복·기존 번호·수신거부가 섞여 있다", () => {
    const normalized = phones.map(normalizePhone);
    expect(normalized.filter((phone) => phone === null)).toHaveLength(100);
    const valid = normalized.filter((phone): phone is string => phone !== null);
    expect(valid.length - new Set(valid).size).toBe(80);
    expect(valid).toContain("01001234567");
    expect(valid).toContain("01009999999");
  });

  it("새 번호는 안전 대역(0100 다음 자리 1~9)이다", () => {
    const fresh = phones
      .map(normalizePhone)
      .filter(
        (phone): phone is string =>
          phone !== null &&
          !existingPhones.includes(phone) &&
          !optOutPhones.includes(phone),
      );
    expect(fresh.every((phone) => /^0100[1-9][0-9]{6}$/.test(phone))).toBe(
      true,
    );
  });
});
