"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireRole } from "@/server/auth/requireRole";
import { createSupabaseServerClient } from "@/server/supabase/server";
import { phoneField } from "../contact-schema";

// Server Action 요청 크기 제한(기본 1MB) 안에 들어오도록 나눠 보낸다. 값은 클라이언트와 함께 쓴다.
const MAX_CHECK_PHONES = 2_000;
const MAX_SAVE_ROWS = 500;
// `.in()`은 주소에 번호를 다 적어 보낸다. 길이 제한을 넘지 않게 나눈다.
const IN_CHUNK = 300;

const phonesSchema = z.array(phoneField).max(MAX_CHECK_PHONES);

export type UploadCheck = { existing: string[]; optedOut: string[] };

/** 이미 주소록에 있는 번호와 수신거부 번호를 찾는다. 사용자 권한으로 읽어 RLS가 범위를 정한다. */
export async function checkUploadPhones(
  phones: unknown,
): Promise<UploadCheck | { error: string }> {
  await requireRole(["branch"]);
  const parsed = phonesSchema.safeParse(phones);
  if (!parsed.success) return { error: "번호를 확인하지 못했어요" };

  const supabase = await createSupabaseServerClient();
  const existing: string[] = [];
  const optedOut: string[] = [];

  for (let start = 0; start < parsed.data.length; start += IN_CHUNK) {
    const chunk = parsed.data.slice(start, start + IN_CHUNK);
    const [contacts, optOuts] = await Promise.all([
      supabase.from("contacts").select("phone").in("phone", chunk),
      supabase.from("opt_outs").select("phone").in("phone", chunk),
    ]);
    if (contacts.error || optOuts.error) {
      return { error: "번호를 확인하지 못했어요" };
    }
    existing.push(...contacts.data.map((row) => row.phone));
    optedOut.push(...optOuts.data.map((row) => row.phone));
  }
  return { existing, optedOut };
}

const saveSchema = z.object({
  groupId: z.uuid().nullable(),
  rows: z
    .array(
      z.object({
        phone: phoneField,
        name: z.string().trim().max(30).nullable(),
        memo: z.string().trim().max(200).nullable(),
      }),
    )
    .min(1)
    .max(MAX_SAVE_ROWS),
});

/**
 * 묶음 하나를 저장하고 새로 들어간 건수를 돌려준다.
 * 이미 있는 번호는 건너뛴다. 확인과 저장 사이에 같은 번호가 생기거나 재시도해도 실패하지 않아야 하기 때문이다.
 */
export async function saveUploadBatch(
  input: unknown,
): Promise<{ inserted: number } | { error: string }> {
  const member = await requireRole(["branch"]);
  if (!member.branchId) return { error: "지점 소속을 확인하지 못했어요" };
  const parsed = saveSchema.safeParse(input);
  if (!parsed.success) return { error: "저장할 내용을 확인해 주세요" };

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("contacts")
    .upsert(
      parsed.data.rows.map((row) => ({
        ...row,
        org_id: member.orgId,
        branch_id: member.branchId as string,
      })),
      { onConflict: "branch_id,phone", ignoreDuplicates: true },
    )
    .select("id");
  if (error) return { error: "저장하지 못했어요" };

  if (parsed.data.groupId && data.length > 0) {
    const { groupId } = parsed.data;
    // 다른 지점의 그룹이면 복합 외래 키가 거부한다.
    const members = await supabase.from("contact_group_members").insert(
      data.map((row) => ({
        group_id: groupId,
        contact_id: row.id,
        org_id: member.orgId,
        branch_id: member.branchId as string,
      })),
    );
    if (members.error) {
      return { error: "연락처는 저장했지만 그룹에 넣지 못했어요" };
    }
  }

  revalidatePath("/contacts");
  return { inserted: data.length };
}
