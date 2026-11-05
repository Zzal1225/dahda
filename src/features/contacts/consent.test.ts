import { describe, expect, it } from "vitest";
import { cellToConsentText, parseConsent } from "./consent";

const NOW = new Date("2026-11-05T12:00:00Z");

describe("parseConsent", () => {
  it.each(["Y", "y", "yes", "O", "예", "동의", "1", " Y "])(
    "%s는 지금 동의한 것이다",
    (input) => {
      expect(parseConsent(input, NOW)).toEqual({
        ok: true,
        consentAt: NOW.toISOString(),
      });
    },
  );

  it.each(["N", "no", "X", "아니오", "미동의", "0", "", "  "])(
    "'%s'는 미동의다",
    (input) => {
      expect(parseConsent(input, NOW)).toEqual({ ok: true, consentAt: null });
    },
  );

  it("칸이 없으면 미동의다", () => {
    expect(parseConsent(null, NOW)).toEqual({ ok: true, consentAt: null });
  });

  it.each(["2026-03-01", "2026.03.01", "2026/3/1"])(
    "%s는 그날 KST 0시다",
    (input) => {
      expect(parseConsent(input, NOW)).toEqual({
        ok: true,
        consentAt: "2026-02-28T15:00:00.000Z",
      });
    },
  );

  it.each([
    ["알 수 없는 값", "아마도"],
    ["없는 날짜", "2026-02-31"],
    ["없는 달", "2026-13-01"],
    ["미래 날짜", "2026-11-06"],
    ["형식이 다른 날짜", "26-3-1"],
  ])("%s는 추측하지 않고 오류로 돌린다", (_, input) => {
    expect(parseConsent(input, NOW)).toEqual({ ok: false });
  });

  it("오늘 날짜는 받는다", () => {
    expect(parseConsent("2026-11-05", NOW).ok).toBe(true);
  });
});

describe("cellToConsentText", () => {
  it("엑셀 날짜 숫자를 날짜 글자로 바꾼다", () => {
    expect(cellToConsentText(46082)).toBe("2026-03-01");
  });

  it("작은 숫자는 날짜로 보지 않는다", () => {
    expect(cellToConsentText(1)).toBe("1");
  });

  it("Date 값을 날짜 글자로 바꾼다", () => {
    expect(cellToConsentText(new Date("2026-03-01T00:00:00Z"))).toBe(
      "2026-03-01",
    );
  });

  it("빈 칸은 null이다", () => {
    expect(cellToConsentText(null)).toBeNull();
    expect(cellToConsentText("  ")).toBeNull();
  });
});
