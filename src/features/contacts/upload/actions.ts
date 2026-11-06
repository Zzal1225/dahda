"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { CurrentMember } from "@/server/auth/current-member";
import { requireRole } from "@/server/auth/requireRole";
import { createSupabaseServerClient } from "@/server/supabase/server";
import { phoneField } from "../contact-schema";

// Server Action 요청 크기 제한(기본 1MB) 안에 들어오도록 나눠 보낸다. 값은 클라이언트와 함께 쓴다.
const MAX_CHECK_PHONES = 2_000;
const MAX_SAVE_ROWS = 500;
// `.in()`은 주소에 번호를 다 적어 보낸다. 길이 제한을 넘지 않게 나눈다.
const IN_CHUNK = 300;

type Db = Awaited<ReturnType<typeof createSupabaseServerClient>>;

/**
 * 어느 지점 주소록에 넣는지. 지점 담당자는 입력과 관계없이 자기 지점이다(입력을 믿지 않는다).
 * 본사는 고른 지점이어야 하고, 같은 본사의 지점인지 읽어서 확인한다. 저장할 때 (branch_id, org_id) 외래 키와 RLS가 한 번 더 막는다.
 */
async function targetBranch(
  supabase: Db,
  member: CurrentMember,
  requested: unknown,
): Promise<string | null> {
  if (member.role === "branch") return member.branchId;
  const id = z.uuid().safeParse(requested);
  if (!id.success) return null;
  const { data } = await supabase
    .from("branches")
    .select("id")
    .eq("id", id.data)
    .maybeSingle();
  return data?.id ?? null;
}

const checkSchema = z.object({
  branchId: z.uuid().nullable(),
  phones: z.array(phoneField).max(MAX_CHECK_PHONES),
});

export type UploadCheck = { existing: string[]; optedOut: string[] };

/**
 * 그 지점 주소록에 이미 있는 번호와 수신거부 번호를 찾는다. 사용자 권한으로 읽어 RLS가 범위를 정한다.
 * "이미 있음"은 지점 기준이다(고유 키가 branch_id, phone). 본사는 전 지점을 읽을 수 있어 지점으로 좁힌다.
 */
export async function checkUploadPhones(
  input: unknown,
): Promise<UploadCheck | { error: string }> {
  const member = await requireRole(["hq", "branch"]);
  const parsed = checkSchema.safeParse(input);
  if (!parsed.success) return { error: "번호를 확인하지 못했어요" };

  const supabase = await createSupabaseServerClient();
  const branchId = await targetBranch(supabase, member, parsed.data.branchId);
  if (!branchId) return { error: "올릴 지점을 골라 주세요" };

  const existing: string[] = [];
  const optedOut: string[] = [];
  for (let start = 0; start < parsed.data.phones.length; start += IN_CHUNK) {
    const chunk = parsed.data.phones.slice(start, start + IN_CHUNK);
    const [contacts, optOuts] = await Promise.all([
      supabase
        .from("contacts")
        .select("phone")
        .eq("branch_id", branchId)
        .in("phone", chunk),
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
  branchId: z.uuid().nullable(),
  rows: z
    .array(
      z.object({
        phone: phoneField,
        name: z.string().trim().max(30).nullable(),
        memo: z.string().trim().max(200).nullable(),
        groupNames: z.array(z.string().trim().min(1).max(30)).max(5),
        // 파일에서 읽은 값을 브라우저가 해석해 보낸다. 미래 시각은 서버에서도 거부한다.
        consentAt: z.iso
          .datetime()
          .nullable()
          .refine(
            (value) =>
              value === null ||
              new Date(value).getTime() <= Date.now() + 60_000,
          ),
      }),
    )
    .min(1)
    .max(MAX_SAVE_ROWS),
});

/**
 * 그룹 이름 → id. 없는 이름은 만든다. 묶음마다 부르므로 두 번째 묶음부터는 이미 있는 그룹을 찾는다.
 * 만들 때 같은 이름이 동시에 생겨도 고유 키(branch_id, name)에서 무시하고 다시 읽는다.
 */
async function groupIdsByName(
  supabase: Db,
  member: CurrentMember,
  branchId: string,
  names: readonly string[],
): Promise<Map<string, string> | null> {
  if (names.length === 0) return new Map();
  const read = () =>
    supabase
      .from("contact_groups")
      .select("id, name")
      .eq("branch_id", branchId)
      .in("name", [...names]);

  const first = await read();
  if (first.error) return null;
  const found = new Map(first.data.map((group) => [group.name, group.id]));
  const missing = names.filter((name) => !found.has(name));
  if (missing.length === 0) return found;

  const created = await supabase.from("contact_groups").upsert(
    missing.map((name) => ({
      org_id: member.orgId,
      branch_id: branchId,
      name,
    })),
    { onConflict: "branch_id,name", ignoreDuplicates: true },
  );
  if (created.error) return null;
  const again = await read();
  if (again.error) return null;
  return new Map(again.data.map((group) => [group.name, group.id]));
}

/**
 * 묶음 하나를 저장하고 새로 들어간 건수를 돌려준다.
 * 이미 있는 번호는 건너뛴다. 확인과 저장 사이에 같은 번호가 생기거나 재시도해도 실패하지 않아야 하기 때문이다.
 * 건너뛴 번호에는 그룹도 넣지 않는다("중복"은 손대지 않는다는 뜻이다).
 */
export async function saveUploadBatch(
  input: unknown,
): Promise<{ inserted: number } | { error: string }> {
  const member = await requireRole(["hq", "branch"]);
  const parsed = saveSchema.safeParse(input);
  if (!parsed.success) return { error: "저장할 내용을 확인해 주세요" };

  const supabase = await createSupabaseServerClient();
  const branchId = await targetBranch(supabase, member, parsed.data.branchId);
  if (!branchId) return { error: "올릴 지점을 골라 주세요" };

  const { data, error } = await supabase
    .from("contacts")
    .upsert(
      parsed.data.rows.map((row) => ({
        phone: row.phone,
        name: row.name,
        memo: row.memo,
        consent_at: row.consentAt,
        org_id: member.orgId,
        branch_id: branchId,
      })),
      { onConflict: "branch_id,phone", ignoreDuplicates: true },
    )
    .select("id, phone");
  if (error) return { error: "저장하지 못했어요" };

  const namesByPhone = new Map(
    parsed.data.rows.map((row) => [row.phone, row.groupNames]),
  );
  const allNames = [
    ...new Set(data.flatMap((row) => namesByPhone.get(row.phone) ?? [])),
  ];
  if (allNames.length > 0) {
    const groupIds = await groupIdsByName(supabase, member, branchId, allNames);
    if (!groupIds) {
      return { error: "연락처는 저장했지만 그룹을 만들지 못했어요" };
    }
    const members = data.flatMap((row) =>
      (namesByPhone.get(row.phone) ?? []).flatMap((name) => {
        const groupId = groupIds.get(name);
        return groupId
          ? [
              {
                group_id: groupId,
                contact_id: row.id,
                org_id: member.orgId,
                branch_id: branchId,
              },
            ]
          : [];
      }),
    );
    if (members.length > 0) {
      const inserted = await supabase
        .from("contact_group_members")
        .insert(members);
      if (inserted.error) {
        return { error: "연락처는 저장했지만 그룹에 넣지 못했어요" };
      }
    }
  }

  revalidatePath("/contacts");
  return { inserted: data.length };
}
