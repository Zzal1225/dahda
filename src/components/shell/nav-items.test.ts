import { describe, expect, it } from "vitest";
import {
  isNavItemActive,
  NAV_ITEMS,
  navItemsFor,
  type NavItem,
} from "./nav-items";

const allReady: NavItem[] = NAV_ITEMS.map((item) => ({ ...item, ready: true }));

describe("navItemsFor", () => {
  it("본사는 핸드오프의 메뉴 8개를 순서대로 본다", () => {
    expect(navItemsFor("hq", allReady).map((item) => item.label)).toEqual([
      "홈",
      "지점 관리",
      "주소록",
      "문자 작성",
      "승인함",
      "발송 내역",
      "충전",
      "설정",
    ]);
  });

  it("지점은 지점 관리와 승인함을 보지 못한다", () => {
    expect(navItemsFor("branch", allReady).map((item) => item.label)).toEqual([
      "홈",
      "주소록",
      "문자 작성",
      "발송 내역",
      "충전",
      "설정",
    ]);
  });

  it("아직 없는 화면은 숨긴다", () => {
    const items: NavItem[] = [
      { href: "/a", label: "A", shortLabel: "A", icon: "home", ready: true },
      { href: "/b", label: "B", shortLabel: "B", icon: "home", ready: false },
    ];
    expect(navItemsFor("hq", items).map((item) => item.href)).toEqual(["/a"]);
  });
});

describe("isNavItemActive", () => {
  it.each([
    ["/", "/", true],
    ["/", "/history", false],
    ["/history", "/history", true],
    ["/history", "/history/abc", true],
    ["/history", "/history-old", false],
    ["/branches", "/", false],
  ])("메뉴 %s · 경로 %s → %s", (href, pathname, expected) => {
    expect(isNavItemActive(href, pathname)).toBe(expected);
  });
});
