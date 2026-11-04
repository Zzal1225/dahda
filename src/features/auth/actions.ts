"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getCurrentMember } from "@/server/auth/current-member";
import { createSupabaseAdminClient } from "@/server/supabase/admin";
import { createSupabaseServerClient } from "@/server/supabase/server";
import { loginSchema } from "./login-schema";

export type ActionResult = { error: string } | undefined;

export async function signIn(input: unknown): Promise<ActionResult> {
  const parsed = loginSchema.safeParse(input);
  if (!parsed.success) return { error: "이메일과 비밀번호를 확인해 주세요" };

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);
  // 이메일과 비밀번호 중 무엇이 틀렸는지 구분하지 않는다. 구분하면 가입된 이메일을 알아낼 수 있다.
  if (error) return { error: "이메일 또는 비밀번호가 맞지 않아요" };

  redirect("/");
}

export async function startTrial(): Promise<ActionResult> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.signInAnonymously();
  if (error || !data.user) {
    return { error: "체험을 시작하지 못했어요. 잠시 뒤 다시 시도해 주세요" };
  }

  const admin = createSupabaseAdminClient();
  const created = await admin.rpc("create_trial_org", {
    p_user_id: data.user.id,
  });
  if (created.error) {
    // 본사 없는 익명 세션을 남기면 다음 시도도 꼬인다. 이 사용자는 만료 작업이 나중에 지운다.
    await supabase.auth.signOut();
    return { error: "체험을 시작하지 못했어요. 잠시 뒤 다시 시도해 주세요" };
  }

  redirect("/");
}

export async function signOut(): Promise<void> {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  redirect("/login");
}

const switchRoleInput = z.uuid().nullable();

/** branchId가 null이면 본사 역할이다. */
export async function switchTrialRole(
  branchId: unknown,
): Promise<ActionResult> {
  const parsed = switchRoleInput.safeParse(branchId);
  if (!parsed.success) return { error: "역할을 바꾸지 못했어요" };

  // 호출한 사람을 입력으로 받지 않고 세션에서 읽는다. 받으면 다른 사용자의 역할을 바꿀 수 있다.
  const member = await getCurrentMember();
  if (!member) redirect("/login");
  if (!member.isTrial)
    return { error: "체험 계정에서만 역할을 바꿀 수 있어요" };

  const admin = createSupabaseAdminClient();
  const { error } = await admin.rpc("switch_trial_role", {
    p_user_id: member.userId,
    // 생성 타입은 uuid 인자를 null 불가로 표시하지만 본사 역할은 null이다.
    p_branch_id: parsed.data as string,
  });
  if (error) return { error: "역할을 바꾸지 못했어요" };

  // 사이드바·상단 바·본문이 모두 역할에 따라 달라지므로 레이아웃 전체를 다시 그린다.
  revalidatePath("/", "layout");
}
