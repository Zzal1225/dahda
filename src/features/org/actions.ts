"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireRole } from "@/server/auth/requireRole";
import { createSupabaseAdminClient } from "@/server/supabase/admin";
import { createSupabaseServerClient } from "@/server/supabase/server";
import { createBranchAccount, type BranchAccountError } from "./branch-account";
import { branchAccountSchema, branchNameSchema } from "./branch-schema";

export type ActionResult = { error: string } | undefined;

const branchIdSchema = z.uuid();
const UNIQUE_VIOLATION = "23505";
const DUPLICATE_NAME = "같은 이름의 지점이 있어요";

const ACCOUNT_ERRORS: Record<BranchAccountError, string> = {
  branch_not_found: "지점을 찾지 못했어요",
  already_assigned: "이미 담당 계정이 있는 지점이에요",
  email_taken: "이미 쓰고 있는 이메일이에요",
  failed: "계정을 만들지 못했어요. 잠시 뒤 다시 시도해 주세요",
};

// Server Action은 공개 엔드포인트다. 화면에 버튼이 없어도 호출할 수 있어 입력 검증보다 권한 확인을 먼저 한다.

export async function createBranch(input: unknown): Promise<ActionResult> {
  const member = await requireRole(["hq"]);
  const parsed = branchNameSchema.safeParse(input);
  if (!parsed.success) return { error: "지점 이름을 확인해 주세요" };

  // 지점 쓰기는 RLS로 열어 두었으므로 사용자 권한으로 저장한다. 가드가 뚫려도 정책이 한 번 더 막는다.
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("branches")
    .insert({ org_id: member.orgId, name: parsed.data.name });

  if (error) {
    return {
      error:
        error.code === UNIQUE_VIOLATION
          ? DUPLICATE_NAME
          : "지점을 추가하지 못했어요",
    };
  }

  // 상단 바의 체험 역할 메뉴에도 지점 이름이 있어 레이아웃까지 다시 그린다.
  revalidatePath("/", "layout");
}

export async function renameBranch(
  branchId: unknown,
  input: unknown,
): Promise<ActionResult> {
  await requireRole(["hq"]);
  const id = branchIdSchema.safeParse(branchId);
  const parsed = branchNameSchema.safeParse(input);
  if (!id.success || !parsed.success) {
    return { error: "지점 이름을 확인해 주세요" };
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("branches")
    .update({ name: parsed.data.name })
    .eq("id", id.data)
    .select("id");

  if (error) {
    return {
      error:
        error.code === UNIQUE_VIOLATION
          ? DUPLICATE_NAME
          : "이름을 바꾸지 못했어요",
    };
  }
  // RLS가 막으면 오류 없이 0건이다. 확인하지 않으면 실패를 성공으로 보여 준다.
  if (data.length === 0) return { error: "지점을 찾지 못했어요" };

  revalidatePath("/", "layout");
}

export async function assignBranchAccount(
  branchId: unknown,
  input: unknown,
): Promise<ActionResult> {
  const member = await requireRole(["hq"]);
  // 체험 사용자가 실제 로그인 계정을 만들 수 있으면 공개 페이지가 계정 생성 창구가 된다.
  if (member.isTrial) return { error: "체험 계정에서는 계정을 만들 수 없어요" };

  const id = branchIdSchema.safeParse(branchId);
  const parsed = branchAccountSchema.safeParse(input);
  if (!id.success || !parsed.success) {
    return { error: "입력한 내용을 확인해 주세요" };
  }

  const failure = await createBranchAccount(
    createSupabaseAdminClient(),
    member.orgId,
    id.data,
    parsed.data,
  );
  if (failure) return { error: ACCOUNT_ERRORS[failure] };

  revalidatePath("/branches");
}
