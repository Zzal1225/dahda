"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const TABS = [
  { href: "/contacts", label: "연락처" },
  { href: "/contacts/opt-outs", label: "수신거부" },
];

export function ContactsTabs() {
  const pathname = usePathname();
  return (
    <nav aria-label="주소록" className="flex gap-1 border-b border-border">
      {TABS.map((tab) => {
        const active = pathname === tab.href;
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "-mb-px border-b-2 px-3 py-2 text-body-sm outline-none focus-visible:ring-2 focus-visible:ring-focus",
              active
                ? "border-primary font-bold text-primary"
                : "border-transparent text-text-muted hover:text-text",
            )}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
