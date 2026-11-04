import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Database } from "@/server/db/database.types";

export const MESSAGE_STATUSES = [
  "queued",
  "sent",
  "delivered",
  "failed",
] as const;

// URL에서 온 값을 그대로 DB에 넘기지 않으려고 허용 값을 제한한다.
// limit 상한은 Supabase의 기본 응답 상한과 같게 두어, 더 달라고 해도 조용히 잘리는 일을 없앤다.
export const messageQuerySchema = z.object({
  campaignId: z.uuid(),
  status: z.array(z.enum(MESSAGE_STATUSES)).default([]),
  q: z
    .string()
    .trim()
    .regex(/^[0-9]*$/, "수신번호는 숫자로 검색해 주세요")
    .max(15)
    .default(""),
  offset: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(1000).default(100),
  withTotal: z.coerce.boolean().default(false),
  sort: z.enum(["sent_at", "finalized_at"]).default("sent_at"),
  desc: z.boolean().default(true),
});
export type MessageQuery = z.infer<typeof messageQuerySchema>;

export type MessageRow = {
  id: number;
  phone: string;
  recipientName: string | null;
  status: (typeof MESSAGE_STATUSES)[number];
  sentAt: string | null;
  finalizedAt: string | null;
  failCode: string | null;
  attemptCount: number;
};

export type MessagePage = { rows: MessageRow[]; total: number | null };

/**
 * 클라이언트를 인자로 받는다. 호출자가 사용자 권한 클라이언트를 넘겨 RLS가 범위를 정하게 한다.
 * 정렬에 id를 함께 쓰는 이유: 같은 시각의 행은 순서가 정해지지 않아 페이지를 넘길 때 행이 겹치거나 빠질 수 있다.
 * 아직 시각이 없는 행은 항상 뒤로 보낸다. 정렬 인덱스는 측정 결과 필요하지 않아 두지 않았다(docs/performance.md).
 */
export async function listMessages(
  supabase: SupabaseClient<Database>,
  query: MessageQuery,
): Promise<MessagePage> {
  let request = supabase
    .from("messages")
    .select(
      "id, phone, recipient_name, status, sent_at, finalized_at, fail_code, attempt_count",
      // 전체 건수는 비싸므로 필요할 때만 센다.
      query.withTotal ? { count: "exact" } : {},
    )
    .eq("campaign_id", query.campaignId);

  if (query.status.length > 0) request = request.in("status", query.status);
  // 앞부분 일치만 지원한다. 부분 일치는 인덱스를 쓰기 어렵고, 번호 검색은 보통 앞에서부터 입력한다.
  if (query.q) request = request.like("phone", `${query.q}%`);

  const { data, error, count } = await request
    .order(query.sort, { ascending: !query.desc, nullsFirst: false })
    .order("id")
    .range(query.offset, query.offset + query.limit - 1);

  if (error) throw new Error(`메시지 조회 실패: ${error.message}`);

  return {
    rows: data.map((row) => ({
      id: row.id,
      phone: row.phone,
      recipientName: row.recipient_name,
      status: row.status,
      sentAt: row.sent_at,
      finalizedAt: row.finalized_at,
      failCode: row.fail_code,
      attemptCount: row.attempt_count,
    })),
    total: count,
  };
}
