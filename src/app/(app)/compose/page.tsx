import type { Metadata } from "next";
import { Suspense } from "react";
import { z } from "zod";
import { adSuffix } from "@/features/campaigns/campaignSchema";
import { optOutPhone, senderNameOf } from "@/features/campaigns/compose-config";
import { ComposeScreen } from "@/features/campaigns/compose-screen";
import { getOwnBalance } from "@/features/billing/balance";
import { requireRole } from "@/server/auth/requireRole";
import { createSupabaseServerClient } from "@/server/supabase/server";

export const metadata: Metadata = { title: "문자 작성 · dahda" };

const MAX_PREFILLED_CONTACTS = 200;
const uuid = z.uuid();

/**
 * 주소록에서 고른 연락처(?contacts=id,id). uuid가 아닌 값은 버린다. 주소는 사용자가 고칠 수 있는 입력이다.
 * 볼 수 없는 id(다른 지점 등)는 받는 사람 계산에서 RLS가 빈 결과로 만든다.
 */
function contactIdsFrom(value: string | string[] | undefined): string[] {
  const raw = Array.isArray(value) ? value.join(",") : (value ?? "");
  return [
    ...new Set(raw.split(",").filter((id) => uuid.safeParse(id).success)),
  ].slice(0, MAX_PREFILLED_CONTACTS);
}

async function Compose({ searchParams }: PageProps<"/compose">) {
  const initialContactIds = contactIdsFrom((await searchParams).contacts);
  const member = await requireRole(["hq", "branch"]);
  const supabase = await createSupabaseServerClient();

  const senders = supabase
    .from("sender_numbers")
    .select("id, number, label, is_default")
    .order("is_default", { ascending: false });

  const [groups, sendersResult, balance] = await Promise.all([
    supabase
      .from("contact_groups")
      .select("id, name, branches(name), contact_group_members(count)")
      .order("name"),
    // 본사는 RLS상 전 지점 번호가 보이지만, 자기 계정 번호로만 보낼 수 있다.
    member.branchId
      ? senders.eq("branch_id", member.branchId)
      : senders.is("branch_id", null),
    getOwnBalance(member),
  ]);
  if (groups.error) throw new Error(`그룹 조회 실패: ${groups.error.message}`);
  if (sendersResult.error) {
    throw new Error(`발신번호 조회 실패: ${sendersResult.error.message}`);
  }

  if (sendersResult.data.length === 0) {
    return (
      <>
        <h1 className="text-title-lg">문자 작성</h1>
        <p className="rounded-lg border border-border bg-surface p-12 text-center text-body-sm text-text-muted">
          등록된 발신번호가 없어 문자를 보낼 수 없어요
        </p>
      </>
    );
  }

  return (
    <>
      <h1 className="text-title-lg">문자 작성</h1>
      <ComposeScreen
        groups={groups.data.map((group) => ({
          id: group.id,
          name: group.name,
          // 본사는 지점별 그룹을 함께 보므로 어느 지점인지 표시한다.
          branchName:
            member.role === "hq" ? (group.branches?.name ?? null) : null,
          memberCount: group.contact_group_members[0]?.count ?? 0,
        }))}
        senders={sendersResult.data.map((sender) => ({
          id: sender.id,
          number: sender.number,
          label: sender.label,
          isDefault: sender.is_default,
        }))}
        balance={balance}
        senderName={senderNameOf(member)}
        optOutSuffix={adSuffix(optOutPhone())}
        isBranch={member.role === "branch"}
        initialContactIds={initialContactIds}
      />
    </>
  );
}

export default function ComposePage(props: PageProps<"/compose">) {
  return (
    <Suspense
      fallback={<div aria-hidden className="h-96 rounded-lg bg-skeleton" />}
    >
      <Compose {...props} />
    </Suspense>
  );
}
