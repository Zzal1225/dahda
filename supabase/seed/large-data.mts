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

const SMALL_RECIPIENTS = 60;
const SMALL_STATUSES = [
  "completed",
  "completed",
  "completed",
  "sending",
  "scheduled",
  "pending_approval",
  "rejected",
  "canceled",
] as const;

/**
 * 목록 화면용 발송 건. 예약·승인 대기처럼 보내기 전인 건은 메시지를 만들지 않는다.
 * 메시지가 있어도 queued를 만들지 않는 규칙은 큰 발송 건과 같다.
 * 잔액 기록은 만들지 않는다. 목록 표시용이고 측정 대상 계정의 잔액을 흔들지 않으려는 것이다.
 */
export function buildSmallCampaigns(branchIds: readonly string[]) {
  return SMALL_STATUSES.map((status, position) => {
    const id = `5eed0000-0000-4000-8000-${String(100 + position).padStart(12, "0")}`;
    const sent = status === "completed" || status === "sending";
    const messages = sent
      ? Array.from({ length: SMALL_RECIPIENTS }, (_, index) => {
          const message = seedMessage(index);
          const finalize = status === "completed" && message.status === "sent";
          return {
            ...message,
            provider_message_id: `seed-small-${position}-${index}`,
            // 완료된 건에는 확인 중인 행이 남아 있을 수 없다.
            status: finalize ? ("delivered" as const) : message.status,
            finalized_at: finalize ? message.sent_at : message.finalized_at,
          };
        })
      : [];
    const delivered = messages.filter((m) => m.status === "delivered").length;
    const failed = messages.filter((m) => m.status === "failed").length;

    return {
      id,
      // 마지막 두 건은 본사 발송이다(branch_id null).
      branch_id:
        position >= 6 ? null : (branchIds[position % branchIds.length] ?? null),
      body: `측정용 발송 건 ${position + 1}: 이번 주 행사 안내입니다`,
      kind: "sms" as const,
      is_ad: position % 2 === 0,
      status,
      rejected_reason: status === "rejected" ? "문구 수정이 필요해요" : null,
      recipient_count: SMALL_RECIPIENTS,
      estimated_cost: SMALL_RECIPIENTS * UNIT_PRICE,
      sent_count: messages.length,
      delivered_count: delivered,
      failed_count: failed,
      started_at: sent
        ? new Date(BASE_TIME_MS + position * 3_600_000).toISOString()
        : null,
      messages,
    };
  });
}
