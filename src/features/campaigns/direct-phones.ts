import { normalizePhone } from "@/lib/phone";

/**
 * 문자 작성의 "직접 입력". 붙여 넣은 글을 번호 목록으로 바꾼다.
 *
 * 공백으로는 나누지 않는다. "010 1234 5678"처럼 띄어 쓴 번호가 세 조각으로 갈라져 모두 형식 오류가 된다.
 * 엑셀 한 열을 복사하면 줄바꿈, 한 줄로 적으면 쉼표가 구분자라 이 둘(+ 세미콜론·탭)만 쓴다.
 *
 * 수신거부·광고 동의는 여기서 보지 않는다. 그 판단은 서버의 resolveRecipients 하나가 맡아야
 * 그룹·주소록·직접 입력이 같은 규칙으로 걸러진다.
 */

/** 한 발송 건에 직접 넣을 수 있는 번호 수. 더 많으면 엑셀 업로드로 주소록에 넣고 그룹으로 보내는 편이 맞다. */
export const MAX_DIRECT_PHONES = 1_000;

export type DirectPhoneResult = {
  /** 새로 넣을 번호(정규화, 입력 순서 유지). */
  added: string[];
  /** 형식이 틀린 조각. 입력창에 남겨 고치게 한다. */
  invalid: string[];
  /** 이미 넣었거나 이번 입력 안에서 겹친 번호 수. */
  duplicates: number;
  /** 상한을 넘어 넣지 못한 번호 수. */
  overLimit: number;
};

export function parseDirectPhones(
  text: string,
  existing: readonly string[],
): DirectPhoneResult {
  const seen = new Set(existing);
  const added: string[] = [];
  const invalid: string[] = [];
  let duplicates = 0;
  let overLimit = 0;

  for (const raw of text.split(/[\n\r,;\t]+/)) {
    const token = raw.trim();
    if (!token) continue;
    const phone = normalizePhone(token);
    if (!phone) {
      invalid.push(token);
      continue;
    }
    if (seen.has(phone)) {
      duplicates += 1;
      continue;
    }
    if (seen.size >= MAX_DIRECT_PHONES) {
      overLimit += 1;
      continue;
    }
    seen.add(phone);
    added.push(phone);
  }
  return { added, invalid, duplicates, overLimit };
}

/** 결과를 한 줄 안내로. 틀린 번호는 입력창에 남으니 몇 개인지만 말한다. */
export function directPhoneMessage(result: DirectPhoneResult): string {
  const parts = [`${result.added.length.toLocaleString("ko-KR")}개 추가`];
  if (result.duplicates > 0) {
    parts.push(`중복 ${result.duplicates.toLocaleString("ko-KR")}개 제외`);
  }
  if (result.invalid.length > 0) {
    parts.push(
      `형식이 틀린 ${result.invalid.length.toLocaleString("ko-KR")}개는 입력창에 남겼어요`,
    );
  }
  if (result.overLimit > 0) {
    parts.push(
      `${MAX_DIRECT_PHONES.toLocaleString("ko-KR")}개를 넘는 ${result.overLimit.toLocaleString("ko-KR")}개는 넣지 못했어요`,
    );
  }
  return parts.join(" · ");
}
