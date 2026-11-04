"use client";

import { Store } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatWon, isLowBalance } from "@/lib/format";
import { cn } from "@/lib/utils";
import { BranchAccountDialog, BranchNameDialog } from "./branch-dialogs";
import type { BranchRow } from "./branch-rows";

/**
 * 지점은 많아야 수십 개라 가상화·정렬·필터가 필요 없다. 공통 DataTable은 그 요구가 생기는 step2에서 만들고,
 * 이 표도 그때 옮긴다. 지금 만들면 요구를 모른 채 추상화하게 된다.
 */
export function BranchList({
  rows,
  isTrial,
}: {
  rows: readonly BranchRow[];
  isTrial: boolean;
}) {
  return (
    <>
      <div className="flex items-center justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-title-lg">지점 관리</h1>
          <p className="text-body-sm text-text-muted">
            잔액은 조회만 할 수 있어요. 충전은 지점에서 직접 해요.
          </p>
        </div>
        <BranchNameDialog
          trigger={(open) => <Button onClick={open}>지점 추가</Button>}
        />
      </div>

      {rows.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-lg border border-border bg-surface p-12 text-center">
          <Store
            aria-hidden
            className="size-6 text-text-muted"
            strokeWidth={1.75}
          />
          <p className="text-body-sm text-text-muted">아직 지점이 없어요</p>
          <BranchNameDialog
            trigger={(open) => (
              <Button variant="secondary" onClick={open}>
                첫 지점 추가하기
              </Button>
            )}
          />
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-border bg-surface">
          <table className="w-full text-body-sm">
            <thead>
              <tr className="h-(--row-dense) border-b border-border bg-surface-2 text-left text-caption text-text-muted">
                <th scope="col" className="px-4 font-bold">
                  지점
                </th>
                <th scope="col" className="px-4 font-bold">
                  담당 계정
                </th>
                <th scope="col" className="px-4 text-right font-bold">
                  잔액
                </th>
                <th scope="col" className="px-4 text-right font-bold">
                  <span className="sr-only">작업</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const low = isLowBalance(row.balance);
                return (
                  <tr
                    key={row.id}
                    className="h-(--row-default) border-b border-border last:border-b-0"
                  >
                    <th scope="row" className="px-4 text-left font-bold">
                      {row.name}
                    </th>
                    <td
                      className={cn(
                        "px-4",
                        !row.accountName && "text-text-muted",
                      )}
                    >
                      {row.accountName ?? "미지정"}
                    </td>
                    <td
                      className={cn(
                        "px-4 text-right",
                        low && "font-bold text-status-pending",
                      )}
                    >
                      {low && (
                        <span className="mr-2 text-caption">잔액 적음</span>
                      )}
                      {formatWon(row.balance)}
                    </td>
                    <td className="px-2 py-1 text-right whitespace-nowrap">
                      <BranchNameDialog
                        branch={row}
                        trigger={(open) => (
                          <Button variant="ghost" onClick={open}>
                            이름 변경
                          </Button>
                        )}
                      />
                      {/* 체험 계정은 실제 계정을 만들 수 없다. 서버도 막지만 누르면 실패할 버튼은 보여 주지 않는다. */}
                      {!isTrial && !row.accountName && (
                        <BranchAccountDialog branch={row} />
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
