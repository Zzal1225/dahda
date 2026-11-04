import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { z } from "zod";
import { StatusBadge } from "@/components/ui/status-badge";
import { ApprovalDecision } from "@/features/campaigns/approval-decision";
import { getApproval } from "@/features/campaigns/approval-query";
import { byteLength } from "@/features/campaigns/campaignSchema";
import { PhonePreview } from "@/features/campaigns/phone-preview";
import { formatPhone, formatWon } from "@/lib/format";
import { formatKstDateTime } from "@/lib/kst";
import { requireRole } from "@/server/auth/requireRole";
import { createSupabaseServerClient } from "@/server/supabase/server";

export const metadata: Metadata = { title: "승인 요청 · dahda" };

async function Approval({ params }: PageProps<"/approvals/[id]">) {
  await requireRole(["hq"]);
  const { id } = await params;
  // 이미 처리했거나 잘못된 주소면 목록으로 돌려보낸다. 다른 담당자가 먼저 처리한 경우에도 같다.
  if (!z.uuid().safeParse(id).success) redirect("/approvals");

  const supabase = await createSupabaseServerClient();
  const approval = await getApproval(supabase, id);
  if (!approval) redirect("/approvals");

  const when = approval.scheduledAt
    ? `${formatKstDateTime(approval.scheduledAt)} KST`
    : "승인 즉시";
  const shortage = approval.estimatedCost > approval.balance;
  const info: [string, string][] = [
    ["받는 사람", `${approval.recipientCount.toLocaleString("ko-KR")}명`],
    ["보내는 시각", when],
    [
      "종류·크기",
      `광고 ${approval.kind.toUpperCase()} · ${byteLength(approval.body).toLocaleString("ko-KR")}byte`,
    ],
    ["예상 비용", formatWon(approval.estimatedCost)],
    [
      "차감 잔액",
      `${approval.branchName} · 현재 ${formatWon(approval.balance)}`,
    ],
    [
      "발신번호",
      approval.senderPhone ? formatPhone(approval.senderPhone) : "—",
    ],
  ];

  return (
    <>
      <div className="flex items-center gap-2">
        <Link
          href="/approvals"
          aria-label="승인함으로 돌아가기"
          className="flex size-11 items-center justify-center rounded-md outline-none hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-focus"
        >
          <ArrowLeft aria-hidden className="size-5" />
        </Link>
        <span className="text-body-sm font-bold">승인 요청</span>
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <StatusBadge tone="pending" label="승인 대기" />
          {approval.requestedAt && (
            <span className="text-caption text-text-muted">
              {formatKstDateTime(approval.requestedAt)} 요청
            </span>
          )}
        </div>
        <h1 className="text-title-lg">{approval.branchName} 광고 문자</h1>
      </div>

      <dl className="flex flex-col rounded-lg border border-border bg-surface text-body-sm">
        {info.map(([label, value]) => (
          <div
            key={label}
            className="flex justify-between gap-3 border-b border-border px-4 py-3 last:border-b-0"
          >
            <dt className="text-text-muted">{label}</dt>
            <dd className="text-right">{value}</dd>
          </div>
        ))}
      </dl>

      {shortage && (
        <p role="alert" className="text-body-sm font-bold text-danger">
          {approval.branchName} 잔액이{" "}
          {formatWon(approval.estimatedCost - approval.balance)} 부족해요.
          지점에서 충전한 뒤 승인할 수 있어요.
        </p>
      )}

      <section aria-label="전체 본문" className="flex flex-col gap-2">
        <h2 className="text-title">전체 본문</h2>
        <p
          data-testid="approval-body"
          className="rounded-lg border border-border bg-surface p-4 text-body-sm break-words whitespace-pre-wrap"
        >
          {approval.body}
        </p>
        <p className="text-caption text-text-muted">
          (광고) 표기와 수신거부 안내는 자동으로 들어간 문구예요.
        </p>
      </section>

      <aside aria-label="휴대폰 미리보기">
        <PhonePreview
          className="h-[480px] w-[264px]"
          sender={approval.senderPhone ?? ""}
          caption={`${approval.kind.toUpperCase()} · ${when}`}
          body={approval.body}
          testId="approval-preview"
        />
      </aside>

      <ApprovalDecision
        campaignId={approval.id}
        branchName={approval.branchName}
        summary={[
          ["받는 사람", `${approval.recipientCount.toLocaleString("ko-KR")}명`],
          ["보내는 시각", when],
          [
            `${approval.branchName} 잔액에서 차감`,
            formatWon(approval.estimatedCost),
          ],
        ]}
      />
      {/* 고정된 버튼에 마지막 내용이 가리지 않게 자리를 둔다. */}
      <div aria-hidden className="h-20 md:hidden" />
    </>
  );
}

export default function ApprovalPage(props: PageProps<"/approvals/[id]">) {
  return (
    <>
      <span data-mobile-ok hidden />
      <div className="mx-auto flex w-full max-w-[720px] flex-col gap-5">
        <Suspense
          fallback={<div aria-hidden className="h-96 rounded-lg bg-skeleton" />}
        >
          <Approval {...props} />
        </Suspense>
      </div>
    </>
  );
}
