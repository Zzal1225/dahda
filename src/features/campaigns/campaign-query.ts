import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { CAMPAIGN_STATE_FILTERS } from "@/features/messages/table-state";
import type { Database } from "@/server/db/database.types";
import type { CampaignRow } from "./campaign-view";

/** branch 필터의 "본사 발송" 값. 지점 id(uuid)와 겹치지 않는다. */
export const HQ_BRANCH_FILTER = "hq";

// 목록은 표 하나에 다 그린다. 체험과 측정 범위에서는 충분하며, 넘치면 안내하고 기간을 좁히게 한다.
export const CAMPAIGN_LIST_LIMIT = 200;

export const campaignQuerySchema = z.object({
  from: z.iso.datetime().nullable().default(null),
  to: z.iso.datetime().nullable().default(null),
  branch: z
    .union([z.literal(HQ_BRANCH_FILTER), z.uuid()])
    .nullable()
    .default(null),
  ad: z.enum(["all", "ad", "non_ad"]).default("all"),
  state: z.enum(CAMPAIGN_STATE_FILTERS).nullable().default(null),
});
export type CampaignQuery = z.infer<typeof campaignQuerySchema>;

/** 첫 화면도 같은 열을 읽는다. 열 이름 변환이 두 벌이 되지 않게 여기 하나만 둔다. */
export const CAMPAIGN_COLUMNS =
  "id, branch_id, body, kind, is_ad, status, recipient_count, unit_price, estimated_cost, sent_count, delivered_count, failed_count, started_at, scheduled_at, reviewed_at, rejected_reason, retry_of_campaign_id, created_at, branches(name)";

type CampaignColumns = {
  id: string;
  branch_id: string | null;
  body: string;
  kind: CampaignRow["kind"];
  is_ad: boolean;
  status: CampaignRow["status"];
  recipient_count: number;
  unit_price: number;
  estimated_cost: number;
  sent_count: number;
  delivered_count: number;
  failed_count: number;
  started_at: string | null;
  scheduled_at: string | null;
  reviewed_at: string | null;
  rejected_reason: string | null;
  retry_of_campaign_id: string | null;
  created_at: string;
  branches: { name: string } | null;
};

export function toCampaignRow(row: CampaignColumns): CampaignRow {
  return {
    id: row.id,
    branchId: row.branch_id,
    branchName: row.branches?.name ?? null,
    body: row.body,
    kind: row.kind,
    isAd: row.is_ad,
    status: row.status,
    recipientCount: row.recipient_count,
    unitPrice: row.unit_price,
    estimatedCost: row.estimated_cost,
    sentCount: row.sent_count,
    deliveredCount: row.delivered_count,
    failedCount: row.failed_count,
    displayAt: row.started_at ?? row.scheduled_at ?? row.created_at,
    scheduledAt: row.scheduled_at,
    reviewedAt: row.reviewed_at,
    rejectedReason: row.rejected_reason,
    retryOfCampaignId: row.retry_of_campaign_id,
  };
}

/**
 * 호출자가 사용자 권한 클라이언트를 넘긴다. 지점 사용자가 다른 지점 id로 필터해도 RLS가 빈 결과를 돌려준다.
 * 작성 중인 건은 아직 발송 내역이 아니어서 뺀다.
 */
export async function listCampaigns(
  supabase: SupabaseClient<Database>,
  query: CampaignQuery,
): Promise<CampaignRow[]> {
  let request = supabase
    .from("campaigns")
    .select(CAMPAIGN_COLUMNS)
    .neq("status", "draft");

  if (query.from) request = request.gte("created_at", query.from);
  if (query.to) request = request.lt("created_at", query.to);
  if (query.branch === HQ_BRANCH_FILTER) {
    request = request.is("branch_id", null);
  } else if (query.branch) {
    request = request.eq("branch_id", query.branch);
  }
  if (query.ad !== "all") request = request.eq("is_ad", query.ad === "ad");
  // 실패는 발송 중에도 생긴다. 끝난 건만 보면 지금 실패가 쌓이는 건을 놓친다.
  if (query.state === "has_failed") {
    request = request.gt("failed_count", 0);
  } else if (query.state) {
    request = request.eq("status", query.state);
  }

  const { data, error } = await request
    .order("created_at", { ascending: false })
    .order("id")
    .limit(CAMPAIGN_LIST_LIMIT);

  if (error) throw new Error(`발송 건 조회 실패: ${error.message}`);

  return data.map(toCampaignRow);
}
