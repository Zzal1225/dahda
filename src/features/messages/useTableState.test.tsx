import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { act, renderHook } from "@testing-library/react";
import { NuqsTestingAdapter, type UrlUpdateEvent } from "nuqs/adapters/testing";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_FILTERS, type TableState } from "./table-state";

/**
 * useTableState.ts는 사용자가 직접 작성한다(CLAUDE.md 5-1). 이 테스트는 그 파일의 계약이다.
 * 파일이 생기기 전에는 건너뛰고, 생기면 자동으로 돌아간다.
 */
const implementation = resolve(
  process.cwd(),
  "src/features/messages/useTableState.ts",
);

const CAMPAIGN_A = "5eed0000-0000-4000-8000-000000000021";
const CAMPAIGN_B = "5eed0000-0000-4000-8000-000000000022";

describe.skipIf(!existsSync(implementation))("useTableState", () => {
  const onUrlUpdate = vi.fn<(event: UrlUpdateEvent) => void>();

  beforeEach(() => {
    onUrlUpdate.mockClear();
  });

  async function setup(searchParams = "") {
    const loaded = (await import(/* @vite-ignore */ implementation)) as {
      useTableState: () => TableState;
    };
    const wrapper = ({ children }: { children: ReactNode }) => (
      <NuqsTestingAdapter
        searchParams={searchParams}
        onUrlUpdate={onUrlUpdate}
        hasMemory
        rateLimitFactor={0}
      >
        {children}
      </NuqsTestingAdapter>
    );
    return renderHook(() => loaded.useTableState(), { wrapper });
  }

  /**
   * 마지막으로 쓴 URL. nuqs는 주소 갱신을 늦춰 처리하므로 한 번 이상 쓸 때까지 기다린다.
   * 기다리지 않으면 빈 문자열을 읽어 "주소에 없다"는 검사가 항상 통과한다.
   */
  async function lastQuery(): Promise<string> {
    await vi.waitFor(() => {
      expect(onUrlUpdate).toHaveBeenCalled();
    });
    return onUrlUpdate.mock.lastCall?.[0].queryString ?? "";
  }

  describe("URL에서 읽기", () => {
    it("쿼리가 없으면 기본값이다", async () => {
      const { result } = await setup();

      expect(result.current.filters).toEqual(DEFAULT_FILTERS);
      expect(result.current).toMatchObject({
        campaign: null,
        page: 1,
        pageSize: 100,
        sort: { column: "sent_at", desc: true },
        activeFilterCount: 0,
      });
      expect(result.current.selectedIds.size).toBe(0);
    });

    it("새로고침해도 모든 필터를 복원한다", async () => {
      const { result } = await setup(
        `?period=30d&branch=b1&ad=ad&state=has_failed&status=failed,sent&q=0101&campaign=${CAMPAIGN_A}&page=3&size=500&sort=finalized_at.asc`,
      );

      expect(result.current.filters).toMatchObject({
        period: "30d",
        branch: "b1",
        ad: "ad",
        state: "has_failed",
        status: ["failed", "sent"],
        q: "0101",
      });
      expect(result.current).toMatchObject({
        campaign: CAMPAIGN_A,
        page: 3,
        pageSize: 500,
        sort: { column: "finalized_at", desc: false },
      });
    });

    it("직접 지정한 기간을 복원한다", async () => {
      const { result } = await setup(
        "?period=custom&from=2026-11-01&to=2026-11-04",
      );

      expect(result.current.filters).toMatchObject({
        period: "custom",
        from: "2026-11-01",
        to: "2026-11-04",
      });
    });

    // 공유 링크나 손으로 고친 주소가 화면을 깨면 안 된다. 잘못된 값은 기본값으로 처리한다.
    it.each([
      ["없는 기간", "?period=1y", { filters: { period: "7d" } }],
      ["없는 광고 값", "?ad=maybe", { filters: { ad: "all" } }],
      ["없는 발송 건 상태", "?state=draft", { filters: { state: null } }],
      ["허용되지 않은 페이지 크기", "?size=1000000", { pageSize: 100 }],
      ["숫자가 아닌 페이지", "?page=abc", { page: 1 }],
      ["0 페이지", "?page=0", { page: 1 }],
      ["음수 페이지", "?page=-3", { page: 1 }],
      ["소수 페이지", "?page=1.5", { page: 1 }],
      [
        "없는 정렬 열",
        "?sort=password.asc",
        { sort: { column: "sent_at", desc: true } },
      ],
      [
        "방향이 틀린 정렬",
        "?sort=sent_at.up",
        { sort: { column: "sent_at", desc: true } },
      ],
    ])("%s는 기본값으로 처리한다", async (_, query, expected) => {
      const { result } = await setup(query);
      expect(result.current).toMatchObject(expected);
    });

    it("상태 목록에서 없는 값만 뺀다", async () => {
      const { result } = await setup("?status=failed,hacked,sent");
      expect(result.current.filters.status).toEqual(["failed", "sent"]);
    });
  });

  describe("URL에 쓰기", () => {
    it("필터를 바꾸면 URL에 남는다", async () => {
      const { result } = await setup();

      await act(async () => {
        result.current.setFilters({ status: ["failed"], q: "0101" });
      });

      expect(result.current.filters.status).toEqual(["failed"]);
      expect(await lastQuery()).toContain("status=failed");
      expect(await lastQuery()).toContain("q=0101");
    });

    it("기본값은 주소에 남기지 않는다", async () => {
      const { result } = await setup("?ad=ad&size=500");

      await act(async () => {
        result.current.setFilters({ ad: "all" });
      });
      await act(async () => {
        result.current.setPageSize(100);
      });

      expect(await lastQuery()).not.toContain("ad=");
      expect(await lastQuery()).not.toContain("size=");
    });

    it("정렬은 column.direction 형식이다", async () => {
      const { result } = await setup();

      await act(async () => {
        result.current.toggleSort("finalized_at");
      });

      expect(await lastQuery()).toContain("sort=finalized_at.desc");
    });
  });

  describe("페이지가 처음으로 돌아가는 경우", () => {
    // 뒤쪽 페이지에서 필터를 좁히면 빈 페이지가 보이는 버그를 막는다.
    it.each<[string, (state: TableState) => void]>([
      ["필터 변경", (s) => s.setFilters({ status: ["failed"] })],
      ["필터 지우기", (s) => s.clearFilters()],
      ["발송 건 변경", (s) => s.setCampaign(CAMPAIGN_B)],
      ["페이지 크기 변경", (s) => s.setPageSize(500)],
      ["정렬 변경", (s) => s.toggleSort("finalized_at")],
    ])("%s", async (_, change) => {
      const { result } = await setup("?page=7");
      expect(result.current.page).toBe(7);

      await act(async () => {
        change(result.current);
      });

      expect(result.current.page).toBe(1);
    });

    it("페이지만 바꾸면 필터는 유지한다", async () => {
      const { result } = await setup("?status=failed");

      await act(async () => {
        result.current.setPage(2);
      });

      expect(result.current.page).toBe(2);
      expect(result.current.filters.status).toEqual(["failed"]);
    });
  });

  describe("선택", () => {
    async function withSelection(searchParams = "") {
      const hook = await setup(searchParams);
      await act(async () => {
        hook.result.current.toggleRow(1);
      });
      await act(async () => {
        hook.result.current.toggleRow(2);
      });
      return hook;
    }

    it("행을 선택하고 다시 누르면 해제한다", async () => {
      const { result } = await withSelection();
      expect([...result.current.selectedIds]).toEqual([1, 2]);

      await act(async () => {
        result.current.toggleRow(1);
      });
      expect([...result.current.selectedIds]).toEqual([2]);
    });

    it("선택은 URL에 남기지 않는다", async () => {
      // 수만 건이 주소에 들어가면 길이 제한을 넘고, 공유 링크로 선택이 옮겨 가면 잘못 재발송할 수 있다.
      await withSelection();
      expect(onUrlUpdate).not.toHaveBeenCalled();
    });

    it("페이지를 넘겨도 선택을 유지한다", async () => {
      const { result } = await withSelection();

      await act(async () => {
        result.current.setPage(2);
      });

      expect(result.current.selectedIds.size).toBe(2);
    });

    // 보이지 않는 행이 선택된 채로 재발송되는 사고를 막는다.
    it.each<[string, (state: TableState) => void]>([
      ["필터 변경", (s) => s.setFilters({ q: "0101" })],
      ["필터 지우기", (s) => s.clearFilters()],
      ["발송 건 변경", (s) => s.setCampaign(CAMPAIGN_B)],
      ["선택 해제", (s) => s.clearSelection()],
    ])("%s 하면 선택을 비운다", async (_, change) => {
      const { result } = await withSelection();

      await act(async () => {
        change(result.current);
      });

      expect(result.current.selectedIds.size).toBe(0);
    });

    it("페이지 전체 선택은 일부만 선택돼 있으면 모두 선택한다", async () => {
      const { result } = await withSelection();

      await act(async () => {
        result.current.togglePage([1, 2, 3]);
      });

      expect([...result.current.selectedIds].sort()).toEqual([1, 2, 3]);
    });

    it("페이지 전체 해제는 다른 페이지의 선택을 건드리지 않는다", async () => {
      const { result } = await setup();
      await act(async () => {
        result.current.togglePage([1, 2]);
      });
      await act(async () => {
        result.current.togglePage([3, 4]);
      });
      await act(async () => {
        result.current.togglePage([3, 4]);
      });

      expect([...result.current.selectedIds].sort()).toEqual([1, 2]);
    });

    it("빈 페이지의 전체 선택은 아무것도 바꾸지 않는다", async () => {
      const { result } = await withSelection();

      await act(async () => {
        result.current.togglePage([]);
      });

      expect(result.current.selectedIds.size).toBe(2);
    });
  });

  describe("정렬", () => {
    it("같은 열은 방향을 뒤집고, 새 열은 내림차순으로 시작한다", async () => {
      const { result } = await setup();

      await act(async () => {
        result.current.toggleSort("sent_at");
      });
      expect(result.current.sort).toEqual({ column: "sent_at", desc: false });

      await act(async () => {
        result.current.toggleSort("finalized_at");
      });
      expect(result.current.sort).toEqual({
        column: "finalized_at",
        desc: true,
      });
    });
  });

  describe("적용된 필터 수와 지우기", () => {
    it("기본값과 다른 항목만 센다", async () => {
      const { result } = await setup("?ad=ad&status=failed,sent&q=010");
      expect(result.current.activeFilterCount).toBe(3);
    });

    it("직접 지정 기간은 하나로 센다", async () => {
      const { result } = await setup(
        "?period=custom&from=2026-11-01&to=2026-11-04",
      );
      expect(result.current.activeFilterCount).toBe(1);
    });

    it("모두 지워도 선택한 발송 건과 페이지 크기는 남는다", async () => {
      const { result } = await setup(
        `?ad=ad&status=failed&campaign=${CAMPAIGN_A}&size=500`,
      );

      await act(async () => {
        result.current.clearFilters();
      });

      expect(result.current.filters).toEqual(DEFAULT_FILTERS);
      expect(result.current.activeFilterCount).toBe(0);
      expect(result.current.campaign).toBe(CAMPAIGN_A);
      expect(result.current.pageSize).toBe(500);
    });
  });
});
