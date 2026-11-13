import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  CAMPAIGN_COLUMNS,
  toCampaignRow,
} from "@/features/campaigns/campaign-query";
import type { CampaignRow } from "@/features/campaigns/campaign-view";
import { kstBuckets, periodToRange } from "@/lib/kst";
import type { Database } from "@/server/db/database.types";
import { sortActive, type TodayTotals } from "./home-summary";
import { fillTrend, TREND_SPAN, type TrendPoint } from "./trend";

const ACTIVE_LIMIT = 5;
const PENDING_LIMIT = 3;
const RECENT_LIMIT = 5;

export type HomeData = {
  today: TodayTotals | undefined;
  scheduledCount: number;
  /** 진행 중·예약·오늘 끝난 건. 최대 ACTIVE_LIMIT건. */
  active: CampaignRow[];
  /** 진행 중·예약 건수. 오늘 끝난 건은 세지 않는다. */
  activeTotal: number;
  pending: CampaignRow[];
  pendingTotal: number;
  recent: CampaignRow[];
  balances: { branch_id: string | null; balance: number | null }[];
  branches: { id: string; name: string }[];
  /** 발송 추이. 단위 전환이 서버 왕복 없이 바로 바뀌도록 두 단위를 함께 받는다(합쳐 42칸). */
  trend: { day: TrendPoint[]; month: TrendPoint[] };
};

/**
 * 범위를 코드로 좁히지 않는다. 사용자 세션 클라이언트라 RLS가 지점이면 자기 지점, 본사면 전체로 자른다.
 * 조회를 동시에 보낸다. 하나씩 기다리면 화면을 여는 시간이 조회 수만큼 늘어난다.
 */
export async function loadHome(
  supabase: SupabaseClient<Database>,
  options: { orgId: string; isHq: boolean; now: Date },
): Promise<HomeData> {
  const { from } = periodToRange("today", null, null, options.now);
  const todayStart = from ?? options.now.toISOString();
  const campaigns = () => supabase.from("campaigns").select(CAMPAIGN_COLUMNS);
  const dayBuckets = kstBuckets("day", TREND_SPAN.day, options.now);
  const monthBuckets = kstBuckets("month", TREND_SPAN.month, options.now);

  const [
    today,
    scheduled,
    active,
    finishedToday,
    pending,
    recent,
    balances,
    branches,
    dayTrend,
    monthTrend,
  ] = await Promise.all([
    // 예약은 오늘 나간 건이 아니다. 시작 시각으로 세어야 어제 예약해 오늘 나간 건이 들어온다.
    supabase.rpc("today_campaign_summary", { p_from: todayStart }),
    supabase
      .from("campaigns")
      .select("id", { count: "exact", head: true })
      .eq("status", "scheduled"),
    // 순서는 상태 값의 정의 순서가 아니라 화면 규칙(sortActive)으로 코드에서 정한다.
    supabase
      .from("campaigns")
      .select(CAMPAIGN_COLUMNS, { count: "exact" })
      .in("status", ["sending", "scheduled"])
      .order("created_at", { ascending: false })
      .limit(ACTIVE_LIMIT),
    // 오늘 끝난 건도 남은 자리에 보여 준다. 끝나는 순간 목록에서 사라지면 "다 도착했다"는 결과를 볼 수 없다.
    // 따로 읽는 이유: 함께 최신순으로 자르면 오늘 끝난 건이 많을 때 진행 중인 건이 밀려난다.
    supabase
      .from("campaigns")
      .select(CAMPAIGN_COLUMNS)
      .eq("status", "completed")
      .gte("completed_at", todayStart)
      .order("completed_at", { ascending: false })
      .limit(ACTIVE_LIMIT),
    supabase
      .from("campaigns")
      .select(CAMPAIGN_COLUMNS, { count: "exact" })
      .eq("status", "pending_approval")
      .order("created_at", { ascending: false })
      .limit(PENDING_LIMIT),
    campaigns()
      .in("status", ["sending", "completed"])
      .order("created_at", { ascending: false })
      .limit(RECENT_LIMIT),
    supabase
      .from("account_balances")
      .select("branch_id, balance")
      .eq("org_id", options.orgId),
    options.isHq
      ? supabase.from("branches").select("id, name").order("name")
      : Promise.resolve({ data: [], error: null }),
    supabase.rpc("campaign_trend", { p_from: dayBuckets.start, p_unit: "day" }),
    supabase.rpc("campaign_trend", {
      p_from: monthBuckets.start,
      p_unit: "month",
    }),
  ]);

  const failure =
    today.error ??
    scheduled.error ??
    active.error ??
    finishedToday.error ??
    pending.error ??
    recent.error ??
    balances.error ??
    branches.error ??
    dayTrend.error ??
    monthTrend.error;
  if (failure) throw new Error(`첫 화면 조회 실패: ${failure.message}`);

  return {
    today: today.data?.[0],
    scheduledCount: scheduled.count ?? 0,
    active: [
      ...sortActive((active.data ?? []).map(toCampaignRow)),
      ...(finishedToday.data ?? []).map(toCampaignRow),
    ].slice(0, ACTIVE_LIMIT),
    activeTotal: active.count ?? 0,
    pending: (pending.data ?? []).map(toCampaignRow),
    pendingTotal: pending.count ?? 0,
    recent: (recent.data ?? []).map(toCampaignRow),
    balances: balances.data ?? [],
    branches: branches.data ?? [],
    trend: {
      day: fillTrend(dayTrend.data ?? [], dayBuckets.keys, "day"),
      month: fillTrend(monthTrend.data ?? [], monthBuckets.keys, "month"),
    },
  };
}
