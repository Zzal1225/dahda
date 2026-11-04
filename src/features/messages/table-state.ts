import type { MessageRow } from "./message-query";

/**
 * useTableState의 계약. 표와 필터 화면은 이 타입만 보고 만든다.
 * 구현(useTableState.ts)은 사용자가 직접 작성한다(CLAUDE.md 5-1).
 */

export const PERIODS = ["today", "7d", "30d", "custom"] as const;
export type Period = (typeof PERIODS)[number];

export const AD_FILTERS = ["all", "ad", "non_ad"] as const;
export type AdFilter = (typeof AD_FILTERS)[number];

export const PAGE_SIZES = [50, 100, 500] as const;
export type PageSize = (typeof PAGE_SIZES)[number];

export const SORT_COLUMNS = ["sent_at", "finalized_at"] as const;
export type SortColumn = (typeof SORT_COLUMNS)[number];
export type TableSort = { column: SortColumn; desc: boolean };

export type TableFilters = {
  period: Period;
  /** period가 custom일 때만 쓴다. YYYY-MM-DD */
  from: string | null;
  to: string | null;
  branch: string | null;
  ad: AdFilter;
  status: MessageRow["status"][];
  q: string;
};

export const DEFAULT_FILTERS: TableFilters = {
  period: "7d",
  from: null,
  to: null,
  branch: null,
  ad: "all",
  status: [],
  q: "",
};
export const DEFAULT_PAGE_SIZE: PageSize = 100;
export const DEFAULT_SORT: TableSort = { column: "sent_at", desc: true };

export type TableState = {
  filters: TableFilters;
  campaign: string | null;
  page: number;
  pageSize: PageSize;
  sort: TableSort;
  selectedIds: ReadonlySet<number>;
  /** "적용됨" 칩의 수. 기본값과 다른 필터 항목만 센다(custom의 from·to는 period 하나로 센다). */
  activeFilterCount: number;

  setFilters: (patch: Partial<TableFilters>) => void;
  clearFilters: () => void;
  setCampaign: (id: string | null) => void;
  setPage: (page: number) => void;
  setPageSize: (size: PageSize) => void;
  toggleSort: (column: SortColumn) => void;
  toggleRow: (id: number) => void;
  /** 현재 페이지 전체 체크박스. 모두 선택돼 있으면 해제하고, 아니면 모두 선택한다. */
  togglePage: (ids: readonly number[]) => void;
  clearSelection: () => void;
};
