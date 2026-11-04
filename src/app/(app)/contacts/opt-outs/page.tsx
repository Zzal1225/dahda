import type { Metadata } from "next";
import { Suspense } from "react";
import {
  listOptOuts,
  optOutFiltersSchema,
} from "@/features/contacts/contact-query";
import { OptOutsScreen } from "@/features/contacts/opt-outs-screen";
import { requireRole } from "@/server/auth/requireRole";
import { createSupabaseServerClient } from "@/server/supabase/server";

export const metadata: Metadata = { title: "수신거부 · dahda" };

async function OptOuts({ searchParams }: PageProps<"/contacts/opt-outs">) {
  const member = await requireRole(["hq", "branch"]);
  const filters = optOutFiltersSchema.parse(await searchParams);
  const supabase = await createSupabaseServerClient();
  const { rows, total } = await listOptOuts(supabase, filters);

  return (
    <OptOutsScreen
      rows={rows}
      total={total}
      filters={filters}
      canRemove={member.role === "hq"}
    />
  );
}

export default function OptOutsPage(props: PageProps<"/contacts/opt-outs">) {
  return (
    <Suspense
      fallback={<div aria-hidden className="h-64 rounded-lg bg-skeleton" />}
    >
      <OptOuts {...props} />
    </Suspense>
  );
}
