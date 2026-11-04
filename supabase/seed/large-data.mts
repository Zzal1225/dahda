/**
 * 10만 행 측정 데이터의 내용만 만드는 순수 함수. DB 없이 규칙을 검사할 수 있게 저장 코드와 나눴다.
 *
 * Math.random 대신 번호로 값을 정한다. 실행할 때마다 분포가 달라지면 측정 전후 수치를 비교할 수 없다.
 */

export const LARGE_MESSAGE_COUNT = 100_000;
export const UNIT_PRICE = 20;

// 시안의 샘플 코드. 실제 업체 코드가 아니다.
const FAIL_CODES = ["E301", "E302", "E410", "E503", "E201"] as const;

const BASE_TIME_MS = Date.UTC(2026, 10, 1, 0, 0, 0);

export type SeedMessage = {
  phone: string;
  recipient_name: string;
  status: "sent" | "delivered" | "failed";
  provider: "fake";
  provider_message_id: string;
  fail_code: string | null;
  attempt_count: number;
  sent_at: string;
  finalized_at: string | null;
};

/**
 * 010-0000-xxxx 형식은 1만 개뿐이고 한 발송 건 안에서 번호가 겹칠 수 없어, 가운데 자리가 0으로 시작하는
 * 형식으로 넓혔다. 이 대역이 미할당인지는 공식 자료로 확인하지 못했다. 안전은 번호 형식이 아니라
 * queued 행을 만들지 않는 것으로 보장한다.
 */
export function seedPhone(index: number): string {
  return `0100${String(index).padStart(7, "0")}`;
}

/** 표 필터를 시험할 수 있게 도착 85%, 확인 중 8%, 실패 7%로 섞는다. queued는 절대 만들지 않는다. */
export function seedStatus(index: number): SeedMessage["status"] {
  // 연속 번호가 같은 상태로 뭉치지 않게 곱해서 흩뜨린다.
  const bucket = (index * 7919) % 100;
  if (bucket < 85) return "delivered";
  if (bucket < 93) return "sent";
  return "failed";
}

export function seedMessage(index: number): SeedMessage {
  const status = seedStatus(index);
  const sentMs = BASE_TIME_MS + index * 1000;
  const isFinal = status !== "sent";

  return {
    phone: seedPhone(index),
    recipient_name: `고객${index % 5000}`,
    status,
    provider: "fake",
    provider_message_id: `seed-${index}`,
    fail_code:
      status === "failed"
        ? (FAIL_CODES[index % FAIL_CODES.length] ?? "E301")
        : null,
    attempt_count: 1,
    sent_at: new Date(sentMs).toISOString(),
    finalized_at: isFinal
      ? new Date(sentMs + 1000 + (index % 5) * 1000).toISOString()
      : null,
  };
}

export function seedCounts(total: number) {
  const counts = { sent: 0, delivered: 0, failed: 0 };
  for (let index = 0; index < total; index += 1) {
    counts[seedStatus(index)] += 1;
  }
  return counts;
}
