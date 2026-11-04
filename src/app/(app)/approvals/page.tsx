import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { StatusBadge } from "@/components/ui/status-badge";
import { listApprovals } from "@/features/campaigns/approval-query";
import { campaignTitle } from "@/features/campaigns/campaign-view";
import { formatWon } from "@/lib/format";
import { formatKstDateTime } from "@/lib/kst";
import { requireRole } from "@/server/auth/requireRole";
import { createSupabaseServerClient } from "@/server/supabase/server";

export const metadata: Metadata = { title: "승인함 · dahda" };

const DONE_MESSAGE: Record<string, string> = {
  approved: "승인했어요",
  rejected: "반려했어요",
};

async function Approvals({ searchParams }: PageProps<"/approvals">) {
  await requireRole(["hq"]);
  const { done } = await searchParams;
  const supabase = await createSupabaseServerClient();
  const rows = await listApprovals(supabase);
  const doneMessage = typeof done === "string" ? DONE_MESSAGE[done] : undefined;

  return (
    <>
      <div className="flex flex-col gap-1">
        <h1 className="text-title-lg">
          승인 대기 <span className="text-primary">{rows.length}건</span>
        </h1>
        <p className="text-body-sm text-text-muted">
          지점이 요청한 광고 문자예요. 승인하면 바로 발송되거나 예약됩니다.
        </p>
      </div>

      {doneMessage && (
        <p
          role="status"
          className="rounded-md bg-surface-2 px-4 py-3 text-body-sm font-bold"
        >
          {doneMessage}
        </p>
      )}

      {rows.length === 0 ? (
        <p className="rounded-lg border border-border bg-surface p-12 text-center text-body-sm text-text-muted">
          승인을 기다리는 문자가 없어요
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {rows.map((row) => (
            <li key={row.id}>
              <Link
                href={`/approvals/${row.id}`}
                className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4 outline-none hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-focus"
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="flex min-w-0 items-baseline gap-2">
                    <span className="font-bold">{row.branchName}</span>
                    {row.requestedAt && (
                      <span className="text-caption text-text-muted">
                        {formatKstDateTime(row.requestedAt)}
                      </span>
                    )}
                  </div>
                  <StatusBadge tone="pending" label="승인 대기" />
                </div>
                <p className="line-clamp-3 text-body-sm whitespace-pre-wrap">
                  {campaignTitle(row.body, true, 120)}
                </p>
                <dl className="grid grid-cols-3 gap-2 border-t border-border pt-3 text-caption">
                  <div>
                    <dt className="text-text-muted">수신자</dt>
                    <dd className="font-bold">
                      {row.recipientCount.toLocaleString("ko-KR")}명
                    </dd>
                  </div>
                  <div>
                    <dt className="text-text-muted">예상 비용</dt>
                    <dd className="font-bold">
                      {formatWon(row.estimatedCost)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-text-muted">보내는 시각</dt>
                    <dd className="font-bold">
                      {row.scheduledAt
                        ? formatKstDateTime(row.scheduledAt)
                        : "승인 즉시"}
                    </dd>
                  </div>
                </dl>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

export default function ApprovalsPage(props: PageProps<"/approvals">) {
  return (
    <>
      {/* 이 표시가 있는 화면만 모바일에서 보인다(globals.css). */}
      <span data-mobile-ok hidden />
      <div className="mx-auto flex w-full max-w-[720px] flex-col gap-5">
        <Suspense
          fallback={<div aria-hidden className="h-64 rounded-lg bg-skeleton" />}
        >
          <Approvals {...props} />
        </Suspense>
      </div>
    </>
  );
}
