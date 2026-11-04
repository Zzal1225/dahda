import { Info, Store } from "lucide-react";
import { redirect } from "next/navigation";
import { getTrialRoleOptions } from "@/features/auth/trial-role-options";
import { getOwnBalance } from "@/features/billing/balance";
import { countApprovals } from "@/features/campaigns/approval-query";
import { formatWon, isLowBalance } from "@/lib/format";
import { cn } from "@/lib/utils";
import { getCurrentMember } from "@/server/auth/current-member";
import { createSupabaseServerClient } from "@/server/supabase/server";
import { AccountMenu } from "./account-menu";
import { navItemsFor } from "./nav-items";
import { RoleSwitcher } from "./role-switcher";
import { SidebarNav } from "./sidebar-nav";

/*
 * 세션을 읽는 조각들. 레이아웃이 각각을 Suspense로 감싸 틀은 정적 셸로 먼저 보여 준다.
 * 레이아웃 최상단에서 세션을 기다리면 하위 화면 전체가 그 요청에 묶인다.
 * 같은 조회를 조각마다 불러도 getCurrentMember의 react cache가 한 번으로 합친다.
 */

export async function TrialBanner() {
  const member = await getCurrentMember();
  if (!member?.isTrial) return null;

  return (
    <div
      role="note"
      className="flex h-8 flex-none items-center justify-center gap-2 border-b border-border bg-surface-3 text-caption font-bold"
    >
      <Info
        aria-hidden
        className="size-3.5 text-status-pending"
        strokeWidth={2}
      />
      체험 계정이에요. 실제 문자는 나가지 않아요
    </div>
  );
}

export async function SidebarSection() {
  const member = await getCurrentMember();
  if (!member) return null;

  // 본사만 센다. 승인할 사람에게만 의미가 있는 숫자다.
  const approvals =
    member.role === "hq"
      ? await countApprovals(await createSupabaseServerClient())
      : 0;

  return (
    <SidebarNav
      items={navItemsFor(member.role)}
      badges={{ "/approvals": approvals }}
    />
  );
}

export async function TopBarSection() {
  const member = await getCurrentMember();
  // Proxy는 세션만 본다. 세션은 있지만 소속이 없는 사용자는 여기서 돌려보낸다.
  if (!member) redirect("/login");

  const [balance, roleOptions] = await Promise.all([
    getOwnBalance(member),
    getTrialRoleOptions(member),
  ]);
  const low = isLowBalance(balance);

  return (
    <>
      {/* 본사의 지점 선택 드롭다운은 그 기준으로 바뀌는 숫자가 생기는 첫 화면 작업(step5)에서 넣는다. */}
      <span className="hidden items-center gap-2 text-body-sm font-bold md:flex">
        <Store
          aria-hidden
          className="size-4 text-text-muted"
          strokeWidth={1.75}
        />
        {member.branchName ?? "전체 지점"}
      </span>
      <div className="ml-auto hidden items-center gap-3 md:flex">
        <span
          className={cn(
            "text-caption text-text-muted",
            low && "font-bold text-status-pending",
          )}
        >
          {member.role === "hq" ? "본사 잔액" : "잔액"}
          {low && " 적음"}
        </span>
        <span
          className={cn("text-body font-bold", low && "text-status-pending")}
        >
          {formatWon(balance)}
        </span>
      </div>
      <span aria-hidden className="hidden h-6 w-px bg-border md:block" />
      <span aria-hidden className="ml-auto md:hidden" />
      {member.isTrial && (
        <RoleSwitcher options={roleOptions} currentBranchId={member.branchId} />
      )}
      <AccountMenu displayName={member.displayName} />
    </>
  );
}
