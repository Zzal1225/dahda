import { describe, expect, it } from "vitest";
import { failReason, pageOfIndex, pagesForRange } from "./message-view";

describe("pageOfIndex", () => {
  it.each([
    [0, 100, 1],
    [99, 100, 1],
    [100, 100, 2],
    [99_999, 100, 1000],
    [99_999, 500, 200],
  ])("%d번째 줄, 페이지 크기 %d → %d", (index, size, page) => {
    expect(pageOfIndex(index, size)).toBe(page);
  });
});

describe("pagesForRange", () => {
  it("한 페이지 안이면 하나만 요청한다", () => {
    expect(pagesForRange(10, 20, 100)).toEqual([1]);
  });

  it("페이지 경계를 걸치면 둘 다 요청한다", () => {
    expect(pagesForRange(95, 105, 100)).toEqual([1, 2]);
  });

  it("작은 페이지 크기에서는 여러 페이지를 요청한다", () => {
    expect(pagesForRange(45, 110, 50)).toEqual([1, 2, 3]);
  });

  it("빈 범위면 요청하지 않는다", () => {
    expect(pagesForRange(0, -1, 100)).toEqual([]);
  });
});

describe("failReason", () => {
  it("아는 코드는 사유를 보여 준다", () => {
    expect(failReason("E301")).toBe("결번");
  });

  it.each([null, "E999"])("모르는 코드 %s는 비워 둔다", (code) => {
    expect(failReason(code)).toBe("");
  });
});
