import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  CAMPAIGN_COLUMNS,
  toCampaignRow,
} from "@/features/campaigns/campaign-query";
import type { CampaignRow } from "@/features/campaigns/campaign-view";
import { periodToRange } from "@/lib/kst";
import type { Database } from "@/server/db/database.types";
import type { TodayTotals } from "./home-summary";

const ACTIVE_LIMIT = 5;
const PENDING_LIMIT = 3;
const RECENT_LIMIT = 5;

export type HomeData = {
  today: TodayTotals | undefined;
  scheduledCount: number;
  active: CampaignRow[];
  activeTotal: number;
  pending: CampaignRow[];
  pendingTotal: number;
  recent: CampaignRow[];
  balances: { branch_id: string | null; balance: number | null }[];
  branches: { id: string; name: string }[];
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

  const [today, scheduled, active, pending, recent, balances, branches] =
    await Promise.all([
      // 예약은 오늘 나간 건이 아니다. 시작 시각으로 세어야 어제 예약해 오늘 나간 건이 들어온다.
      supabase.rpc("today_campaign_summary", { p_from: todayStart }),
      supabase
        .from("campaigns")
        .select("id", { count: "exact", head: true })
        .eq("status", "scheduled"),
      supabase
        .from("campaigns")
        .select(CAMPAIGN_COLUMNS, { count: "exact" })
        .in("status", ["sending", "scheduled"])
        .order("status", { ascending: false })
        .order("created_at", { ascending: false })
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
    ]);

  const failure =
    today.error ??
    scheduled.error ??
    active.error ??
    pending.error ??
    recent.error ??
    balances.error ??
    branches.error;
  if (failure) throw new Error(`첫 화면 조회 실패: ${failure.message}`);

  return {
    today: today.data?.[0],
    scheduledCount: scheduled.count ?? 0,
    active: (active.data ?? []).map(toCampaignRow),
    activeTotal: active.count ?? 0,
    pending: (pending.data ?? []).map(toCampaignRow),
    pendingTotal: pending.count ?? 0,
    recent: (recent.data ?? []).map(toCampaignRow),
    balances: balances.data ?? [],
    branches: branches.data ?? [],
  };
}
