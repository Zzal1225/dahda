"use server";

import { revalidatePath } from "next/cache";
import { UNIT_PRICE } from "@/features/campaigns/campaignSchema";
import { transitionCampaign } from "@/features/campaigns/status";
import { requireRole } from "@/server/auth/requireRole";
import { DEMO_DAILY_LIMIT, DEMO_SMS_BODY } from "@/server/providers/demo-sms";
import { createSupabaseAdminClient } from "@/server/supabase/admin";
import { demoSenderNumber } from "./demo-config";
import { demoRecipient, demoSmsSchema } from "./demo-schema";

const ALREADY_SENT =
  "이 체험에서는 이미 보냈어요. 체험 문자는 한 번만 보낼 수 있어요";

const ERRORS: Record<string, string> = {
  DH004: "체험 잔액이 부족해 보낼 수 없어요",
  DH014: "체험 계정에서만 보낼 수 있어요",
  DH015: "오늘 보낼 수 있는 체험 문자가 모두 나갔어요. 내일 다시 시도해 주세요",
  DH016: ALREADY_SENT,
  DH017: "이미 체험 문자를 받은 번호예요",
  // 두 요청이 동시에 와서 앞의 확인을 함께 통과하면 유일 제약에서 막힌다.
  "23505": ALREADY_SENT,
};

export async function sendDemoSms(
  input: unknown,
): Promise<{ campaignId: string } | { error: string }> {
  const member = await requireRole(["hq", "branch"]);
  if (!member.isTrial) return { error: "체험 계정에서만 보낼 수 있어요" };

  const sender = demoSenderNumber();
  if (!sender) return { error: "지금은 체험 문자를 보낼 수 없어요" };

  const parsed = demoSmsSchema.safeParse(input);
  const phone = parsed.success ? demoRecipient(parsed.data.phone) : null;
  if (!phone) return { error: "휴대전화 번호와 동의를 확인해 주세요" };

  const transition = transitionCampaign("draft", { type: "schedule" });
  if (!transition.ok) return { error: "보내지 못했어요" };

  const { data, error } = await createSupabaseAdminClient().rpc(
    "start_demo_send",
    {
      p_user_id: member.userId,
      p_org_id: member.orgId,
      // 생성 타입은 uuid 인자를 null 불가로 표시하지만 본사 발송은 null이다.
      p_branch_id: member.branchId as string,
      p_phone: phone,
      p_sender_phone: sender,
      p_body: DEMO_SMS_BODY,
      p_unit_price: UNIT_PRICE.sms,
      p_daily_limit: DEMO_DAILY_LIMIT,
    },
  );
  if (error || !data) {
    return { error: ERRORS[error?.code ?? ""] ?? "보내지 못했어요" };
  }

  // 상단 바의 잔액이 레이아웃에 있다.
  revalidatePath("/", "layout");
  return { campaignId: data };
}
