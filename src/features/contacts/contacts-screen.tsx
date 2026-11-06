"use client";

import { ContactRound, Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SelectMenu } from "@/components/ui/select-menu";
import { cn } from "@/lib/utils";
import { ContactDialog, OptOutDialog } from "./contact-dialogs";
import { ContactDrawer } from "./contact-drawer";
import {
  CONTACT_PAGE_SIZE,
  OPT_OUT_PAGE_SIZE,
  OPT_OUT_VIEW,
  type ContactFilters,
  type ContactRow,
  type GroupRow,
  type OptOutRow,
} from "./contact-query";
import { ContactTable } from "./contact-table";
import { GroupList } from "./group-list";
import { OptOutTable } from "./opt-outs-screen";
import {
  isReceiveStatus,
  RECEIVE_STATUSES,
  RECEIVE_STATUS_VIEW,
} from "./receive-status";
import { SelectionBar } from "./selection-bar";
import { UploadDialog } from "./upload/upload-dialog";
import { useContactFilters } from "./use-contact-filters";

const SEARCH_DEBOUNCE_MS = 300;
const ALL = "all";

type Page<T> = { rows: T[]; total: number };

function Pager({
  page,
  total,
  pageSize,
  unit,
  onPage,
}: {
  page: number;
  total: number;
  pageSize: number;
  unit: string;
  onPage: (page: number) => void;
}) {
  const lastPage = Math.max(1, Math.ceil(total / pageSize));
  const start = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const end = Math.min(page * pageSize, total);
  return (
    <div className="flex items-center justify-end gap-3 border-t border-border p-3">
      <span className="text-body-sm text-text-muted tabular-nums">
        {start.toLocaleString("ko-KR")}–{end.toLocaleString("ko-KR")} /{" "}
        {total.toLocaleString("ko-KR")}
        {unit}
      </span>
      <Button
        variant="secondary"
        disabled={page <= 1}
        onClick={() => onPage(page - 1)}
      >
        이전
      </Button>
      <Button
        variant="secondary"
        disabled={page >= lastPage}
        onClick={() => onPage(page + 1)}
      >
        다음
      </Button>
    </div>
  );
}

/**
 * 주소록. 왼쪽 220px 그룹 목록 + 오른쪽 표. 데이터는 서버 컴포넌트가 URL(nuqs)대로 읽어 넘긴다.
 * 툴바를 카드 상자에 넣지 않고 표 바로 위 한 줄로 둔다. 상자가 둘이면 필터가 표와 따로 노는 것처럼 보인다.
 */
export function ContactsScreen({
  scope,
  filters,
  contacts,
  optOuts,
  groups,
  branches,
  counts,
  isHq,
  canEdit,
  canExport,
  canRemoveOptOut,
  uploadBranches,
}: {
  scope: string;
  filters: ContactFilters;
  contacts: Page<ContactRow> | null;
  optOuts: Page<OptOutRow> | null;
  groups: readonly GroupRow[];
  branches: readonly { id: string; name: string }[];
  counts: { all: number; optOuts: number };
  isHq: boolean;
  canEdit: boolean;
  canExport: boolean;
  canRemoveOptOut: boolean;
  /** 업로드할 수 있는 지점. 지점 담당자는 자기 지점 하나, 본사는 전 지점이다. */
  uploadBranches: readonly { id: string; name: string }[];
}) {
  const { pending, setFilters, setPage } = useContactFilters();
  const [search, setSearch] = useState(filters.q);
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [openId, setOpenId] = useState<string | null>(null);
  const [openSnapshot, setOpenSnapshot] = useState<ContactRow | null>(null);

  const optOutView = filters.group === OPT_OUT_VIEW;
  const showBranch = isHq;

  // 본사는 그룹이 지점마다 있다. 지점을 고르면 그 지점 그룹만, 아니면 지점 이름을 붙여 모두 보인다.
  const visibleGroups = useMemo(
    () =>
      isHq && filters.branch
        ? groups.filter((group) => group.branchId === filters.branch)
        : groups,
    [groups, isHq, filters.branch],
  );

  // 검색어는 입력이 멈춘 뒤 주소에 남긴다. 글자마다 서버를 다시 그리면 입력이 끊긴다.
  useEffect(() => {
    if (search === filters.q) return;
    const timer = setTimeout(
      () => setFilters({ q: search }),
      SEARCH_DEBOUNCE_MS,
    );
    return () => clearTimeout(timer);
  }, [search, filters.q, setFilters]);

  // 조건이 바뀌면 선택을 비운다. 보이지 않는 행이 선택된 채로 문자 작성에 넘어가면 누구에게 보내는지 모른다.
  const conditionKey = JSON.stringify([
    filters.q,
    filters.group,
    filters.branch,
    filters.status,
  ]);
  // 효과(useEffect)가 아니라 렌더 중에 비교해 비운다. 효과로 하면 한 번은 이전 선택이 그려진 뒤 다시 그린다.
  const [selectionKey, setSelectionKey] = useState(conditionKey);
  if (selectionKey !== conditionKey) {
    setSelectionKey(conditionKey);
    setSelectedIds(new Set());
  }

  // 상세는 지금 표의 행을 우선 쓴다. 고친 뒤 서버가 다시 그리면 새 값이 보인다.
  const openContact =
    contacts?.rows.find((row) => row.id === openId) ??
    (openSnapshot?.id === openId ? openSnapshot : null);

  function toggle(id: string) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function togglePage(ids: readonly string[]) {
    setSelectedIds((current) => {
      const next = new Set(current);
      const all = ids.every((id) => next.has(id));
      for (const id of ids) {
        if (all) next.delete(id);
        else next.add(id);
      }
      return next;
    });
  }

  const ownBranchId = canEdit ? (uploadBranches[0]?.id ?? null) : null;
  const ownGroups = ownBranchId
    ? groups.filter((group) => group.branchId === ownBranchId)
    : [];
  const filtered = Boolean(filters.q || filters.status || filters.group);

  const exportHref = `/api/contacts/export?${new URLSearchParams(
    Object.entries({
      q: filters.q,
      group: filters.group ?? "",
      branch: filters.branch ?? "",
      status: filters.status ?? "",
    }).filter(([, value]) => value),
  )}`;

  return (
    <div data-wide className="flex flex-col gap-5">
      <h1 className="text-title-lg">주소록</h1>

      <div className="grid items-start gap-6 lg:grid-cols-[220px_minmax(0,1fr)]">
        <GroupList
          groups={visibleGroups}
          selected={filters.group}
          counts={counts}
          showBranchName={isHq && !filters.branch}
          canEdit={canEdit}
          onSelect={(group) => {
            setSearch("");
            setFilters({ group, q: "", status: null });
          }}
        />

        <section
          aria-label={optOutView ? "수신거부 목록" : "연락처 목록"}
          aria-busy={pending}
          className="flex min-w-0 flex-col gap-3"
        >
          <div
            role="toolbar"
            aria-label={optOutView ? "수신거부 검색" : "연락처 검색과 동작"}
            className="flex flex-wrap items-center gap-2"
          >
            <div className="relative w-[240px]">
              <Search
                aria-hidden
                className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-text-muted"
                strokeWidth={2}
              />
              <Input
                type="search"
                aria-label={optOutView ? "번호 검색" : "이름 또는 번호 검색"}
                placeholder={
                  optOutView ? "번호 뒤 4자리" : "이름 또는 번호 뒤 4자리"
                }
                className="pl-9"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </div>
            {!optOutView && isHq && (
              <SelectMenu
                label="지점"
                className="w-[132px]"
                value={filters.branch ?? ALL}
                options={[
                  { value: ALL, label: "전체 지점" },
                  ...branches.map((branch) => ({
                    value: branch.id,
                    label: branch.name,
                  })),
                ]}
                onChange={(value) =>
                  // 다른 지점의 그룹을 고른 채로 지점을 바꾸면 결과가 0이 된다. 그룹 선택을 함께 지운다.
                  setFilters({
                    branch: value === ALL ? null : value,
                    group: null,
                  })
                }
              />
            )}
            {!optOutView && (
              <SelectMenu
                label="수신 상태"
                className="w-[132px]"
                value={filters.status ?? ALL}
                options={[
                  { value: ALL, label: "모든 수신 상태" },
                  ...RECEIVE_STATUSES.map((status) => ({
                    value: status,
                    label: RECEIVE_STATUS_VIEW[status].label,
                  })),
                ]}
                onChange={(value) =>
                  setFilters({
                    status: isReceiveStatus(value) ? value : null,
                  })
                }
              />
            )}

            <div className="ml-auto flex items-center gap-2">
              {optOutView ? (
                <OptOutDialog
                  trigger={(open) => (
                    <Button onClick={open}>수신거부 등록</Button>
                  )}
                />
              ) : (
                <>
                  {canEdit && (
                    <ContactDialog
                      groups={ownGroups}
                      trigger={(open) => (
                        <Button variant="secondary" onClick={open}>
                          연락처 추가
                        </Button>
                      )}
                    />
                  )}
                  {canExport && (
                    // 파일을 내려받는 이동이라 링크다. 페이지 번호는 넘기지 않고 조건에 맞는 전체를 받는다.
                    <a
                      href={exportHref}
                      className={buttonVariants({ variant: "secondary" })}
                    >
                      내보내기
                    </a>
                  )}
                  {uploadBranches.length > 0 && (
                    <UploadDialog
                      branches={uploadBranches}
                      defaultBranchId={filters.branch}
                      trigger={(open) => (
                        <Button onClick={open}>엑셀 업로드</Button>
                      )}
                    />
                  )}
                </>
              )}
            </div>
          </div>

          {!optOutView && selectedIds.size > 0 && (
            <SelectionBar
              selectedIds={selectedIds}
              groups={ownGroups}
              canAddToGroup={canEdit}
              onClear={() => setSelectedIds(new Set())}
            />
          )}

          <div
            className={cn(
              "overflow-hidden rounded-lg border border-border bg-surface",
              pending && "opacity-60",
            )}
          >
            {optOutView && optOuts && (
              <>
                <OptOutTable
                  rows={optOuts.rows}
                  canRemove={canRemoveOptOut}
                  filtered={Boolean(filters.q)}
                />
                {optOuts.rows.length > 0 && (
                  <Pager
                    page={filters.page}
                    total={optOuts.total}
                    pageSize={OPT_OUT_PAGE_SIZE}
                    unit="건"
                    onPage={setPage}
                  />
                )}
              </>
            )}

            {!optOutView && contacts && contacts.rows.length === 0 && (
              <div className="flex flex-col items-center gap-3 p-12 text-center">
                <ContactRound
                  aria-hidden
                  className="size-6 text-text-muted"
                  strokeWidth={1.75}
                />
                <p className="text-body-sm text-text-muted">
                  {filtered || filters.page > 1
                    ? "조건에 맞는 연락처가 없어요"
                    : "아직 연락처가 없어요. 엑셀 파일로 한 번에 올릴 수 있어요"}
                </p>
                {(filtered || filters.page > 1) && (
                  <Button
                    variant="secondary"
                    onClick={() => {
                      setSearch("");
                      setFilters({ q: "", status: null, group: null });
                    }}
                  >
                    조건 지우기
                  </Button>
                )}
              </div>
            )}

            {!optOutView && contacts && contacts.rows.length > 0 && (
              <>
                <ContactTable
                  rows={contacts.rows}
                  groups={groups}
                  showBranch={showBranch}
                  selectedIds={selectedIds}
                  onToggle={toggle}
                  onTogglePage={togglePage}
                  onOpen={(contact) => {
                    setOpenSnapshot(contact);
                    setOpenId(contact.id);
                  }}
                />
                <Pager
                  page={filters.page}
                  total={contacts.total}
                  pageSize={CONTACT_PAGE_SIZE}
                  unit="명"
                  onPage={setPage}
                />
              </>
            )}
          </div>
        </section>
      </div>

      <ContactDrawer
        scope={scope}
        contact={openContact}
        groups={groups}
        canEdit={canEdit}
        showBranch={showBranch}
        onClose={() => setOpenId(null)}
      />
    </div>
  );
}
