"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { formatPhone } from "@/lib/format";
import { kstDayTimeToUtc } from "@/lib/kst";
import { requireRole } from "@/server/auth/requireRole";
import type { CurrentMember } from "@/server/auth/current-member";
import { createSupabaseAdminClient } from "@/server/supabase/admin";
import { createSupabaseServerClient } from "@/server/supabase/server";
import {
  adPrefix,
  adSuffix,
  campaignSchema,
  deriveMessage,
} from "./campaignSchema";
import { optOutPhone, senderNameOf } from "./compose-config";
import { resolveRecipients } from "./recipients";
import { submitEventType, transitionCampaign } from "./status";

const selectionSchema = z.object({
  groupIds: z.array(z.uuid()).max(200),
  contactIds: z.array(z.uuid()).max(5_000),
});

export type RecipientSummary = {
  total: number;
  optedOut: number;
  duplicates: number;
  noConsent: number;
};

/** 화면의 "총 n명 · 수신거부 n명 · 미동의 n명 제외" 요약. 저장과 같은 계산을 써서 숫자가 어긋나지 않게 한다. */
export async function previewRecipients(
  input: unknown,
): Promise<RecipientSummary | { error: string }> {
  await requireRole(["hq", "branch"]);
  const parsed = selectionSchema
    .extend({ isAd: z.boolean().default(false) })
    .safeParse(input);
  if (!parsed.success) return { error: "받는 사람을 확인해 주세요" };

  const supabase = await createSupabaseServerClient();
  const { recipients, optedOut, duplicates, noConsent } =
    await resolveRecipients(
      supabase,
      parsed.data.groupIds,
      parsed.data.contactIds,
      { isAd: parsed.data.isAd },
    );
  return { total: recipients.length, optedOut, duplicates, noConsent };
}

export type ContactOption = {
  id: string;
  phone: string;
  name: string | null;
  optedOut: boolean;
};

export async function searchContactOptions(
  query: unknown,
): Promise<ContactOption[]> {
  await requireRole(["hq", "branch"]);
  const text = z.string().trim().max(50).catch("").parse(query);
  const supabase = await createSupabaseServerClient();

  let request = supabase.from("contacts").select("id, phone, name");
  const digits = text.replace(/[\s-]/g, "");
  if (/^[0-9]+$/.test(digits)) {
    request = request.like("phone", `${digits}%`);
  } else if (text) {
    request = request.ilike(
      "name",
      `%${text.replace(/[\\%_]/g, (match) => `\\${match}`)}%`,
    );
  }
  const { data, error } = await request.order("phone").limit(50);
  if (error) throw new Error(`연락처 조회 실패: ${error.message}`);

  const optOuts = data.length
    ? await supabase
        .from("opt_outs")
        .select("phone")
        .in(
          "phone",
          data.map((row) => row.phone),
        )
    : { data: [], error: null };
  if (optOuts.error) throw new Error("수신거부 조회 실패");
  const optedOut = new Set(optOuts.data.map((row) => row.phone));

  return data.map((row) => ({ ...row, optedOut: optedOut.has(row.phone) }));
}

const SUBMIT_ERRORS: Record<string, string> = {
  DH004: "잔액이 부족해요",
  DH008: "보낼 수 있는 받는 사람이 없어요",
};

async function loadSender(member: CurrentMember, senderId: string) {
  // 사용자 권한으로 읽어, 다른 지점의 발신번호 id를 넘기면 찾지 못하게 한다.
  const supabase = await createSupabaseServerClient();
  let request = supabase
    .from("sender_numbers")
    .select("number")
    .eq("id", senderId);
  // 본사는 RLS상 전 지점 번호가 보이므로 자기 계정 번호로 좁힌다.
  request = member.branchId
    ? request.eq("branch_id", member.branchId)
    : request.is("branch_id", null);
  const { data } = await request.maybeSingle();
  return data?.number ?? null;
}

/**
 * 문자 접수. 입력 검증과 권한은 여기서, 저장의 원자성은 DB 함수에서 맡는다.
 * 발송 건·메시지·거래 기록은 사용자에게 쓰기 권한이 없어 admin 클라이언트로 함수를 부른다.
 */
export async function submitCampaign(
  input: unknown,
): Promise<{ campaignId: string } | { error: string }> {
  const member = await requireRole(["hq", "branch"]);

  const raw = selectionSchema.passthrough().safeParse(input);
  const senderId =
    raw.success && typeof raw.data.senderId === "string"
      ? raw.data.senderId
      : "";
  const senderPhone = z.uuid().safeParse(senderId).success
    ? await loadSender(member, senderId)
    : null;
  if (!senderPhone) return { error: "발신번호를 확인해 주세요" };

  const parts = {
    prefix: adPrefix(senderNameOf(member), formatPhone(senderPhone)),
    suffix: adSuffix(optOutPhone()),
  };
  // 현재 시각을 서버 값으로 다시 검사한다. 화면을 오래 열어 둔 사이 야간이 되었을 수 있다.
  const parsed = campaignSchema({ ...parts, now: () => new Date() }).safeParse(
    input,
  );
  if (!parsed.success) {
    return {
      error: parsed.error.issues[0]?.message ?? "입력한 내용을 확인해 주세요",
    };
  }
  const values = parsed.data;

  const supabase = await createSupabaseServerClient();
  const { recipients } = await resolveRecipients(
    supabase,
    values.groupIds,
    values.contactIds,
    { isAd: values.isAd },
  );
  if (recipients.length === 0) {
    return { error: "보낼 수 있는 받는 사람이 없어요" };
  }

  // 전이 규칙은 status.ts 한 곳에서 정한다.
  const transition = transitionCampaign("draft", {
    type: submitEventType({ isAd: values.isAd, authorRole: member.role }),
  });
  if (!transition.ok) return { error: "접수하지 못했어요" };

  const { fullBody, kind, unitPrice } = deriveMessage(values, parts);
  const scheduledAt =
    values.sendMode === "scheduled"
      ? kstDayTimeToUtc(values.scheduledDay, values.scheduledTime)
      : null;

  const { data, error } = await createSupabaseAdminClient().rpc(
    "submit_campaign",
    {
      p_client_request_id: values.clientRequestId,
      p_org_id: member.orgId,
      // 생성 타입은 uuid 인자를 null 불가로 표시하지만 본사 발송은 null이다.
      p_branch_id: member.branchId as string,
      p_created_by: member.userId,
      p_body: fullBody,
      p_kind: kind,
      p_is_ad: values.isAd,
      p_sender_phone: senderPhone,
      p_status: transition.status,
      // null을 명시한다. undefined면 인자가 빠져 함수를 찾지 못한다(지금 보내기가 전부 실패하던 버그).
      p_scheduled_at: (scheduledAt?.toISOString() ?? null) as string,
      p_unit_price: unitPrice,
      p_recipients: recipients,
    },
  );
  if (error) {
    return { error: SUBMIT_ERRORS[error.code] ?? "접수하지 못했어요" };
  }
  // 요청 키가 다른 본사의 발송 건과 겹치면 함수가 찾지 못해 null을 돌려준다.
  if (!data) return { error: "접수하지 못했어요" };

  // 상단 바의 잔액이 레이아웃에 있어 레이아웃까지 다시 그린다. 안 하면 차감 전 금액이 그대로 보인다.
  revalidatePath("/", "layout");
  return { campaignId: data };
}
