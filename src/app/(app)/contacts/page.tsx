import type { Metadata } from "next";
import { Suspense } from "react";
import {
  contactFiltersSchema,
  listContacts,
  listGroups,
} from "@/features/contacts/contact-query";
import { ContactsScreen } from "@/features/contacts/contacts-screen";
import { requireRole } from "@/server/auth/requireRole";
import { createSupabaseServerClient } from "@/server/supabase/server";

export const metadata: Metadata = { title: "주소록 · dahda" };

async function Contacts({ searchParams }: PageProps<"/contacts">) {
  const member = await requireRole(["hq", "branch"]);
  const filters = contactFiltersSchema.parse(await searchParams);
  const supabase = await createSupabaseServerClient();

  const [contacts, groups, branches] = await Promise.all([
    listContacts(supabase, filters),
    listGroups(supabase),
    member.role === "hq"
      ? supabase.from("branches").select("id, name").order("name")
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (branches.error) {
    throw new Error(`지점 조회 실패: ${branches.error.message}`);
  }

  return (
    <ContactsScreen
      rows={contacts.rows}
      total={contacts.total}
      filters={filters}
      groups={groups}
      branches={branches.data ?? []}
      canEdit={member.role === "branch"}
    />
  );
}

function ContactsSkeleton() {
  return (
    <div aria-hidden className="flex flex-col gap-5">
      <div className="h-[70px] rounded-lg bg-skeleton" />
      <div className="h-64 rounded-lg bg-skeleton" />
    </div>
  );
}

export default function ContactsPage(props: PageProps<"/contacts">) {
  return (
    <Suspense fallback={<ContactsSkeleton />}>
      <Contacts {...props} />
    </Suspense>
  );
}
