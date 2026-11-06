import type { Metadata } from "next";
import { NuqsAdapter } from "nuqs/adapters/next/app";
import { Suspense } from "react";
import {
  contactFiltersSchema,
  countContactLists,
  listContacts,
  listGroups,
  listOptOuts,
  OPT_OUT_VIEW,
} from "@/features/contacts/contact-query";
import { ContactsScreen } from "@/features/contacts/contacts-screen";
import { requireRole } from "@/server/auth/requireRole";
import { createSupabaseServerClient } from "@/server/supabase/server";

export const metadata: Metadata = { title: "주소록 · dahda" };

async function Contacts({ searchParams }: PageProps<"/contacts">) {
  const member = await requireRole(["hq", "branch"]);
  const filters = contactFiltersSchema.parse(await searchParams);
  const supabase = await createSupabaseServerClient();
  const isHq = member.role === "hq";
  const optOutView = filters.group === OPT_OUT_VIEW;

  // 지점 담당자의 지점 필터는 무시한다(RLS가 어차피 자기 지점만 준다). 주소에 남은 값이 숫자를 헷갈리게 하지 않게.
  const branchFilter = isHq ? filters.branch : null;
  const effective = { ...filters, branch: branchFilter };

  const [contacts, optOuts, groups, counts, branches] = await Promise.all([
    optOutView ? null : listContacts(supabase, effective),
    optOutView
      ? listOptOuts(supabase, { q: filters.q, page: filters.page })
      : null,
    listGroups(supabase),
    countContactLists(supabase, branchFilter),
    supabase.from("branches").select("id, name").order("name"),
  ]);
  if (branches.error) {
    throw new Error(`지점 조회 실패: ${branches.error.message}`);
  }

  // 업로드할 지점: 지점 담당자는 자기 지점, 본사는 전 지점 중에서 고른다.
  const uploadBranches = isHq
    ? branches.data
    : branches.data.filter((branch) => branch.id === member.branchId);

  return (
    <ContactsScreen
      // 캐시 키 앞부분. 역할을 바꾸면 이전 역할의 상세 조회 결과를 쓰지 않는다.
      scope={`${member.userId}:${member.role}:${member.branchId ?? "hq"}`}
      filters={effective}
      contacts={contacts}
      optOuts={optOuts}
      groups={groups}
      branches={isHq ? branches.data : []}
      counts={counts}
      isHq={isHq}
      canEdit={!isHq}
      canExport={isHq}
      canRemoveOptOut={isHq}
      uploadBranches={uploadBranches}
    />
  );
}

function ContactsSkeleton() {
  return (
    <div aria-hidden data-wide className="flex flex-col gap-5">
      <div className="h-8 w-24 rounded-sm bg-skeleton" />
      <div className="grid gap-6 lg:grid-cols-[220px_minmax(0,1fr)]">
        <div className="h-64 rounded-lg bg-skeleton" />
        <div className="flex flex-col gap-3">
          <div className="h-10 rounded-md bg-skeleton" />
          <div className="h-96 rounded-lg bg-skeleton" />
        </div>
      </div>
    </div>
  );
}

export default function ContactsPage(props: PageProps<"/contacts">) {
  // 발송 내역과 같이 화면마다 어댑터를 둔다. URL 상태를 쓰지 않는 화면까지 감쌀 이유가 없다.
  return (
    <NuqsAdapter>
      <Suspense fallback={<ContactsSkeleton />}>
        <Contacts {...props} />
      </Suspense>
    </NuqsAdapter>
  );
}
