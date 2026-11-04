import type { CurrentMember } from "@/server/auth/to-current-member";

/**
 * 확인 필요: 실제 발송에 쓸 080 번호를 정하지 않았다. 솔라피 공용 번호는 전화 한 통에 최근 14일 발송 번호가
 * 모두 차단되어 step4에서 결정한다. 지금은 실제 문자가 나가지 않으므로 형식만 맞는 샘플 값이다.
 */
const SAMPLE_OPT_OUT_PHONE = "080-000-0000";

export function optOutPhone(): string {
  return process.env.SMS_OPT_OUT_PHONE || SAMPLE_OPT_OUT_PHONE;
}

/** 광고 앞부분의 전송자 명칭. 지점은 "브랜드 지점명"으로, 본사는 브랜드로 쓴다. */
export function senderNameOf(
  member: Pick<CurrentMember, "orgName" | "branchName">,
): string {
  const brand = member.orgName.replace(/\s*본사$/, "");
  return member.branchName ? `${brand} ${member.branchName}` : brand;
}
