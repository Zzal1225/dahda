"use client";

import {
  keepPreviousData,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  previewRetry,
  retryFailedMessages,
} from "@/features/campaigns/retry-actions";
import { formatWon } from "@/lib/format";
import type { TableState } from "./table-state";

/**
 * 선택한 행의 재발송. 대상은 서버가 센다. 화면에는 지금 받아 둔 페이지의 행만 있어서,
 * 스크롤해 넘어간 선택 행의 상태를 알 수 없고, 수신거부와 이미 보낸 번호도 서버만 안다.
 */
export function RetryBar({
  scope,
  campaignId,
  state,
}: {
  scope: string;
  campaignId: string;
  state: TableState;
}) {
  const queryClient = useQueryClient();
  const ids = [...state.selectedIds].sort((a, b) => a - b);

  const { data: preview } = useQuery({
    queryKey: ["retry-preview", scope, campaignId, ids],
    queryFn: () => previewRetry(campaignId, ids),
    placeholderData: keepPreviousData,
    // 재발송하면 대상이 바뀐다. 같은 선택의 옛 결과를 재사용하면 이미 보낸 건에 버튼이 살아 있다.
    staleTime: 0,
    gcTime: 0,
  });

  const target = preview?.target ?? 0;
  if (target === 0) {
    return (
      <Button variant="secondary" disabled>
        재발송할 실패 건 없음
      </Button>
    );
  }

  const excluded = (preview?.failed ?? 0) - target;
  const amount = preview?.amount ?? 0;
  const balance = preview?.balance ?? 0;

  return (
    <ConfirmDialog
      title={`실패 ${target.toLocaleString("ko-KR")}건을 다시 보낼까요?`}
      description={
        // Description이 p라서 안쪽은 span으로 쌓는다.
        <span className="flex flex-col gap-3">
          <span>
            보낸 뒤에는 취소할 수 없어요. 선택한 행 중 실패한 건만 같은 내용으로
            새 발송 건을 만들어 다시 보냅니다.
          </span>
          <span className="flex flex-col gap-1 rounded-md bg-surface-2 p-4 text-text">
            <span>
              재발송 대상 {target.toLocaleString("ko-KR")}건 (선택{" "}
              {ids.length.toLocaleString("ko-KR")}건 중)
            </span>
            <span>
              {preview?.kind.toUpperCase()} · 건당{" "}
              {formatWon(preview?.unitPrice ?? 0)}
            </span>
            <span>예상 차감 {formatWon(amount)}</span>
            <span>발송 후 잔액 {formatWon(balance - amount)}</span>
          </span>
          {excluded > 0 && (
            <span>
              수신거부했거나 이미 다시 보낸 {excluded.toLocaleString("ko-KR")}
              건은 빠져요.
            </span>
          )}
          {(preview?.hopeless ?? 0) > 0 && (
            <span className="font-bold">
              이 중 {preview?.hopeless.toLocaleString("ko-KR")}건은 결번·수신
              거부·스팸 차단이라 다시 보내도 실패할 가능성이 높아요.
            </span>
          )}
        </span>
      }
      confirmLabel={`${target.toLocaleString("ko-KR")}건 재발송`}
      onConfirm={async () => {
        const result = await retryFailedMessages(campaignId, ids);
        if ("error" in result) return result;
        await queryClient.invalidateQueries({ queryKey: ["campaigns"] });
        state.clearSelection();
        state.setCampaign(result.campaignId);
        return undefined;
      }}
      trigger={(open) => (
        <Button variant="danger" onClick={open}>
          실패 {target.toLocaleString("ko-KR")}건 재발송
        </Button>
      )}
    />
  );
}
