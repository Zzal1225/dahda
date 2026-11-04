"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireRole } from "@/server/auth/requireRole";
import { createSupabaseAdminClient } from "@/server/supabase/admin";
import { createSupabaseServerClient } from "@/server/supabase/server";
import { isNightKst, NIGHT_MESSAGE } from "./campaignSchema";
import { transitionCampaign } from "./status";

export type ActionResult = { error: string } | undefined;

const idSchema = z.uuid();
const reasonSchema = z.string().trim().min(1).max(200);

const ERRORS: Record<string, string> = {
  DH004: "지점 잔액이 부족해요",
  DH009: "이미 처리된 요청이에요",
  DH010: "취소할 수 없는 상태예요",
  DH011: "승인된 문자는 취소할 수 없어요",
  DH012: "이미 발송 시각이 지났어요",
};

async function loadCampaign(id: string) {
  // 사용자 권한으로 읽어 다른 본사의 발송 건을 찾지 못하게 한다.
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("campaigns")
    .select("status, is_ad, scheduled_at, reviewed_at")
    .eq("id", id)
    .maybeSingle();
  return data;
}

function refresh() {
  // 사이드바 대기 건수와 상단 바 잔액이 레이아웃에 있어 레이아웃까지 다시 그린다.
  revalidatePath("/", "layout");
}

export async function approveCampaign(id: unknown): Promise<ActionResult> {
  const member = await requireRole(["hq"]);
  const parsed = idSchema.safeParse(id);
  if (!parsed.success) return { error: "요청을 찾지 못했어요" };

  const campaign = await loadCampaign(parsed.data);
  if (!campaign) return { error: "요청을 찾지 못했어요" };

  const transition = transitionCampaign(campaign.status, { type: "approve" });
  if (!transition.ok) return { error: "이미 처리된 요청이에요" };

  // 승인 시각에 다시 본다. 요청은 낮이었어도 승인이 밤이면 바로 나가는 광고가 야간 전송이 된다.
  const now = new Date();
  const scheduled = campaign.scheduled_at
    ? new Date(campaign.scheduled_at)
    : null;
  const sendAt = scheduled && scheduled > now ? scheduled : now;
  if (campaign.is_ad && isNightKst(sendAt)) return { error: NIGHT_MESSAGE };

  const { error } = await createSupabaseAdminClient().rpc("approve_campaign", {
    p_campaign_id: parsed.data,
    p_org_id: member.orgId,
    p_reviewer: member.userId,
  });
  if (error) return { error: ERRORS[error.code] ?? "승인하지 못했어요" };
  refresh();
}

export async function rejectCampaign(
  id: unknown,
  reason: unknown,
): Promise<ActionResult> {
  const member = await requireRole(["hq"]);
  const parsedId = idSchema.safeParse(id);
  const parsedReason = reasonSchema.safeParse(reason);
  if (!parsedId.success) return { error: "요청을 찾지 못했어요" };
  if (!parsedReason.success) return { error: "반려 사유를 입력해 주세요" };

  const campaign = await loadCampaign(parsedId.data);
  if (!campaign) return { error: "요청을 찾지 못했어요" };

  const transition = transitionCampaign(campaign.status, {
    type: "reject",
    reason: parsedReason.data,
  });
  if (!transition.ok) return { error: "이미 처리된 요청이에요" };

  const { error } = await createSupabaseAdminClient().rpc("reject_campaign", {
    p_campaign_id: parsedId.data,
    p_org_id: member.orgId,
    p_reviewer: member.userId,
    p_reason: parsedReason.data,
  });
  if (error) return { error: ERRORS[error.code] ?? "반려하지 못했어요" };
  refresh();
}

export async function cancelCampaign(id: unknown): Promise<ActionResult> {
  const member = await requireRole(["hq", "branch"]);
  const parsed = idSchema.safeParse(id);
  if (!parsed.success) return { error: "발송 건을 찾지 못했어요" };

  const campaign = await loadCampaign(parsed.data);
  if (!campaign) return { error: "발송 건을 찾지 못했어요" };

  const transition = transitionCampaign(campaign.status, {
    type: "cancel",
    approved: campaign.reviewed_at !== null,
  });
  if (!transition.ok) {
    return {
      error:
        transition.error === "approved_cannot_cancel"
          ? "승인된 문자는 취소할 수 없어요"
          : "취소할 수 없는 상태예요",
    };
  }

  // 계정은 입력이 아니라 세션에서 정한다. 본사도 지점의 예약을 대신 취소하지 못한다.
  const { error } = await createSupabaseAdminClient().rpc("cancel_campaign", {
    p_campaign_id: parsed.data,
    p_org_id: member.orgId,
    // 생성 타입은 uuid 인자를 null 불가로 표시하지만 본사 계정은 null이다.
    p_branch_id: member.branchId as string,
  });
  if (error) return { error: ERRORS[error.code] ?? "취소하지 못했어요" };
  refresh();
}
