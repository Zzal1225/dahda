"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { HOPELESS_FAIL_CODES } from "@/features/messages/message-view";
import { requireRole } from "@/server/auth/requireRole";
import { createSupabaseAdminClient } from "@/server/supabase/admin";
import { createSupabaseServerClient } from "@/server/supabase/server";
import { isNightKst, NIGHT_MESSAGE } from "./campaignSchema";
import { transitionCampaign } from "./status";

export type RetryPreview = {
  /** 선택한 행 중 실패한 건 */
  failed: number;
  /** 실제로 다시 보낼 건. 수신거부와 이미 재발송한 번호가 빠진다. */
  target: number;
  /** 다시 보내도 실패할 가능성이 높은 건 */
  hopeless: number;
  unitPrice: number;
  kind: "sms" | "lms";
  amount: number;
  balance: number;
};

const inputSchema = z.object({
  sourceId: z.uuid(),
  messageIds: z.array(z.number().int().positive()).min(1).max(100_000),
});

const ERRORS: Record<string, string> = {
  DH004: "잔액이 부족해요. 충전한 뒤 다시 보내 주세요",
  DH008: "다시 보낼 수 있는 건이 없어요",
  DH013: "다시 보낼 수 없는 상태예요",
};

/** 사용자 권한으로 읽는다. 지점 사용자는 옆 지점의 발송 건을 찾지 못하므로 여기서 막힌다. */
async function loadSource(id: string) {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("campaigns")
    .select("id, is_ad")
    .eq("id", id)
    .maybeSingle();
  return data;
}

export async function previewRetry(
  sourceId: unknown,
  messageIds: unknown,
): Promise<RetryPreview | null> {
  const member = await requireRole(["hq", "branch"]);
  const parsed = inputSchema.safeParse({ sourceId, messageIds });
  if (!parsed.success) return null;
  if (!(await loadSource(parsed.data.sourceId))) return null;

  const { data, error } = await createSupabaseAdminClient().rpc(
    "preview_retry",
    {
      p_source_id: parsed.data.sourceId,
      p_org_id: member.orgId,
      p_message_ids: parsed.data.messageIds,
      p_hopeless_codes: [...HOPELESS_FAIL_CODES],
    },
  );
  const row = data?.[0];
  if (error || !row) return null;
  return {
    failed: row.failed_count,
    target: row.target_count,
    hopeless: row.hopeless_count,
    unitPrice: row.unit_price,
    kind: row.kind,
    amount: row.target_count * row.unit_price,
    balance: row.balance,
  };
}

export async function retryFailedMessages(
  sourceId: unknown,
  messageIds: unknown,
): Promise<{ campaignId: string } | { error: string }> {
  const member = await requireRole(["hq", "branch"]);
  const parsed = inputSchema.safeParse({ sourceId, messageIds });
  if (!parsed.success) return { error: "다시 보낼 건을 선택해 주세요" };

  const source = await loadSource(parsed.data.sourceId);
  if (!source) return { error: "발송 건을 찾지 못했어요" };

  // 재발송은 바로 나간다. 워커도 야간 광고를 미루지만, 그러면 "보냈다"고 한 문자가 아침까지 안 나가므로 먼저 알린다.
  if (source.is_ad && isNightKst(new Date())) return { error: NIGHT_MESSAGE };

  const transition = transitionCampaign("draft", { type: "schedule" });
  if (!transition.ok) return { error: "다시 보내지 못했어요" };

  const { data, error } = await createSupabaseAdminClient().rpc(
    "retry_failed_messages",
    {
      p_source_id: parsed.data.sourceId,
      p_org_id: member.orgId,
      p_created_by: member.userId,
      p_message_ids: parsed.data.messageIds,
    },
  );
  if (error || !data) {
    return { error: ERRORS[error?.code ?? ""] ?? "다시 보내지 못했어요" };
  }

  // 상단 바의 잔액이 레이아웃에 있다.
  revalidatePath("/", "layout");
  return { campaignId: data };
}
