import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { chargeResultMessage } from "@/features/billing/charge-schema";
import { ChargePanel } from "@/features/billing/charge-panel";
import {
  billingFiltersSchema,
  LEDGER_PAGE_SIZE,
  listLedger,
} from "@/features/billing/ledger-query";
import { LedgerTable } from "@/features/billing/ledger-table";
import { formatWon } from "@/lib/format";
import { cn } from "@/lib/utils";
import { requireRole } from "@/server/auth/requireRole";
import { tossClientKey } from "@/server/providers/toss/toss-config";
import { createSupabaseServerClient } from "@/server/supabase/server";

export const metadata: Metadata = { title: "충전 · dahda" };

const TONE_CLASS = {
  success: "text-status-delivered",
  pending: "text-status-pending",
  error: "text-status-failed",
} as const;

async function Billing({ searchParams }: PageProps<"/billing">) {
  const member = await requireRole(["hq", "branch"]);
  const filters = billingFiltersSchema.parse(await searchParams);
  const supabase = await createSupabaseServerClient();

  const [{ data: balances, error: balanceError }, branches] = await Promise.all(
    [
      supabase
        .from("account_balances")
        .select("branch_id, balance")
        .eq("org_id", member.orgId),
      member.role === "hq"
        ? supabase.from("branches").select("id, name").order("name")
        : Promise.resolve({ data: [], error: null }),
    ],
  );
  if (balanceError || branches.error) {
    throw new Error("잔액 조회 실패");
  }
  const balanceOf = (branchId: string | null) =>
    balances?.find((row) => row.branch_id === branchId)?.balance ?? 0;

  // 본사만 지점을 고를 수 있다. 지점 계정은 주소 값을 무시하고 항상 자기 계정이다.
  const viewedBranch =
    member.role === "hq"
      ? (branches.data?.find((branch) => branch.id === filters.branch) ?? null)
      : null;
  const accountBranchId = viewedBranch?.id ?? member.branchId;
  const ownAccount = viewedBranch === null;

  const { rows, total } = await listLedger(
    supabase,
    { orgId: member.orgId, branchId: accountBranchId },
    filters.page,
  );
  const message = chargeResultMessage(filters.result, filters.code);
  const lastPage = Math.max(1, Math.ceil(total / LEDGER_PAGE_SIZE));
  const hrefOf = (page: number) => {
    const next = new URLSearchParams();
    if (viewedBranch) next.set("branch", viewedBranch.id);
    if (page > 1) next.set("page", String(page));
    const query = next.toString();
    return query ? `/billing?${query}` : "/billing";
  };

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-title-lg">충전</h1>
      {message && (
        <p
          role="status"
          className={cn("text-body-sm font-bold", TONE_CLASS[message.tone])}
        >
          {message.text}
        </p>
      )}

      <section
        aria-label="잔액"
        className="flex flex-col gap-1 rounded-lg border border-border bg-surface p-4"
      >
        <span className="text-caption text-text-muted">
          {viewedBranch
            ? `${viewedBranch.name} 잔액`
            : member.role === "hq"
              ? "본사 잔액"
              : "내 잔액"}
        </span>
        <span className="text-title">
          {formatWon(balanceOf(accountBranchId))}
        </span>
      </section>

      {/* 충전은 계정 주인만 한다. 본사가 지점 내역을 볼 때는 버튼을 숨긴다. */}
      {ownAccount && tossClientKey() && <ChargePanel />}

      {member.role === "hq" && (
        <section
          aria-label="지점 잔액"
          className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4"
        >
          <h2 className="text-body font-bold">지점 별 잔액 현황</h2>
          <ul className="flex flex-wrap gap-2">
            <li>
              <Link
                href="/billing"
                aria-current={ownAccount ? "true" : undefined}
                className={cn(
                  "flex gap-2 rounded-md border border-border px-3 py-2 text-body-sm",
                  ownAccount && "font-bold",
                )}
              >
                본사 {formatWon(balanceOf(null))}
              </Link>
            </li>
            {branches.data?.map((branch) => (
              <li key={branch.id}>
                <Link
                  href={`/billing?branch=${branch.id}`}
                  aria-current={
                    viewedBranch?.id === branch.id ? "true" : undefined
                  }
                  className={cn(
                    "flex gap-2 rounded-md border border-border px-3 py-2 text-body-sm",
                    viewedBranch?.id === branch.id && "font-bold",
                  )}
                >
                  {branch.name} {formatWon(balanceOf(branch.id))}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-label="거래 내역 목록" className="flex flex-col gap-3">
        <h2 className="text-body font-bold">거래 내역</h2>
        {rows.length === 0 ? (
          <p className="rounded-lg border border-border bg-surface p-12 text-center text-body-sm text-text-muted">
            아직 거래 내역이 없어요
          </p>
        ) : (
          <LedgerTable rows={rows} />
        )}
        {lastPage > 1 && (
          <nav aria-label="페이지" className="flex items-center gap-3">
            {filters.page > 1 && (
              <Link href={hrefOf(filters.page - 1)} className="underline">
                이전
              </Link>
            )}
            <span className="text-body-sm text-text-muted">
              {filters.page} / {lastPage}
            </span>
            {filters.page < lastPage && (
              <Link href={hrefOf(filters.page + 1)} className="underline">
                다음
              </Link>
            )}
          </nav>
        )}
      </section>
    </div>
  );
}

export default function BillingPage(props: PageProps<"/billing">) {
  return (
    <Suspense
      fallback={<div aria-hidden className="h-64 rounded-lg bg-skeleton" />}
    >
      <Billing {...props} />
    </Suspense>
  );
}
