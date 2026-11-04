"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { CurrentMember } from "@/server/auth/current-member";
import { requireRole } from "@/server/auth/requireRole";
import { createSupabaseServerClient } from "@/server/supabase/server";
import { contactSchema, groupSchema, optOutSchema } from "./contact-schema";

export type ActionResult = { error: string } | undefined;

const idSchema = z.uuid();
const UNIQUE_VIOLATION = "23505";
const FOREIGN_KEY_VIOLATION = "23503";

/**
 * 주소록은 지점 소유라 쓰기는 지점만 한다. 본사는 조회만 한다(기획서 권한 표).
 * 지점 소속은 입력으로 받지 않고 세션에서 읽는다. RLS도 막지만, 입력을 믿으면 오류 메시지로 드러나는 경로가 생긴다.
 */
async function requireBranchMember(): Promise<
  CurrentMember & { branchId: string }
> {
  const member = await requireRole(["branch"]);
  if (!member.branchId) throw new Error("지점 소속이 없는 지점 역할");
  return { ...member, branchId: member.branchId };
}

async function replaceGroups(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  member: CurrentMember & { branchId: string },
  contactId: string,
  groupIds: readonly string[],
): Promise<boolean> {
  // 지우고 다시 넣는다. 트랜잭션이 아니어서 중간에 실패하면 그룹이 빠질 수 있지만,
  // 연락처 자체는 남고 다시 저장하면 복구되어 함수를 따로 두지 않았다.
  const removed = await supabase
    .from("contact_group_members")
    .delete()
    .eq("contact_id", contactId);
  if (removed.error) return false;
  if (groupIds.length === 0) return true;

  // 다른 지점의 그룹이면 복합 외래 키가 거부한다.
  const inserted = await supabase.from("contact_group_members").insert(
    groupIds.map((groupId) => ({
      group_id: groupId,
      contact_id: contactId,
      org_id: member.orgId,
      branch_id: member.branchId,
    })),
  );
  return !inserted.error;
}

export async function createContact(input: unknown): Promise<ActionResult> {
  const member = await requireBranchMember();
  const parsed = contactSchema.safeParse(input);
  if (!parsed.success) return { error: "입력한 내용을 확인해 주세요" };
  const { groupIds, ...values } = parsed.data;

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("contacts")
    .insert({ ...values, org_id: member.orgId, branch_id: member.branchId })
    .select("id")
    .single();
  if (error) {
    return {
      error:
        error.code === UNIQUE_VIOLATION
          ? "이미 주소록에 있는 번호예요"
          : "연락처를 추가하지 못했어요",
    };
  }

  if (!(await replaceGroups(supabase, member, data.id, groupIds))) {
    return { error: "연락처는 추가했지만 그룹에 넣지 못했어요" };
  }
  revalidatePath("/contacts");
}

export async function updateContact(
  contactId: unknown,
  input: unknown,
): Promise<ActionResult> {
  const member = await requireBranchMember();
  const id = idSchema.safeParse(contactId);
  const parsed = contactSchema.safeParse(input);
  if (!id.success || !parsed.success) {
    return { error: "입력한 내용을 확인해 주세요" };
  }
  const { groupIds, ...values } = parsed.data;

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("contacts")
    .update(values)
    .eq("id", id.data)
    .select("id");
  if (error) {
    return {
      error:
        error.code === UNIQUE_VIOLATION
          ? "이미 주소록에 있는 번호예요"
          : "연락처를 고치지 못했어요",
    };
  }
  // RLS가 막으면 오류 없이 0건이다.
  if (data.length === 0) return { error: "연락처를 찾지 못했어요" };

  if (!(await replaceGroups(supabase, member, id.data, groupIds))) {
    return { error: "연락처는 고쳤지만 그룹을 바꾸지 못했어요" };
  }
  revalidatePath("/contacts");
}

export async function deleteContact(contactId: unknown): Promise<ActionResult> {
  await requireBranchMember();
  const id = idSchema.safeParse(contactId);
  if (!id.success) return { error: "연락처를 찾지 못했어요" };

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("contacts")
    .delete()
    .eq("id", id.data)
    .select("id");
  if (error) return { error: "연락처를 삭제하지 못했어요" };
  if (data.length === 0) return { error: "연락처를 찾지 못했어요" };
  revalidatePath("/contacts");
}

export async function createGroup(input: unknown): Promise<ActionResult> {
  const member = await requireBranchMember();
  const parsed = groupSchema.safeParse(input);
  if (!parsed.success) return { error: "그룹 이름을 확인해 주세요" };

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("contact_groups").insert({
    org_id: member.orgId,
    branch_id: member.branchId,
    name: parsed.data.name,
  });
  if (error) {
    return {
      error:
        error.code === UNIQUE_VIOLATION
          ? "같은 이름의 그룹이 있어요"
          : "그룹을 만들지 못했어요",
    };
  }
  revalidatePath("/contacts");
}

export async function renameGroup(
  groupId: unknown,
  input: unknown,
): Promise<ActionResult> {
  await requireBranchMember();
  const id = idSchema.safeParse(groupId);
  const parsed = groupSchema.safeParse(input);
  if (!id.success || !parsed.success) {
    return { error: "그룹 이름을 확인해 주세요" };
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("contact_groups")
    .update({ name: parsed.data.name })
    .eq("id", id.data)
    .select("id");
  if (error) {
    return {
      error:
        error.code === UNIQUE_VIOLATION
          ? "같은 이름의 그룹이 있어요"
          : "그룹 이름을 바꾸지 못했어요",
    };
  }
  if (data.length === 0) return { error: "그룹을 찾지 못했어요" };
  revalidatePath("/contacts");
}

export async function deleteGroup(groupId: unknown): Promise<ActionResult> {
  await requireBranchMember();
  const id = idSchema.safeParse(groupId);
  if (!id.success) return { error: "그룹을 찾지 못했어요" };

  const supabase = await createSupabaseServerClient();
  // 그룹만 지운다. 소속 행은 연쇄로 지워지고 연락처는 남는다.
  const { data, error } = await supabase
    .from("contact_groups")
    .delete()
    .eq("id", id.data)
    .select("id");
  if (error) {
    return {
      error:
        error.code === FOREIGN_KEY_VIOLATION
          ? "사용 중인 그룹이에요"
          : "그룹을 삭제하지 못했어요",
    };
  }
  if (data.length === 0) return { error: "그룹을 찾지 못했어요" };
  revalidatePath("/contacts");
}

export async function addOptOut(input: unknown): Promise<ActionResult> {
  const member = await requireRole(["hq", "branch"]);
  const parsed = optOutSchema.safeParse(input);
  if (!parsed.success) return { error: "입력한 내용을 확인해 주세요" };

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("opt_outs").insert({
    org_id: member.orgId,
    phone: parsed.data.phone,
    reason: parsed.data.reason,
    source: "manual",
    created_by: member.userId,
  });
  if (error) {
    return {
      error:
        error.code === UNIQUE_VIOLATION
          ? "이미 수신거부에 등록된 번호예요"
          : "수신거부를 등록하지 못했어요",
    };
  }
  revalidatePath("/contacts", "layout");
}

export async function removeOptOut(optOutId: unknown): Promise<ActionResult> {
  await requireRole(["hq"]);
  const id = idSchema.safeParse(optOutId);
  if (!id.success) return { error: "수신거부를 찾지 못했어요" };

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("opt_outs")
    .delete()
    .eq("id", id.data)
    .select("id");
  if (error) return { error: "수신거부를 해제하지 못했어요" };
  if (data.length === 0) return { error: "수신거부를 찾지 못했어요" };
  revalidatePath("/contacts", "layout");
}
