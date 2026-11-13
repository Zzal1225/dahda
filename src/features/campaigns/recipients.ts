import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/server/db/database.types";

export type Recipient = { phone: string; name: string | null };
type PickedContact = Recipient & { consent_at: string | null };

export type ResolvedRecipients = {
  recipients: Recipient[];
  optedOut: number;
  duplicates: number;
  /** 광고일 때만 센다. 일반 문자는 동의가 필요하지 않아 항상 0이다. */
  noConsent: number;
};

const PAGE = 1_000;
const IN_CHUNK = 300;

type Client = SupabaseClient<Database>;

async function readAll<T>(
  fetchPage: (
    from: number,
    to: number,
  ) => PromiseLike<{
    data: T[] | null;
    error: { message: string } | null;
  }>,
): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await fetchPage(from, from + PAGE - 1);
    if (error) throw new Error(`수신자 조회 실패: ${error.message}`);
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE) return rows;
  }
}

/**
 * 그룹·주소록 선택·직접 입력을 실제 수신자로 바꾼다. 사용자 권한 클라이언트를 받아, 범위 밖의 id는 RLS가 빈 결과로 만든다.
 * phones는 정규화된 번호다(campaignSchema가 확인). 직접 입력도 여기서 함께 걸러야 수신거부·동의 규칙이 한 곳에 남는다.
 */
export async function resolveRecipients(
  supabase: Client,
  groupIds: readonly string[],
  contactIds: readonly string[],
  options: { isAd: boolean },
  phones: readonly string[] = [],
): Promise<ResolvedRecipients> {
  const picked: PickedContact[] = [];

  if (groupIds.length > 0) {
    const rows = await readAll((from, to) =>
      supabase
        .from("contact_group_members")
        .select("contact_id, contacts(phone, name, consent_at)")
        .in("group_id", [...groupIds])
        .order("contact_id")
        .order("group_id")
        .range(from, to),
    );
    for (const row of rows) {
      if (row.contacts) picked.push(row.contacts);
    }
  }

  for (let start = 0; start < contactIds.length; start += IN_CHUNK) {
    const { data, error } = await supabase
      .from("contacts")
      .select("phone, name, consent_at")
      .in("id", contactIds.slice(start, start + IN_CHUNK));
    if (error) throw new Error(`수신자 조회 실패: ${error.message}`);
    picked.push(...data);
  }

  // 직접 입력한 번호가 볼 수 있는 주소록에 있으면 그 행(이름·동의)을 쓴다.
  // 주소록에 없는 번호는 동의 기록이 없으므로 광고에서 빠진다. 붙여 넣은 번호의 동의를 화면 말로 믿을 수 없다.
  for (let start = 0; start < phones.length; start += IN_CHUNK) {
    const chunk = phones.slice(start, start + IN_CHUNK);
    const { data, error } = await supabase
      .from("contacts")
      .select("phone, name, consent_at")
      .in("phone", chunk);
    if (error) throw new Error(`수신자 조회 실패: ${error.message}`);
    const known = new Set(data.map((row) => row.phone));
    picked.push(...data);
    for (const phone of chunk) {
      if (!known.has(phone))
        picked.push({ phone, name: null, consent_at: null });
    }
  }

  const optOuts = await readAll((from, to) =>
    supabase.from("opt_outs").select("phone").order("id").range(from, to),
  );
  const optedOutPhones = new Set(optOuts.map((row) => row.phone));

  // 같은 번호가 여러 지점에 있으면 동의도 각각이다. 하나라도 없으면 제외한다.
  // 한 지점에 한 동의를 다른 지점의 광고에 쓰면 동의 없는 발송이 될 수 있어 좁은 쪽을 택한다.
  const missingConsent = new Set(
    picked.filter((row) => !row.consent_at).map((row) => row.phone),
  );

  // 여러 그룹이나 지점에 같은 번호가 있어도 한 번만 보낸다. 두 번 보내면 두 번 차감된다.
  const seen = new Set<string>();
  const recipients: Recipient[] = [];
  let optedOut = 0;
  let duplicates = 0;
  let noConsent = 0;
  for (const { phone, name } of picked) {
    const recipient = { phone, name };
    if (seen.has(recipient.phone)) {
      duplicates += 1;
      continue;
    }
    seen.add(recipient.phone);
    // 법 제50조 제2항: 수신거부한 사람에게 보내면 안 된다.
    if (optedOutPhones.has(recipient.phone)) {
      optedOut += 1;
      continue;
    }
    // 법 제50조 제1항: 광고는 사전 동의를 받은 사람에게만 보낸다. 일반 문자에는 적용하지 않는다.
    if (options.isAd && missingConsent.has(recipient.phone)) {
      noConsent += 1;
      continue;
    }
    recipients.push(recipient);
  }
  return { recipients, optedOut, duplicates, noConsent };
}
