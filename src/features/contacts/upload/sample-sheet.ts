/**
 * 체험용 업로드 샘플(1만 행). 결과 요약의 네 숫자(추가·중복·형식 오류·수신거부 제외)가 모두 0이 아니게 섞는다.
 * 번호는 주소록 샘플과 같은 안전 대역(0100 다음 자리 1~9)이다. 실제로 쓰는 번호가 아니다.
 *
 * 순수 함수로 두어 서버 경로와 테스트가 같은 내용을 만든다. 난수는 주입받는다(테스트는 고정 값).
 */
export const SAMPLE_ROWS = 10_000;

const SURNAMES = [
  "김",
  "이",
  "박",
  "최",
  "정",
  "강",
  "조",
  "윤",
  "장",
  "임",
  "한",
  "오",
  "서",
  "신",
  "권",
  "황",
];
const GIVEN = [
  "민준",
  "서연",
  "도윤",
  "하은",
  "지호",
  "수아",
  "예준",
  "지유",
  "시우",
  "서윤",
  "영숙",
  "미경",
  "경수",
  "상철",
  "은정",
  "성민",
];
const GROUPS = ["단골", "신규", "과일 행사", "배달 고객", "주말 장보기"];
const MEMOS = [
  "주말 오전 배송 선호",
  "전화보다 문자 선호",
  "대량 구매 고객",
  "현관 비밀번호 문자로 받음",
];
const BAD_PHONES = ["010-12-345", "없음", "02-", "0101234", "010-abcd-5678"];

export type SampleOptions = {
  /** 이미 그 본사 주소록에 있는 번호. 일부를 넣어 "중복"을 만든다. */
  existingPhones: readonly string[];
  /** 수신거부 번호. 일부를 넣어 "수신거부 제외"를 만든다. */
  optOutPhones: readonly string[];
  random?: () => number;
};

const pick = <T>(list: readonly T[], random: () => number): T =>
  list[Math.floor(random() * list.length)] as T;

const hyphen = (digits: string) =>
  `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`;

export function buildSampleRows({
  existingPhones,
  optOutPhones,
  random = Math.random,
}: SampleOptions): string[][] {
  const header = ["이름", "전화번호", "그룹", "메모", "수신동의"];
  const rows: string[][] = [];
  const used = new Set<string>();

  const newPhone = () => {
    for (;;) {
      const digits = `0100${1_000_000 + Math.floor(random() * 9_000_000)}`;
      if (!used.has(digits)) {
        used.add(digits);
        return digits;
      }
    }
  };
  const person = (phone: string): string[] => {
    const groupRoll = random();
    const groups =
      groupRoll < 0.3
        ? ""
        : groupRoll < 0.85
          ? pick(GROUPS, random)
          : `${pick(GROUPS, random)}, ${pick(GROUPS, random)}`;
    return [
      pick(SURNAMES, random) + pick(GIVEN, random),
      phone,
      groups,
      random() < 0.1 ? pick(MEMOS, random) : "",
      random() < 0.92 ? "Y" : "N",
    ];
  };

  // 섞을 특수 행: 기존 번호 최대 50, 수신거부 최대 30, 형식 오류 100, 파일 안 중복 80.
  const special: string[][] = [
    ...existingPhones.slice(0, 50).map((phone) => person(hyphen(phone))),
    ...optOutPhones.slice(0, 30).map((phone) => person(hyphen(phone))),
    ...Array.from({ length: 100 }, () => person(pick(BAD_PHONES, random))),
  ];
  const duplicates = 80;
  const regular = SAMPLE_ROWS - special.length - duplicates;
  for (let index = 0; index < regular; index += 1) {
    rows.push(person(hyphen(newPhone())));
  }
  for (let index = 0; index < duplicates; index += 1) {
    const source = rows[Math.floor(random() * Math.min(rows.length, 2_000))];
    if (source) rows.push(person(source[1] ?? ""));
  }
  // 특수 행을 고르게 흩는다. 앞에 몰리면 미리보기 5행이 오류만 보인다. 첫 5행은 정상 행으로 남긴다.
  for (const row of special) {
    const at = 5 + Math.floor(random() * (rows.length - 5));
    rows.splice(at, 0, row);
  }
  return [header, ...rows];
}
