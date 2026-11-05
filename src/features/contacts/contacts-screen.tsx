"use client";

import { createColumnHelper } from "@tanstack/react-table";
import { ContactRound } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  DataTable,
  dataTableFeatures,
  type DataTableColumn,
} from "@/components/ui/data-table";
import { Input } from "@/components/ui/input";
import { formatPhone } from "@/lib/format";
import { deleteContact, deleteGroup } from "./actions";
import { ContactDialog, GroupDialog } from "./contact-dialogs";
import {
  CONTACT_PAGE_SIZE,
  type ContactFilters,
  type ContactRow,
  type GroupRow,
} from "./contact-query";

const column = createColumnHelper<typeof dataTableFeatures, ContactRow>();
const SEARCH_DEBOUNCE_MS = 300;

function buildColumns(
  canEdit: boolean,
  showBranch: boolean,
  groups: readonly GroupRow[],
): DataTableColumn<ContactRow>[] {
  const nameOf = new Map(groups.map((group) => [group.id, group.name]));
  const columns: DataTableColumn<ContactRow>[] = [
    column.display({
      id: "phone",
      header: "전화번호",
      meta: { width: "148px" },
      cell: ({ row }) => (
        <span className="text-mono">{formatPhone(row.original.phone)}</span>
      ),
    }),
    column.display({
      id: "name",
      header: "이름",
      meta: { width: "112px" },
      cell: ({ row }) => (
        <span className="truncate">{row.original.name ?? "—"}</span>
      ),
    }),
    column.display({
      id: "groups",
      header: "그룹",
      meta: { width: "minmax(80px, 1fr)" },
      cell: ({ row }) => (
        <span className="truncate">
          {row.original.groupIds
            .map((id) => nameOf.get(id))
            .filter(Boolean)
            .join(", ") || "—"}
        </span>
      ),
    }),
    column.display({
      id: "memo",
      header: "메모",
      meta: { width: "minmax(80px, 1fr)" },
      cell: ({ row }) => (
        <span className="truncate text-text-muted">{row.original.memo}</span>
      ),
    }),
    column.display({
      id: "optOut",
      header: "수신",
      meta: { width: "84px" },
      cell: ({ row }) =>
        row.original.optedOut ? (
          <span className="rounded-sm border border-danger px-1 text-caption font-bold text-danger">
            수신거부
          </span>
        ) : row.original.consentAt ? (
          <span className="text-caption text-text-muted">동의</span>
        ) : (
          <span className="text-caption font-bold text-status-pending">
            미동의
          </span>
        ),
    }),
  ];

  if (showBranch) {
    columns.unshift(
      column.display({
        id: "branch",
        header: "지점",
        meta: { width: "84px" },
        cell: ({ row }) => row.original.branchName,
      }),
    );
  }

  if (canEdit) {
    columns.push(
      column.display({
        id: "actions",
        header: () => <span className="sr-only">작업</span>,
        meta: { width: "148px", align: "right" },
        cell: ({ row }) => (
          <>
            <ContactDialog
              contact={row.original}
              groups={groups}
              trigger={(open) => (
                <Button variant="ghost" onClick={open}>
                  수정
                </Button>
              )}
            />
            <ConfirmDialog
              title="연락처를 삭제할까요?"
              description={`${formatPhone(row.original.phone)} 번호를 주소록에서 지워요. 지난 발송 기록은 그대로 남아요.`}
              confirmLabel="삭제"
              onConfirm={() => deleteContact(row.original.id)}
              trigger={(open) => (
                <Button variant="ghost" onClick={open}>
                  삭제
                </Button>
              )}
            />
          </>
        ),
      }),
    );
  }
  return columns;
}

export function ContactsScreen({
  rows,
  total,
  filters,
  groups,
  branches,
  canEdit,
  canExport,
}: {
  rows: ContactRow[];
  total: number;
  filters: ContactFilters;
  groups: readonly GroupRow[];
  branches: readonly { id: string; name: string }[];
  canEdit: boolean;
  canExport: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();
  const [search, setSearch] = useState(filters.q);

  const showBranch = branches.length > 0;
  // 본사는 그룹이 지점마다 있어 지점을 고른 뒤에만 그룹으로 거른다.
  const visibleGroups = useMemo(
    () =>
      showBranch
        ? groups.filter((group) => group.branchId === filters.branch)
        : groups,
    [groups, showBranch, filters.branch],
  );
  const columns = useMemo(
    () => buildColumns(canEdit, showBranch, groups),
    [canEdit, showBranch, groups],
  );

  function hrefWith(patch: Record<string, string | null>): string {
    const next = new URLSearchParams(searchParams);
    for (const [key, value] of Object.entries(patch)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    const query = next.toString();
    return query ? `${pathname}?${query}` : pathname;
  }

  // 필터가 바뀌면 1페이지로 돌아간다. 뒤쪽 페이지에서 결과가 줄면 빈 페이지가 보인다.
  function applyFilter(patch: Record<string, string | null>) {
    startTransition(() => {
      router.replace(hrefWith({ ...patch, page: null }), { scroll: false });
    });
  }

  useEffect(() => {
    if (search === filters.q) return;
    const timer = setTimeout(
      () => applyFilter({ q: search || null }),
      SEARCH_DEBOUNCE_MS,
    );
    return () => clearTimeout(timer);
    // applyFilter는 매 렌더 새로 만들어져 넣으면 타이머가 계속 다시 시작된다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, filters.q]);

  const lastPage = Math.max(1, Math.ceil(total / CONTACT_PAGE_SIZE));
  const start = total === 0 ? 0 : (filters.page - 1) * CONTACT_PAGE_SIZE + 1;
  const end = Math.min(filters.page * CONTACT_PAGE_SIZE, total);
  const filtered = Boolean(filters.q || filters.group || filters.branch);

  return (
    <>
      <section
        aria-label="검색과 그룹"
        className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-surface p-4"
      >
        <Input
          type="search"
          aria-label="이름 또는 번호 검색"
          placeholder="이름 또는 번호 검색"
          className="w-[220px]"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        {showBranch && (
          <select
            aria-label="지점"
            value={filters.branch ?? ""}
            onChange={(event) =>
              applyFilter({ branch: event.target.value || null, group: null })
            }
            className="h-(--control-h) cursor-pointer rounded-md border border-border-strong bg-surface px-2 text-body-sm outline-none focus-visible:ring-2 focus-visible:ring-focus"
          >
            <option value="">전체 지점</option>
            {branches.map((branch) => (
              <option key={branch.id} value={branch.id}>
                {branch.name}
              </option>
            ))}
          </select>
        )}
        {visibleGroups.length > 0 && (
          <select
            aria-label="그룹"
            value={filters.group ?? ""}
            onChange={(event) =>
              applyFilter({ group: event.target.value || null })
            }
            className="h-(--control-h) cursor-pointer rounded-md border border-border-strong bg-surface px-2 text-body-sm outline-none focus-visible:ring-2 focus-visible:ring-focus"
          >
            <option value="">전체 그룹</option>
            {visibleGroups.map((group) => (
              <option key={group.id} value={group.id}>
                {group.name} ({group.memberCount})
              </option>
            ))}
          </select>
        )}
        {canExport && (
          // 페이지 번호는 넘기지 않는다. 지금 걸린 조건에 맞는 전체를 받는다.
          <a
            href={`/api/contacts/export?${new URLSearchParams(
              Object.entries({
                q: filters.q,
                group: filters.group ?? "",
                branch: filters.branch ?? "",
              }).filter(([, value]) => value),
            )}`}
            className="ml-auto inline-flex h-(--control-h) items-center rounded-md border border-border-strong bg-surface px-4 text-body-sm font-bold outline-none hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-focus"
          >
            엑셀 내보내기
          </a>
        )}
        {canEdit && (
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <Link
              href="/contacts/upload"
              className="inline-flex h-(--control-h) items-center rounded-md border border-border-strong bg-surface px-4 text-body-sm font-bold outline-none hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-focus"
            >
              엑셀 업로드
            </Link>
            <GroupDialog
              trigger={(open) => (
                <Button variant="secondary" onClick={open}>
                  그룹 만들기
                </Button>
              )}
            />
            <ContactDialog
              groups={groups}
              trigger={(open) => <Button onClick={open}>연락처 추가</Button>}
            />
          </div>
        )}
      </section>

      {canEdit && groups.length > 0 && (
        <section
          aria-label="그룹 관리"
          className="flex flex-wrap items-center gap-2 text-body-sm"
        >
          <span className="text-caption font-bold text-text-muted">그룹</span>
          {groups.map((group) => (
            <span
              key={group.id}
              className="inline-flex items-center gap-1 rounded-full border border-border bg-surface pl-3"
            >
              {group.name}
              <span className="text-caption text-text-muted">
                {group.memberCount}
              </span>
              <GroupDialog
                group={group}
                trigger={(open) => (
                  <Button
                    variant="ghost"
                    onClick={open}
                    aria-label={`${group.name} 이름 바꾸기`}
                    className="h-7 px-2 text-caption"
                  >
                    수정
                  </Button>
                )}
              />
              <ConfirmDialog
                title={`"${group.name}" 그룹을 삭제할까요?`}
                description="그룹만 지워져요. 연락처는 주소록에 그대로 남아요."
                confirmLabel="삭제"
                onConfirm={() => deleteGroup(group.id)}
                trigger={(open) => (
                  <Button
                    variant="ghost"
                    onClick={open}
                    aria-label={`${group.name} 삭제`}
                    className="h-7 px-2 text-caption"
                  >
                    삭제
                  </Button>
                )}
              />
            </span>
          ))}
        </section>
      )}

      <section
        aria-label="연락처"
        aria-busy={pending}
        className="overflow-hidden rounded-lg border border-border bg-surface"
      >
        {rows.length === 0 ? (
          <div className="flex flex-col items-center gap-3 p-12 text-center">
            <ContactRound
              aria-hidden
              className="size-6 text-text-muted"
              strokeWidth={1.75}
            />
            <p className="text-body-sm text-text-muted">
              {filtered
                ? "조건에 맞는 연락처가 없어요"
                : canEdit
                  ? "아직 연락처가 없어요"
                  : "아직 등록된 연락처가 없어요"}
            </p>
            {filtered ? (
              <Button
                variant="secondary"
                onClick={() => {
                  setSearch("");
                  applyFilter({ q: null, group: null, branch: null });
                }}
              >
                조건 지우기
              </Button>
            ) : (
              canEdit && (
                <ContactDialog
                  groups={groups}
                  trigger={(open) => (
                    <Button variant="secondary" onClick={open}>
                      첫 연락처 추가하기
                    </Button>
                  )}
                />
              )
            )}
          </div>
        ) : (
          <>
            <DataTable
              ariaLabel="연락처"
              columns={columns}
              rows={rows}
              getRowId={(row) => row.id}
              rowHeight={44}
            />
            <div className="flex items-center justify-end gap-3 border-t border-border p-3">
              <span className="text-body-sm text-text-muted">
                {start.toLocaleString("ko-KR")}–{end.toLocaleString("ko-KR")} /{" "}
                {total.toLocaleString("ko-KR")}명
              </span>
              <PageLink
                href={hrefWith({ page: String(filters.page - 1) })}
                disabled={filters.page <= 1}
                label="이전"
              />
              <PageLink
                href={hrefWith({ page: String(filters.page + 1) })}
                disabled={filters.page >= lastPage}
                label="다음"
              />
            </div>
          </>
        )}
      </section>
    </>
  );
}

export function PageLink({
  href,
  disabled,
  label,
}: {
  href: string;
  disabled: boolean;
  label: string;
}) {
  if (disabled) {
    return (
      <Button variant="secondary" disabled>
        {label}
      </Button>
    );
  }
  return (
    <Link
      href={href}
      scroll={false}
      className="inline-flex h-(--control-h) items-center rounded-md border border-border-strong bg-surface px-4 text-body-sm font-bold outline-none hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-focus"
    >
      {label}
    </Link>
  );
}
