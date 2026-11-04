"use client";

import {
  createParser,
  parseAsArrayOf,
  parseAsString,
  parseAsStringLiteral,
  useQueryStates,
} from "nuqs";
import { useCallback, useMemo, useState } from "react";
import { MESSAGE_STATUSES } from "./message-query";
import {
  AD_FILTERS,
  DEFAULT_FILTERS,
  DEFAULT_PAGE_SIZE,
  DEFAULT_SORT,
  PAGE_SIZES,
  PERIODS,
  SORT_COLUMNS,
  type PageSize,
  type SortColumn,
  type TableFilters,
  type TableSort,
  type TableState,
} from "./table-state";

/*
 * 내장 parseAsInteger는 0과 음수, Number는 "1.5"와 "1e9"를 통과시킨다.
 * URL은 사용자가 손으로 고칠 수 있는 입력이라 허용하는 형식만 받고, 나머지는 null(= 기본값)로 돌린다.
 */
const pageParser = createParser<number>({
  parse: (value) => (/^[1-9][0-9]*$/.test(value) ? Number(value) : null),
  serialize: String,
});

const pageSizeParser = createParser<PageSize>({
  parse: (value) => PAGE_SIZES.find((size) => String(size) === value) ?? null,
  serialize: String,
});

const sortParser = createParser<TableSort>({
  parse: (value) => {
    const [column, direction] = value.split(".");
    const known = SORT_COLUMNS.find((candidate) => candidate === column);
    if (!known || (direction !== "asc" && direction !== "desc")) return null;
    return { column: known, desc: direction === "desc" };
  },
  serialize: (sort) => `${sort.column}.${sort.desc ? "desc" : "asc"}`,
  // 객체는 참조로 비교되므로, 없으면 기본값이 주소에 그대로 남는다.
  eq: (a, b) => a.column === b.column && a.desc === b.desc,
});

// 컴포넌트 밖에 두어 렌더마다 새로 만들지 않는다. 키 이름이 곧 공유 링크의 형식이다.
const urlParsers = {
  period: parseAsStringLiteral(PERIODS).withDefault(DEFAULT_FILTERS.period),
  from: parseAsString,
  to: parseAsString,
  branch: parseAsString,
  ad: parseAsStringLiteral(AD_FILTERS).withDefault(DEFAULT_FILTERS.ad),
  status: parseAsArrayOf(parseAsStringLiteral(MESSAGE_STATUSES)).withDefault(
    DEFAULT_FILTERS.status,
  ),
  q: parseAsString.withDefault(DEFAULT_FILTERS.q),
  campaign: parseAsString,
  page: pageParser.withDefault(1),
  size: pageSizeParser.withDefault(DEFAULT_PAGE_SIZE),
  sort: sortParser.withDefault(DEFAULT_SORT),
};

function countActiveFilters(filters: TableFilters): number {
  const changed = [
    // from·to는 period의 일부라 따로 세지 않는다. 칩도 기간 하나로 보인다.
    filters.period !== DEFAULT_FILTERS.period,
    filters.branch !== DEFAULT_FILTERS.branch,
    filters.ad !== DEFAULT_FILTERS.ad,
    filters.status.length > 0,
    filters.q !== DEFAULT_FILTERS.q,
  ];
  return changed.filter(Boolean).length;
}

export function useTableState(): TableState {
  const [url, setUrl] = useQueryStates(urlParsers);

  // 선택은 URL에 넣지 않는다. 수만 건이면 주소 길이를 넘고, 공유 링크로 선택이 옮겨 가면 잘못 재발송할 수 있다.
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<number>>(
    () => new Set(),
  );

  const clearSelection = useCallback(() => setSelectedIds(new Set()), []);

  // 보이는 행이 바뀌는 동작은 선택도 비운다. 보이지 않는 행이 선택된 채 재발송되는 사고를 막는다.
  // 뒤쪽 페이지에서 결과가 줄면 빈 페이지가 보이므로 page도 함께 되돌린다.
  const setFilters = useCallback(
    (patch: Partial<TableFilters>) => {
      void setUrl({ ...patch, page: 1 });
      clearSelection();
    },
    [setUrl, clearSelection],
  );

  const clearFilters = useCallback(() => {
    void setUrl({ ...DEFAULT_FILTERS, page: 1 });
    clearSelection();
  }, [setUrl, clearSelection]);

  const setCampaign = useCallback(
    (id: string | null) => {
      void setUrl({ campaign: id, page: 1 });
      clearSelection();
    },
    [setUrl, clearSelection],
  );

  const setPage = useCallback(
    (page: number) => {
      void setUrl({ page });
    },
    [setUrl],
  );

  const setPageSize = useCallback(
    (size: PageSize) => {
      void setUrl({ size, page: 1 });
    },
    [setUrl],
  );

  const toggleSort = useCallback(
    (column: SortColumn) => {
      void setUrl((current) => ({
        sort:
          current.sort.column === column
            ? { column, desc: !current.sort.desc }
            : { column, desc: true },
        page: 1,
      }));
    },
    [setUrl],
  );

  const toggleRow = useCallback((id: number) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  }, []);

  const togglePage = useCallback((ids: readonly number[]) => {
    setSelectedIds((current) => {
      if (ids.length === 0) return current;
      const next = new Set(current);
      // 다른 페이지의 선택은 건드리지 않는다.
      if (ids.every((id) => next.has(id))) {
        for (const id of ids) next.delete(id);
      } else {
        for (const id of ids) next.add(id);
      }
      return next;
    });
  }, []);

  const filters = useMemo<TableFilters>(
    () => ({
      period: url.period,
      from: url.from,
      to: url.to,
      branch: url.branch,
      ad: url.ad,
      status: url.status,
      q: url.q,
    }),
    [url.period, url.from, url.to, url.branch, url.ad, url.status, url.q],
  );

  return {
    filters,
    campaign: url.campaign,
    page: url.page,
    pageSize: url.size,
    sort: url.sort,
    selectedIds,
    activeFilterCount: countActiveFilters(filters),
    setFilters,
    clearFilters,
    setCampaign,
    setPage,
    setPageSize,
    toggleSort,
    toggleRow,
    togglePage,
    clearSelection,
  };
}
