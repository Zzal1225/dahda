import Link from "next/link";
import type { ReactNode } from "react";
import { buttonVariants } from "@/components/ui/button";
import { ProgressBar } from "@/components/ui/progress-bar";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  campaignStatusView,
  campaignTitle,
  messageCounts,
  type CampaignRow,
} from "@/features/campaigns/campaign-view";
import { formatWon } from "@/lib/format";
import { formatKstDateTime } from "@/lib/kst";
import { cn } from "@/lib/utils";
import type { CurrentMember } from "@/server/auth/current-member";
import { HomeLive } from "./home-live";
import type { HomeData } from "./home-query";
import { timeUntil, toTodaySummary } from "./home-summary";
import { RecentTable } from "./recent-table";

function Card({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section
      aria-label={label}
      className={cn(
        "flex flex-col gap-2 rounded-lg border border-border bg-surface p-5",
        className,
      )}
    >
      {children}
    </section>
  );
}

function metaOf(campaign: CampaignRow, showBranch: boolean): string {
  return [
    showBranch ? (campaign.branchName ?? "본사") : null,
    campaign.kind.toUpperCase(),
    `${campaign.recipientCount.toLocaleString("ko-KR")}명`,
  ]
    .filter(Boolean)
    .join(" · ");
}

function ActiveItem({
  campaign,
  showBranch,
  now,
}: {
  campaign: CampaignRow;
  showBranch: boolean;
  now: Date;
}) {
  return (
    <li className="grid items-center gap-4 rounded-md border border-border px-4 py-3 md:grid-cols-[1fr_240px]">
      <div className="flex min-w-0 flex-col gap-1">
        <div className="flex min-w-0 items-center gap-2">
          <StatusBadge {...campaignStatusView(campaign)} />
          <span className="truncate text-body-sm font-bold">
            {campaignTitle(campaign.body, campaign.isAd, 40)}
          </span>
        </div>
        <span className="text-caption text-text-muted">
          {metaOf(campaign, showBranch)}
        </span>
      </div>
      {campaign.status === "sending" ? (
        <ProgressBar
          counts={messageCounts(campaign)}
          total={campaign.recipientCount}
        />
      ) : (
        <div className="flex flex-col text-caption text-text-muted">
          {campaign.scheduledAt && (
            <span>{formatKstDateTime(campaign.scheduledAt)}</span>
          )}
          <span>{timeUntil(campaign.scheduledAt, now)}</span>
        </div>
      )}
    </li>
  );
}

/** 서버 컴포넌트다. 숫자는 서버 한 곳에서 계산하고, 갱신이 필요하면 HomeLive가 다시 그리게 한다. */
export function HomeScreen({
  member,
  data,
  now,
}: {
  member: CurrentMember;
  data: HomeData;
  now: Date;
}) {
  const isHq = member.role === "hq";
  const summary = toTodaySummary(data.today);
  const balanceOf = (branchId: string | null) =>
    data.balances.find((row) => row.branch_id === branchId)?.balance ?? 0;
  const ownBalance = balanceOf(member.branchId);

  return (
    <div className="flex max-w-[1200px] flex-col gap-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="text-title-lg">홈</h1>
          <p className="text-body-sm text-text-muted">
            {member.orgName} ·{" "}
            {member.branchName ?? "전체 지점 + 본사 발송 기준"}
          </p>
        </div>
        <Link href="/compose" className={buttonVariants()}>
          문자 작성
        </Link>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card label="오늘 발송">
          <span className="text-body-sm font-bold text-text-muted">
            오늘 발송
          </span>
          <span className="text-number-lg">
            {summary.recipientCount.toLocaleString("ko-KR")}
            <span className="text-body font-bold"> 건</span>
          </span>
          <span className="text-caption text-text-muted">
            발송 건 {summary.campaignCount}개 · 예약 {data.scheduledCount}건은
            제외
          </span>
        </Card>
        <Card label="오늘 도착률">
          <span className="text-body-sm font-bold text-text-muted">
            오늘 도착률
          </span>
          <span className="text-number-lg">
            {summary.deliveryRate === null ? "—" : summary.deliveryRate}
            {summary.deliveryRate !== null && (
              <span className="text-body font-bold"> %</span>
            )}
          </span>
          <span className="text-caption text-text-muted">
            도착 {summary.delivered.toLocaleString("ko-KR")} · 확인 중{" "}
            {summary.pending.toLocaleString("ko-KR")} · 실패{" "}
            {summary.failed.toLocaleString("ko-KR")}
          </span>
        </Card>
        <Card label="잔액">
          <span className="text-body-sm font-bold text-text-muted">
            {isHq ? "본사 잔액" : "잔액"}
          </span>
          <span className="text-number-lg">{formatWon(ownBalance)}</span>
          <Link href="/billing" className="text-caption underline">
            충전하기
          </Link>
        </Card>
      </div>

      <div className="grid items-start gap-4 lg:grid-cols-[2fr_1fr]">
        <Card label="진행 중인 발송">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-body font-bold">
              진행 중인 발송 {data.activeTotal}건
            </h2>
            <HomeLive
              filter={
                member.branchId
                  ? `branch_id=eq.${member.branchId}`
                  : `org_id=eq.${member.orgId}`
              }
              hasActive={data.activeTotal > 0}
            />
          </div>
          {data.active.length === 0 ? (
            <div className="flex flex-col items-center gap-2 p-8 text-center">
              <p className="text-body-sm text-text-muted">
                진행 중인 발송이 없어요
              </p>
              <Link href="/compose" className="text-body-sm underline">
                문자 작성하기
              </Link>
            </div>
          ) : (
            <ul className="flex flex-col gap-2">
              {data.active.map((campaign) => (
                <ActiveItem
                  key={campaign.id}
                  campaign={campaign}
                  showBranch={isHq}
                  now={now}
                />
              ))}
            </ul>
          )}
          {data.activeTotal > data.active.length && (
            <Link href="/history" className="text-caption underline">
              전체 {data.activeTotal}건 보기
            </Link>
          )}
        </Card>

        <div className="flex flex-col gap-4">
          <Card
            label="승인 대기"
            className={cn(
              isHq &&
                data.pendingTotal > 0 &&
                "border-primary bg-primary-subtle",
            )}
          >
            <h2 className="text-body font-bold">승인 대기</h2>
            <p className="text-body-sm">
              {isHq ? "승인을 기다리는 지점 광고" : "본사 승인을 기다리는 광고"}{" "}
              <strong>{data.pendingTotal}건</strong>
            </p>
            {data.pending.length > 0 && (
              <ul className="flex flex-col gap-1">
                {data.pending.map((campaign) => (
                  <li key={campaign.id} className="flex min-w-0 flex-col">
                    <span className="truncate text-body-sm font-bold">
                      {campaignTitle(campaign.body, campaign.isAd, 24)}
                    </span>
                    <span className="text-caption text-text-muted">
                      {metaOf(campaign, isHq)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <Link
              href={isHq ? "/approvals" : "/history"}
              className="text-caption underline"
            >
              {isHq ? "승인함으로" : "발송 내역에서 보기"}
            </Link>
          </Card>

          {isHq && (
            <Card label="지점별 잔액">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="text-body font-bold">지점별 잔액</h2>
                <span className="text-caption text-text-muted">
                  조회 전용 · 충전은 각 지점이
                </span>
              </div>
              <ul className="flex flex-col">
                {data.branches.map((branch) => {
                  const balance = balanceOf(branch.id);
                  return (
                    <li
                      key={branch.id}
                      className="flex h-11 items-center justify-between gap-2 text-body-sm"
                    >
                      <span>{branch.name}</span>
                      <span className="font-bold">{formatWon(balance)}</span>
                    </li>
                  );
                })}
              </ul>
            </Card>
          )}
        </div>
      </div>

      <section aria-label="최근 발송 목록" className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className="text-body font-bold">최근 발송</h2>
          <Link href="/history" className="text-body-sm underline">
            전체 보기
          </Link>
        </div>
        {data.recent.length === 0 ? (
          <p className="rounded-lg border border-border bg-surface p-12 text-center text-body-sm text-text-muted">
            아직 보낸 문자가 없어요
          </p>
        ) : (
          <RecentTable rows={data.recent} showBranch={isHq} />
        )}
      </section>
    </div>
  );
}
