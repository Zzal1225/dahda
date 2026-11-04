import type { MemberRole } from "@/server/auth/to-current-member";

export type NavIcon =
  | "home"
  | "store"
  | "contact"
  | "pencil"
  | "inbox"
  | "list"
  | "credit-card"
  | "sliders-horizontal";

export type NavItem = {
  href: string;
  label: string;
  /** 접힌 사이드바의 10px 라벨. 툴팁에 의존하지 않기 위해 따로 둔다(핸드오프 지정). */
  shortLabel: string;
  icon: NavIcon;
  /** 없으면 모든 역할에 보인다. */
  roles?: readonly MemberRole[];
  /** 아직 없는 화면은 숨긴다. 화면을 만들 때 true로 바꾼다("준비 중" 버튼을 두지 않는 규칙). */
  ready: boolean;
};

export const NAV_ITEMS: readonly NavItem[] = [
  { href: "/", label: "홈", shortLabel: "홈", icon: "home", ready: true },
  {
    href: "/branches",
    label: "지점 관리",
    shortLabel: "지점",
    icon: "store",
    roles: ["hq"],
    ready: true,
  },
  {
    href: "/contacts",
    label: "주소록",
    shortLabel: "주소록",
    icon: "contact",
    ready: false,
  },
  {
    href: "/compose",
    label: "문자 작성",
    shortLabel: "작성",
    icon: "pencil",
    ready: false,
  },
  {
    href: "/approvals",
    label: "승인함",
    shortLabel: "승인",
    icon: "inbox",
    roles: ["hq"],
    ready: false,
  },
  {
    href: "/history",
    label: "발송 내역",
    shortLabel: "내역",
    icon: "list",
    ready: true,
  },
  {
    href: "/billing",
    label: "충전",
    shortLabel: "충전",
    icon: "credit-card",
    ready: false,
  },
  {
    href: "/settings",
    label: "설정",
    shortLabel: "설정",
    icon: "sliders-horizontal",
    ready: false,
  },
];

export function navItemsFor(
  role: MemberRole,
  items: readonly NavItem[] = NAV_ITEMS,
): readonly NavItem[] {
  return items.filter(
    (item) => item.ready && (!item.roles || item.roles.includes(role)),
  );
}

/** 홈("/")은 정확히 일치할 때만, 나머지는 하위 경로까지 활성으로 본다. */
export function isNavItemActive(href: string, pathname: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}
