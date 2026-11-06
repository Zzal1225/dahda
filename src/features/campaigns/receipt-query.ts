import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/server/db/database.types";
import type { ReceiptTotals } from "./delivery-receipt";

/**
 * 사용자 권한 클라이언트를 받는다. campaign_receipt는 security invoker라 RLS가 범위를 자른다.
 * 볼 수 없는 발송 건이면 행이 없어 null이다.
 * 생성 타입은 returns table의 열을 모두 null 아님으로 적지만, 시작 전·결과 전이면 시각은 null이다. 여기서 null을 허용해 받는다.
 */
export async function loadCampaignReceipt(
  supabase: SupabaseClient<Database>,
  campaignId: string,
): Promise<ReceiptTotals | null> {
  const { data, error } = await supabase.rpc("campaign_receipt", {
    p_campaign_id: campaignId,
  });
  if (error) throw new Error(`도착 확인증 조회 실패: ${error.message}`);
  const row = data[0];
  if (!row) return null;
  const at = (value: string | null) => value ?? null;
  return {
    startedAt: at(row.started_at),
    completedAt: at(row.completed_at),
    queued: row.queued,
    awaiting: row.awaiting,
    delivered: row.delivered,
    carrierFailed: row.carrier_failed,
    vendorFailed: row.vendor_failed,
    firstAcceptedAt: at(row.first_accepted_at),
    firstResultAt: at(row.first_result_at),
    firstDeliveredAt: at(row.first_delivered_at),
    webhookCount: row.webhook_count,
    webhookIgnored: row.webhook_ignored,
    acceptedLate: row.accepted_late,
  };
}
