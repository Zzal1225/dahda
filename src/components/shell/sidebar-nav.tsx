"use client";

import {
  ContactRound,
  CreditCard,
  House,
  Inbox,
  List,
  Pencil,
  SlidersHorizontal,
  Store,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { isNavItemActive, type NavIcon, type NavItem } from "./nav-items";

const ICONS: Record<NavIcon, LucideIcon> = {
  home: House,
  store: Store,
  contact: ContactRound,
  pencil: Pencil,
  inbox: Inbox,
  list: List,
  "credit-card": CreditCard,
  "sliders-horizontal": SlidersHorizontal,
};

// 역할 판단은 서버가 끝내고 항목만 넘긴다. 현재 경로는 브라우저만 알아서 이 부분만 클라이언트 컴포넌트다.
export function SidebarNav({
  items,
  badges = {},
}: {
  items: readonly NavItem[];
  /** 메뉴 주소별 숫자. 0이면 표시하지 않는다. */
  badges?: Readonly<Record<string, number>>;
}) {
  const pathname = usePathname();

  return (
    <nav aria-label="주 메뉴" className="flex flex-col gap-0.5 p-1.5 xl:p-3">
      {items.map((item) => {
        const active = isNavItemActive(item.href, pathname);
        const Icon = ICONS[item.icon];
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex flex-col items-center justify-center gap-0.5 rounded-md text-text-muted outline-none focus-visible:ring-2 focus-visible:ring-focus",
              "size-[52px] xl:h-10 xl:w-auto xl:flex-row xl:justify-start xl:gap-3 xl:px-3",
              active
                ? "bg-primary-subtle font-bold text-primary"
                : "hover:bg-surface-2",
            )}
          >
            <Icon
              aria-hidden
              className="size-[18px] flex-none"
              strokeWidth={1.75}
            />
            <span className="hidden text-body-sm xl:inline">{item.label}</span>
            {(badges[item.href] ?? 0) > 0 && (
              <span className="rounded-full border border-border bg-surface px-1.5 text-caption font-bold text-status-pending xl:ml-auto">
                {badges[item.href]}
              </span>
            )}
            <span className="text-[10px] leading-3 xl:hidden">
              {item.shortLabel}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}
