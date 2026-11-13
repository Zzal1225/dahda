import { z } from "zod";
import { kstDayTimeToUtc } from "@/lib/kst";
import { normalizePhone } from "@/lib/phone";
import { MAX_DIRECT_PHONES } from "./direct-phones";
import { isNightKst } from "./ad-hours";

export { isNightKst };

/**
 * 발송 폼의 규칙. 근거와 출처는 docs/decisions/2026-11-04-광고-문자-규칙과-바이트-기준.md에 있다.
 * 폼과 Server Action이 같은 스키마를 쓴다. 값을 바꾸지 않고(transform 없음) 검사만 해서,
 * 폼이 넘긴 값을 서버가 다시 검사해도 결과가 같다.
 */

export const SMS_MAX_BYTES = 90;
export const LMS_MAX_BYTES = 2_000;
export const UNIT_PRICE = { sms: 20, lms: 50 } as const;
export const MAX_SCHEDULE_DAYS = 7;

export type MessageKind = "sms" | "lms";

/**
 * 영문·숫자·공백·줄바꿈 1byte, 그 외 2byte(솔라피 문서).
 * 확인 필요: 이모지 등 EUC-KR에 없는 문자의 기준은 문서에 없다. 우선 코드 포인트당 2byte로 계산한다.
 * 문자열 길이가 아니라 코드 포인트로 세는 이유: 이모지 하나가 UTF-16으로는 두 칸이라 4byte로 잘못 센다.
 */
export function byteLength(text: string): number {
  let bytes = 0;
  for (const char of text) {
    bytes += (char.codePointAt(0) ?? 0) <= 0x7f ? 1 : 2;
  }
  return bytes;
}

export function messageKind(bytes: number): MessageKind {
  return bytes > SMS_MAX_BYTES ? "lms" : "sms";
}

/** 시행령 별표 6: 시작 부분에 (광고), 전송자 명칭, 전화번호. 업체 기준: 명칭에 대괄호 등 특수문자를 쓰지 않는다. */
export function adPrefix(senderName: string, senderPhone: string): string {
  return `(광고)${senderName.replace(/[[\]{}<>()]/g, "").trim()} ${senderPhone}`;
}

/** 시행령 별표 6: 끝나는 부분에 수신거부 번호와 비용 부담이 없다는 표시. */
export function adSuffix(optOutPhone: string): string {
  return `무료거부 ${optOutPhone}`;
}

export type AdParts = { prefix: string; suffix: string };

/** 실제로 나가는 전체 문구. 광고 표기를 빼거나 고칠 길이 없도록 본문과 분리해 여기서만 합친다. */
export function composeBody(
  body: string,
  isAd: boolean,
  parts: AdParts,
): string {
  return isAd ? `${parts.prefix}\n${body}\n${parts.suffix}` : body;
}

export type CampaignContext = AdParts & {
  /** 현재 시각. 테스트에서 고정하고, 서버는 요청 시각을 넘긴다. */
  now: () => Date;
};

export const campaignInputSchema = z.object({
  clientRequestId: z.uuid(),
  groupIds: z.array(z.uuid()),
  contactIds: z.array(z.uuid()),
  /** 직접 입력한 번호. 정규화된 값만 받는다(바꾸지 않고 확인만 한다). */
  phones: z
    .array(
      z
        .string()
        .refine(
          (value) => normalizePhone(value) === value,
          "형식이 틀린 번호가 있어요",
        ),
    )
    .max(
      MAX_DIRECT_PHONES,
      `직접 입력은 ${MAX_DIRECT_PHONES.toLocaleString("ko-KR")}개까지예요`,
    ),
  isAd: z.boolean(),
  body: z.string(),
  senderId: z.string(),
  sendMode: z.enum(["now", "scheduled"]),
  scheduledDay: z.string(),
  scheduledTime: z.string(),
});
export type CampaignInput = z.infer<typeof campaignInputSchema>;

export const NIGHT_MESSAGE =
  "광고 문자는 21:00~08:00에 보낼 수 없어요. 08:00 이후로 바꿔 주세요";

export function campaignSchema(context: CampaignContext) {
  return campaignInputSchema.superRefine((input, issue) => {
    const add = (path: keyof CampaignInput, message: string) =>
      issue.addIssue({ code: "custom", path: [path], message });

    if (
      input.groupIds.length === 0 &&
      input.contactIds.length === 0 &&
      input.phones.length === 0
    ) {
      add("groupIds", "받는 사람을 1명 이상 선택해 주세요");
    }

    if (!input.body.trim()) {
      add("body", "보낼 내용을 입력해 주세요");
    } else if (
      byteLength(composeBody(input.body, input.isAd, context)) > LMS_MAX_BYTES
    ) {
      add(
        "body",
        `${LMS_MAX_BYTES.toLocaleString("ko-KR")}byte를 넘을 수 없어요`,
      );
    }

    if (!z.uuid().safeParse(input.senderId).success) {
      add("senderId", "발신번호를 선택해 주세요");
    }

    const now = context.now();
    if (input.sendMode === "now") {
      if (input.isAd && isNightKst(now)) add("sendMode", NIGHT_MESSAGE);
      return;
    }

    const scheduled = kstDayTimeToUtc(input.scheduledDay, input.scheduledTime);
    if (!scheduled) {
      add("scheduledTime", "보낼 날짜와 시각을 선택해 주세요");
      return;
    }
    if (scheduled.getTime() <= now.getTime()) {
      add("scheduledTime", "지금보다 뒤의 시각을 선택해 주세요");
      return;
    }
    if (
      scheduled.getTime() - now.getTime() >
      MAX_SCHEDULE_DAYS * 24 * 60 * 60 * 1000
    ) {
      add("scheduledTime", `${MAX_SCHEDULE_DAYS}일 안의 시각을 선택해 주세요`);
      return;
    }
    if (input.isAd && isNightKst(scheduled)) {
      add("scheduledTime", NIGHT_MESSAGE);
    }
  });
}

/** 검사를 통과한 입력에서 저장할 값을 만든다. 화면 표시와 서버 저장이 같은 계산을 쓴다. */
export function deriveMessage(
  input: Pick<CampaignInput, "body" | "isAd">,
  parts: AdParts,
) {
  const fullBody = composeBody(input.body, input.isAd, parts);
  const bytes = byteLength(fullBody);
  const kind = messageKind(bytes);
  return { fullBody, bytes, kind, unitPrice: UNIT_PRICE[kind] };
}
