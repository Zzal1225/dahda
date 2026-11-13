"use client";

import { Check, Link as LinkIcon, X } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import { StatusIcon } from "@/components/ui/status-badge";
import { HQ_BRANCH_FILTER } from "@/features/campaigns/campaign-query";
import type { MessageCounts } from "@/features/campaigns/campaign-view";
import { cn } from "@/lib/utils";
import { MESSAGE_STATUSES, type MessageRow } from "./message-query";
import { MESSAGE_STATUS_VIEW } from "./message-view";
import {
  CAMPAIGN_STATE_FILTERS,
  type AdFilter,
  type CampaignStateFilter,
  type KindFilter,
  type Period,
  type TableState,
} from "./table-state";

const PERIOD_OPTIONS: { value: Period; label: string }[] = [
  { value: "today", label: "오늘" },
  { value: "7d", label: "7일" },
  { value: "30d", label: "30일" },
  { value: "custom", label: "직접" },
];
const AD_OPTIONS: { value: AdFilter; label: string }[] = [
  { value: "all", label: "전체" },
  { value: "ad", label: "광고" },
  { value: "non_ad", label: "비광고" },
];

// 선택 상자로 둔다. 세 칸짜리 버튼 묶음이면 1280px 본사 화면(지점 칸이 있다)에서 툴바가 두 줄로 넘친다.
const KIND_OPTIONS: { value: KindFilter; label: string }[] = [
  { value: "all", label: "모든 종류" },
  { value: "sms", label: "SMS" },
  { value: "lms", label: "LMS" },
];

// 라벨은 상태 배지와 같게 둔다. 필터와 표가 다른 말을 쓰면 같은 건인지 헷갈린다.
const STATE_LABELS: Record<CampaignStateFilter, string> = {
  pending_approval: "승인 대기",
  scheduled: "예약",
  sending: "확인 중",
  completed: "완료",
  has_failed: "실패 포함",
  rejected: "반려",
  canceled: "취소",
};

const SEARCH_DEBOUNCE_MS = 300;

export type BranchOption = { id: string; name: string };

function appliedChips(
  state: TableState,
  branches: readonly BranchOption[],
): { key: string; label: string; clear: () => void }[] {
  const { filters, setFilters } = state;
  const chips = [];

  if (filters.period !== "7d") {
    const label =
      filters.period === "custom"
        ? `기간 ${filters.from ?? "처음"} ~ ${filters.to ?? "오늘"}`
        : `기간 ${PERIOD_OPTIONS.find((o) => o.value === filters.period)?.label}`;
    chips.push({
      key: "period",
      label,
      clear: () => setFilters({ period: "7d", from: null, to: null }),
    });
  }
  if (filters.branch) {
    const name =
      filters.branch === HQ_BRANCH_FILTER
        ? "본사 발송"
        : (branches.find((b) => b.id === filters.branch)?.name ?? "지점");
    chips.push({
      key: "branch",
      label: name,
      clear: () => setFilters({ branch: null }),
    });
  }
  if (filters.ad !== "all") {
    chips.push({
      key: "ad",
      label: filters.ad === "ad" ? "광고" : "비광고",
      clear: () => setFilters({ ad: "all" }),
    });
  }
  if (filters.kind !== "all") {
    chips.push({
      key: "kind",
      label: filters.kind.toUpperCase(),
      clear: () => setFilters({ kind: "all" }),
    });
  }
  if (filters.state) {
    chips.push({
      key: "state",
      label: `발송 건 ${STATE_LABELS[filters.state]}`,
      clear: () => setFilters({ state: null }),
    });
  }
  if (filters.status.length > 0) {
    chips.push({
      key: "status",
      label: `상태 ${filters.status.map((s) => MESSAGE_STATUS_VIEW[s].label).join("·")}`,
      clear: () => setFilters({ status: [] }),
    });
  }
  if (filters.q) {
    chips.push({
      key: "q",
      label: `번호 ${filters.q}`,
      clear: () => setFilters({ q: "" }),
    });
  }
  return chips;
}

export function HistoryFilters({
  state,
  branches,
  showBranch,
  counts,
}: {
  state: TableState;
  branches: readonly BranchOption[];
  showBranch: boolean;
  /** 발송 건을 선택했을 때만 상태 칩의 건수를 보여 준다. */
  counts: MessageCounts | null;
}) {
  const { filters, setFilters } = state;
  const [search, setSearch] = useState(filters.q);
  const [copied, setCopied] = useState(false);

  // 칩의 ✕나 "모두 지우기"로 바뀐 값을 입력창에도 반영한다.
  const [syncedQ, setSyncedQ] = useState(filters.q);
  if (filters.q !== syncedQ) {
    setSyncedQ(filters.q);
    setSearch(filters.q);
  }

  // 글자마다 조회하면 10만 행에 요청이 몰리고 선택도 매번 지워진다.
  useEffect(() => {
    if (search === filters.q) return;
    const timer = setTimeout(
      () => setFilters({ q: search }),
      SEARCH_DEBOUNCE_MS,
    );
    return () => clearTimeout(timer);
  }, [search, filters.q, setFilters]);

  async function copyLink() {
    await navigator.clipboard.writeText(window.location.href);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function toggleStatus(status: MessageRow["status"]) {
    setFilters({
      status: filters.status.includes(status)
        ? filters.status.filter((item) => item !== status)
        : [...filters.status, status],
    });
  }

  const chips = appliedChips(state, branches);

  return (
    <section
      aria-label="필터"
      className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4"
    >
      <div className="flex flex-wrap items-center gap-3">
        <Segmented
          label="기간"
          value={filters.period}
          options={PERIOD_OPTIONS}
          onChange={(period) => setFilters({ period })}
        />
        {filters.period === "custom" && (
          <div className="flex items-center gap-1 text-caption">
            <Input
              type="date"
              aria-label="시작 날짜"
              className="w-[140px]"
              value={filters.from ?? ""}
              onChange={(event) =>
                setFilters({ from: event.target.value || null })
              }
            />
            ~
            <Input
              type="date"
              aria-label="끝 날짜"
              className="w-[140px]"
              value={filters.to ?? ""}
              onChange={(event) =>
                setFilters({ to: event.target.value || null })
              }
            />
          </div>
        )}
        {showBranch && (
          <select
            aria-label="지점"
            value={filters.branch ?? ""}
            onChange={(event) =>
              setFilters({ branch: event.target.value || null })
            }
            className="h-(--control-h) cursor-pointer rounded-md border border-border-strong bg-surface px-2 text-body-sm outline-none focus-visible:ring-2 focus-visible:ring-focus"
          >
            <option value="">전체 지점</option>
            <option value={HQ_BRANCH_FILTER}>본사 발송</option>
            {branches.map((branch) => (
              <option key={branch.id} value={branch.id}>
                {branch.name}
              </option>
            ))}
          </select>
        )}
        <Segmented
          label="광고 여부"
          value={filters.ad}
          options={AD_OPTIONS}
          onChange={(ad) => setFilters({ ad })}
        />
        <select
          aria-label="문자 종류"
          value={filters.kind}
          onChange={(event) =>
            setFilters({
              kind:
                KIND_OPTIONS.find(
                  (option) => option.value === event.target.value,
                )?.value ?? "all",
            })
          }
          className="h-(--control-h) cursor-pointer rounded-md border border-border-strong bg-surface px-2 text-body-sm outline-none focus-visible:ring-2 focus-visible:ring-focus"
        >
          {KIND_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <select
          aria-label="발송 건 상태"
          value={filters.state ?? ""}
          onChange={(event) =>
            setFilters({
              state:
                CAMPAIGN_STATE_FILTERS.find(
                  (value) => value === event.target.value,
                ) ?? null,
            })
          }
          className="h-(--control-h) cursor-pointer rounded-md border border-border-strong bg-surface px-2 text-body-sm outline-none focus-visible:ring-2 focus-visible:ring-focus"
        >
          <option value="">모든 상태</option>
          {CAMPAIGN_STATE_FILTERS.map((value) => (
            <option key={value} value={value}>
              {STATE_LABELS[value]}
            </option>
          ))}
        </select>
        {/* 줄바꿈은 basis(검색 최소 140px + 버튼)로 정하고, 남는 자리에서 검색창이 200px까지 늘어난다.
            고정 폭이면 몇 px 모자랄 때 검색과 버튼만 다음 줄로 떨어진다. */}
        <div className="ml-auto flex grow basis-[184px] items-center justify-end gap-2">
          <Input
            type="search"
            inputMode="numeric"
            aria-label="수신번호 검색"
            placeholder="수신번호 검색"
            className="w-full max-w-[200px] min-w-0"
            value={search}
            // 번호를 하이픈과 함께 붙여 넣어도 찾을 수 있게 숫자만 남긴다.
            onChange={(event) =>
              setSearch(event.target.value.replace(/[^0-9]/g, "").slice(0, 15))
            }
          />
          <Button
            variant="secondary"
            aria-label="현재 필터 링크 복사"
            onClick={() => void copyLink()}
            className="w-(--control-h) px-0"
          >
            {copied ? (
              <Check aria-hidden className="size-4 text-status-approved" />
            ) : (
              <LinkIcon aria-hidden className="size-4" />
            )}
          </Button>
          <span role="status" className="sr-only">
            {copied ? "링크를 복사했어요" : ""}
          </span>
        </div>
      </div>

      {counts && (
        <div
          role="group"
          aria-label="수신자 상태"
          className="flex flex-wrap items-center gap-2"
        >
          {MESSAGE_STATUSES.map((status) => {
            const view = MESSAGE_STATUS_VIEW[status];
            const selected = filters.status.includes(status);
            return (
              <button
                key={status}
                type="button"
                aria-pressed={selected}
                onClick={() => toggleStatus(status)}
                className={cn(
                  "inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-full border px-2.5 text-caption font-bold outline-none focus-visible:ring-2 focus-visible:ring-focus",
                  selected
                    ? "border-primary bg-primary-subtle"
                    : "border-border bg-surface",
                )}
              >
                {selected ? (
                  <Check aria-hidden className="size-3 text-primary" />
                ) : (
                  <StatusIcon tone={view.tone} />
                )}
                {view.label}
                <span className="font-medium text-text-muted">
                  {counts[status].toLocaleString("ko-KR")}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {chips.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
          <span className="text-caption font-bold text-text-muted">적용됨</span>
          {chips.map((chip) => (
            <span
              key={chip.key}
              className="inline-flex h-7 items-center gap-1 rounded-full bg-primary-subtle pl-3 text-caption font-bold text-primary"
            >
              {chip.label}
              <button
                type="button"
                aria-label={`${chip.label} 필터 지우기`}
                onClick={chip.clear}
                className="flex size-6 cursor-pointer items-center justify-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-focus"
              >
                <X aria-hidden className="size-3" />
              </button>
            </span>
          ))}
          <Button
            variant="ghost"
            onClick={state.clearFilters}
            className="h-7 px-2 text-caption text-primary"
          >
            모두 지우기
          </Button>
        </div>
      )}
    </section>
  );
}
