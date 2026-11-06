import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowLink } from "@/components/ui/arrow-link";
import { buttonVariants } from "@/components/ui/button";
import { ProgressBar } from "@/components/ui/progress-bar";
import { StatusBadge } from "@/components/ui/status-badge";
import { UNIT_PRICE } from "@/features/campaigns/campaignSchema";
import {
  campaignStatusView,
  campaignTitle,
  messageCounts,
  type CampaignRow,
  type MessageCounts,
} from "@/features/campaigns/campaign-view";
import { formatKstDateTime, formatKstMonthDayWeekday } from "@/lib/kst";
import { cn } from "@/lib/utils";
import type { CurrentMember } from "@/server/auth/current-member";
import { HomeLive } from "./home-live";
import type { HomeData } from "./home-query";
import {
  homeTitle,
  isFullyDelivered,
  smsEstimate,
  timeUntil,
  toTodaySummary,
} from "./home-summary";
import { RecentTable } from "./recent-table";

const won = (amount: number) => amount.toLocaleString("ko-KR");

/** 숫자보다 작고 흐린 단위. 숫자가 먼저 읽히고 단위는 확인용이다. */
function Unit({ children }: { children: ReactNode }) {
  return (
    <span className="text-body font-bold text-text-muted">{children}</span>
  );
}

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
        "flex flex-col gap-3 rounded-lg border border-border bg-surface p-5",
        className,
      )}
    >
      {children}
    </section>
  );
}

/** 띠의 한 칸. 카드 세 장 대신 테두리 하나에 구분선으로 나눠, 세 숫자가 한 묶음으로 읽히게 한다. */
function KpiCell({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section aria-label={label} className="flex min-w-0 flex-col gap-2 p-5">
      <span className="text-body-sm font-bold text-text-muted">{label}</span>
      {children}
    </section>
  );
}

/** 막대의 색과 같은 견본. 확인 중은 막대처럼 빗금이다. */
function Swatch({ tone }: { tone: "delivered" | "sent" | "failed" }) {
  return (
    <span
      aria-hidden
      className={cn(
        "inline-block size-2 rounded-[2px]",
        tone === "delivered" && "bg-status-delivered",
        tone === "sent" &&
          "bg-[repeating-linear-gradient(135deg,var(--st-sent)_0_2px,var(--surface)_2px_4px)]",
        tone === "failed" && "bg-status-failed",
      )}
    />
  );
}

/** "도착 412 · 확인 중 36 · 실패 32". 막대만으로는 몇 건인지 읽을 수 없다. */
function CountLegend({
  counts,
  className,
}: {
  counts: Pick<MessageCounts, "delivered" | "sent" | "failed">;
  className?: string;
}) {
  const items = [
    { tone: "delivered", label: "도착", value: counts.delivered },
    { tone: "sent", label: "확인 중", value: counts.sent },
    { tone: "failed", label: "실패", value: counts.failed },
  ] as const;
  return (
    <span
      className={cn(
        "flex flex-wrap items-center gap-x-2 gap-y-1 text-caption text-text-muted tabular-nums",
        className,
      )}
    >
      {items.map((item, index) => (
        <span key={item.tone} className="inline-flex items-center gap-1">
          {index > 0 && <span aria-hidden>·</span>}
          <Swatch tone={item.tone} />
          {item.label} {won(item.value)}
        </span>
      ))}
    </span>
  );
}

function metaOf(campaign: CampaignRow, showBranch: boolean): string {
  return [
    showBranch ? (campaign.branchName ?? "본사") : null,
    campaign.kind.toUpperCase(),
    `${won(campaign.recipientCount)}명`,
  ]
    .filter(Boolean)
    .join(" · ");
}

/** 오른쪽 칸: 진행 중이면 막대와 숫자, 예약이면 남은 시간, 모두 도착했으면 도장. */
function ActiveProgress({
  campaign,
  now,
}: {
  campaign: CampaignRow;
  now: Date;
}) {
  if (campaign.status === "scheduled") {
    return (
      <div className="flex flex-col text-caption text-text-muted tabular-nums">
        {campaign.scheduledAt && (
          <span>{formatKstDateTime(campaign.scheduledAt)}</span>
        )}
        <span>{timeUntil(campaign.scheduledAt, now)}</span>
      </div>
    );
  }
  if (isFullyDelivered(campaign)) {
    return (
      <div className="flex items-center gap-3">
        {/* 도장처럼 살짝 기울인다. 막대가 꽉 찬 것보다 "끝났다"가 먼저 읽힌다. */}
        <span className="inline-block -rotate-[4deg] rounded-sm border border-status-delivered px-2 py-0.5 text-caption font-bold text-status-delivered">
          도착 확인
        </span>
        <span className="text-caption text-text-muted tabular-nums">
          {won(campaign.recipientCount)}명 모두 도착
        </span>
      </div>
    );
  }
  const counts = messageCounts(campaign);
  return (
    <div className="flex flex-col gap-1.5">
      <ProgressBar counts={counts} total={campaign.recipientCount} />
      <CountLegend counts={counts} />
    </div>
  );
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
    <li className="grid items-center gap-3 py-3 first:pt-0 last:pb-0 md:grid-cols-[minmax(0,1fr)_300px] md:gap-6">
      <div className="flex min-w-0 flex-col gap-1">
        <div className="flex min-w-0 items-center gap-2">
          <StatusBadge {...campaignStatusView(campaign)} />
          <span className="truncate text-body-sm font-bold">
            {campaignTitle(campaign.body, campaign.isAd, 40)}
          </span>
        </div>
        <span className="text-caption text-text-muted tabular-nums">
          {metaOf(campaign, showBranch)}
        </span>
      </div>
      <ActiveProgress campaign={campaign} now={now} />
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
  const inProgressShown = data.active.filter(
    (campaign) => campaign.status !== "completed",
  ).length;
  const hasFinishedToday = data.active.length > inProgressShown;

  return (
    // data-wide: 첫 화면만 본문 폭을 1440px까지 쓴다(globals.css).
    <div data-wide className="flex w-full flex-col gap-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <h1 className="text-title-lg">
            {homeTitle(member, formatKstMonthDayWeekday(now))}
          </h1>
          <p className="text-body-sm text-text-muted">
            {isHq
              ? "전체 지점과 본사 발송 기준"
              : `${member.branchName ?? "지점"} 발송 기준`}
          </p>
        </div>
        <Link href="/compose" className={buttonVariants()}>
          문자 작성
        </Link>
      </div>

      <div className="grid rounded-lg border border-border bg-surface md:grid-cols-3 md:divide-x md:divide-border">
        <KpiCell label="오늘 발송">
          <span className="text-number-lg tabular-nums">
            {won(summary.recipientCount)} <Unit>건</Unit>
          </span>
          <span className="text-caption text-text-muted tabular-nums">
            발송 건 {summary.campaignCount}개 · 예약 {data.scheduledCount}건은
            제외
          </span>
        </KpiCell>
        <KpiCell label="오늘 도착률">
          <span className="text-number-lg tabular-nums">
            {summary.deliveryRate === null ? "—" : summary.deliveryRate}
            {summary.deliveryRate !== null && (
              <>
                {" "}
                <Unit>%</Unit>
              </>
            )}
          </span>
          {/* 분모는 도착률과 같다(도착 + 확인 중 + 실패). 대기 중인 건은 넣지 않는다. */}
          <ProgressBar
            counts={{
              delivered: summary.delivered,
              sent: summary.pending,
              failed: summary.failed,
              queued: 0,
            }}
            total={summary.delivered + summary.pending + summary.failed}
          />
          <CountLegend
            counts={{
              delivered: summary.delivered,
              sent: summary.pending,
              failed: summary.failed,
            }}
          />
        </KpiCell>
        <KpiCell label="잔액">
          <span className="text-number-lg tabular-nums">
            <Unit>₩</Unit>
            {won(ownBalance)}
          </span>
          <div className="flex items-center justify-between gap-2">
            <span className="text-caption text-text-muted tabular-nums">
              {isHq ? "본사 계정" : "내 지점 계정"} ·{" "}
              {smsEstimate(ownBalance, UNIT_PRICE.sms)}
            </span>
            {/* 충전은 이 화면에서 하는 동작에 가깝게 보이도록 버튼 모양이다. 글자 크기는 안쪽 span에 둔다.
                text-caption을 버튼에 붙이면 tailwind-merge가 색 클래스로 읽어 글자색을 지운다. */}
            <Link
              href="/billing"
              className={cn(
                buttonVariants({ variant: "secondary" }),
                "h-8 px-3",
              )}
            >
              <span className="text-caption font-bold">충전하기</span>
            </Link>
          </div>
        </KpiCell>
      </div>

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Card label="진행 중인 발송">
          <div className="flex items-center justify-between gap-2">
            <div className="flex flex-col gap-0.5">
              <h2 className="text-body font-bold">
                진행 중인 발송 {data.activeTotal}건
              </h2>
              {hasFinishedToday && (
                <span className="text-caption text-text-muted">
                  오늘 끝난 건도 함께 보여 줘요
                </span>
              )}
            </div>
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
              <ArrowLink href="/compose">문자 작성하기</ArrowLink>
            </div>
          ) : (
            // 카드 안에 다시 테두리 상자를 두지 않는다. 행 사이 구분선만 둔다.
            <ul className="flex flex-col divide-y divide-border">
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
          {data.activeTotal > inProgressShown && (
            <ArrowLink href="/history" className="self-start">
              진행 중 {data.activeTotal}건 모두 보기
            </ArrowLink>
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
              <strong className="tabular-nums">{data.pendingTotal}건</strong>
            </p>
            {data.pending.length > 0 && (
              <ul className="flex flex-col gap-1">
                {data.pending.map((campaign) => (
                  <li key={campaign.id} className="flex min-w-0 flex-col">
                    <span className="truncate text-body-sm font-bold">
                      {campaignTitle(campaign.body, campaign.isAd, 24)}
                    </span>
                    <span className="text-caption text-text-muted tabular-nums">
                      {metaOf(campaign, isHq)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <ArrowLink
              href={isHq ? "/approvals" : "/history?state=pending_approval"}
              className="self-start"
            >
              {isHq ? "승인함으로" : "발송 내역에서 보기"}
            </ArrowLink>
          </Card>

          {isHq && (
            <Card label="지점별 잔액">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="text-body font-bold">지점별 잔액</h2>
                <span className="text-caption text-text-muted">
                  조회 전용 · 충전은 각 지점이
                </span>
              </div>
              <ul className="flex flex-col divide-y divide-border">
                {data.branches.map((branch) => {
                  const balance = balanceOf(branch.id);
                  return (
                    <li
                      key={branch.id}
                      className="flex items-center justify-between gap-2 py-2.5 text-body-sm first:pt-0 last:pb-0"
                    >
                      <span>{branch.name}</span>
                      <span className="flex flex-col items-end">
                        <span className="font-bold tabular-nums">
                          <span className="text-text-muted">₩</span>
                          {won(balance)}
                        </span>
                        <span className="text-caption text-text-muted tabular-nums">
                          {smsEstimate(balance, UNIT_PRICE.sms)}
                        </span>
                      </span>
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
          <ArrowLink href="/history">전체 보기</ArrowLink>
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
