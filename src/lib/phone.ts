/**
 * 전화번호를 숫자만 남겨 정규화한다. 형식이 맞지 않으면 null이다.
 * 주소록·수신거부·엑셀 업로드가 모두 이 함수를 써야 같은 번호가 다른 값으로 저장되지 않는다.
 * 같은 번호가 하이픈 유무로 달라지면 수신거부 제외가 빠져 법 위반으로 이어질 수 있다.
 *
 * 형식만 본다. 실제로 개통된 번호인지는 알 수 없고, 그것은 발송 결과로 드러난다.
 */
const PATTERNS = [
  /^010[0-9]{8}$/, // 휴대전화 010은 11자리뿐이다
  /^01[16789][0-9]{7,8}$/, // 옛 휴대전화 번호
  /^02[0-9]{7,8}$/, // 서울
  /^0[3-6][0-9]{8,9}$/, // 지역번호, 인터넷전화(070은 아래)
  /^070[0-9]{8}$/, // 인터넷전화
  /^080[0-9]{7}$/, // 무료전화
  /^1[5-9][0-9]{6}$/, // 대표번호 1588-0000 형식
];

export function normalizePhone(input: string): string | null {
  // 엑셀에서 흔한 구분 문자만 허용한다. 글자가 섞인 값을 지워서 통과시키면 다른 번호가 될 수 있다.
  if (!/^[+0-9\s().-]+$/.test(input.trim())) return null;

  let digits = input.replace(/[^0-9]/g, "");
  // 국가번호: +82 10... → 010...
  if (input.trim().startsWith("+")) {
    if (!digits.startsWith("82")) return null;
    digits = `0${digits.slice(2).replace(/^0/, "")}`;
  }

  return PATTERNS.some((pattern) => pattern.test(digits)) ? digits : null;
}
