import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  MessageEventKind,
  MessageEventOutcome,
  MessageEventSource,
} from "@/server/queue/event-log";
import type { Database } from "@/server/db/database.types";
import type { MessageEventRow } from "./message-events-view";

/** 한 메시지의 기록은 많아야 재시도 5번 + 결과·중복 몇 줄이다. 상한은 비정상 데이터가 화면을 막지 않게 하는 안전장치다. */
const EVENT_LIMIT = 50;

/**
 * 사용자 권한 클라이언트를 받는다. 다른 지점 메시지 id를 넣어도 RLS가 빈 배열을 돌려준다.
 * DB 열은 text + check 제약이라 생성 타입이 string이다. 값 목록은 마이그레이션의 check와 같다.
 */
export async function listMessageEvents(
  supabase: SupabaseClient<Database>,
  messageId: number,
): Promise<MessageEventRow[]> {
  const { data, error } = await supabase
    .from("message_events")
    .select("id, source, kind, outcome, fail_code, occurred_at, received_at")
    .eq("message_id", messageId)
    .order("received_at")
    .order("id")
    .limit(EVENT_LIMIT);
  if (error) throw new Error(`메시지 기록 조회 실패: ${error.message}`);
  return data.map((row) => ({
    id: row.id,
    source: row.source as MessageEventSource,
    kind: row.kind as MessageEventKind,
    outcome: row.outcome as MessageEventOutcome,
    failCode: row.fail_code,
    occurredAt: row.occurred_at,
    receivedAt: row.received_at,
  }));
}
