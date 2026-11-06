import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/server/db/database.types";

export const RECENT_MESSAGE_LIMIT = 3;

export type RecentMessage = {
  id: number;
  status: Database["public"]["Enums"]["message_status"];
  /** 업체가 접수한 시각. 아직 대기면 null. */
  sentAt: string | null;
  createdAt: string;
  campaignId: string;
  body: string;
  isAd: boolean;
};

/**
 * 연락처 번호로 받은 문자 최근 3건. 사용자 권한 클라이언트로 읽어 RLS가 범위를 정한다.
 * 지점 담당자는 자기 지점 발송만, 본사는 본사·전 지점 발송을 본다. 볼 수 없는 연락처 id면 null이다.
 *
 * 메시지에 연락처 id가 없고 번호로 잇는다. 발송 때 번호를 복사해 두는 구조라(주소록을 고쳐도 지난 발송은 그대로),
 * "이 사람이 받은 문자"는 지금 번호 기준이다. 번호를 바꾸면 이전 번호로 받은 문자는 보이지 않는다.
 */
export async function loadRecentMessages(
  supabase: SupabaseClient<Database>,
  contactId: string,
): Promise<RecentMessage[] | null> {
  const contact = await supabase
    .from("contacts")
    .select("phone")
    .eq("id", contactId)
    .maybeSingle();
  if (contact.error) {
    throw new Error(`연락처 조회 실패: ${contact.error.message}`);
  }
  if (!contact.data) return null;

  const { data, error } = await supabase
    .from("messages")
    .select(
      "id, status, sent_at, created_at, campaign_id, campaigns(body, is_ad)",
    )
    .eq("phone", contact.data.phone)
    // 예약 대기 건은 sent_at이 없다. 보낸 순서가 먼저이고, 같으면 만든 순서다.
    .order("sent_at", { ascending: false, nullsFirst: true })
    .order("created_at", { ascending: false })
    .limit(RECENT_MESSAGE_LIMIT);
  if (error) throw new Error(`받은 문자 조회 실패: ${error.message}`);

  return data.map((row) => ({
    id: row.id,
    status: row.status,
    sentAt: row.sent_at,
    createdAt: row.created_at,
    campaignId: row.campaign_id,
    body: row.campaigns?.body ?? "",
    isAd: row.campaigns?.is_ad ?? false,
  }));
}
