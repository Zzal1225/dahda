"use client";

import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { formatPhone } from "@/lib/format";
import { formatKstTime } from "@/lib/kst";
import { cn } from "@/lib/utils";
import { failReason } from "./message-view";
import {
  KIND_LABEL,
  OUTCOME_VIEW,
  SOURCE_LABEL,
  toEventViews,
  type MessageEventRow,
} from "./message-events-view";

async function fetchEvents(
  messageId: number,
  signal: AbortSignal,
): Promise<MessageEventRow[]> {
  const response = await fetch(`/api/messages/${messageId}/events`, {
    signal,
  });
  if (!response.ok) throw new Error(`기록 조회 실패: ${response.status}`);
  return (await response.json()) as MessageEventRow[];
}

/**
 * 한 수신자에게 워커·웹훅·업체 조회가 무엇을 했는지 시간순으로 보여 준다.
 * 캐시 키를 수신자 표와 같은 ["messages", scope, campaignId, ...] 아래 둔다. 웹훅이 오면 발송 내역의
 * 무효화가 이 기록도 함께 다시 읽어, 열어 둔 채로 중복 웹훅이 쌓이는 모습이 보인다.
 */
export function MessageEventsDialog({
  scope,
  campaignId,
  message,
  onClose,
}: {
  scope: string;
  campaignId: string;
  message: { id: number; phone: string } | null;
  onClose: () => void;
}) {
  const query = useQuery({
    queryKey: ["messages", scope, campaignId, "events", message?.id],
    queryFn: ({ signal }) => fetchEvents(message?.id ?? 0, signal),
    enabled: message !== null,
  });
  const views = query.data ? toEventViews(query.data) : [];

  return (
    <Dialog open={message !== null} onOpenChange={(open) => !open && onClose()}>
      {message && (
        <DialogContent
          className="max-w-[560px]"
          title={`${formatPhone(message.phone)} 기록`}
          description="받은 순서대로 보여 줘요. 중복으로 온 결과와 순서가 바뀐 결과도 그대로 남기고, 상태는 먼저 확정된 결과를 지켜요."
        >
          {query.isPending && (
            <p className="text-body-sm text-text-muted">불러오는 중</p>
          )}
          {query.isError && (
            <div role="alert" className="flex items-center gap-3">
              <p className="text-body-sm text-text-muted">
                기록을 불러오지 못했어요
              </p>
              <Button variant="secondary" onClick={() => void query.refetch()}>
                다시 시도
              </Button>
            </div>
          )}
          {query.data?.length === 0 && (
            <p className="text-body-sm text-text-muted">
              아직 기록이 없어요. 대기 중이거나 기록을 남기기 전에 보낸
              건이에요.
            </p>
          )}
          {views.length > 0 && (
            <ol aria-label="수신자 기록" className="flex flex-col">
              {views.map((view) => {
                const outcome = OUTCOME_VIEW[view.outcome];
                // 업체 시각과 받은 시각이 1초 넘게 다를 때만 둘 다 쓴다. 매 줄에 두 시각이 있으면 읽기 어렵다.
                const lagged =
                  Math.abs(
                    Date.parse(view.receivedAt) - Date.parse(view.occurredAt),
                  ) > 1000;
                return (
                  <li
                    key={view.id}
                    className="grid grid-cols-[72px_72px_1fr] items-baseline gap-x-3 border-b border-border py-2 text-body-sm last:border-b-0"
                  >
                    <span className="text-mono">
                      {formatKstTime(view.receivedAt)}
                    </span>
                    <span className="text-caption text-text-muted">
                      {SOURCE_LABEL[view.source]}
                    </span>
                    <span className="flex flex-col gap-0.5">
                      <span className="flex flex-wrap items-baseline gap-x-2">
                        <b>{KIND_LABEL[view.kind]}</b>
                        {view.failCode && (
                          <span>
                            <span className="text-mono">{view.failCode}</span>{" "}
                            {failReason(view.failCode)}
                          </span>
                        )}
                        <span
                          className={cn(
                            "text-caption",
                            outcome.muted ? "text-text-muted" : "text-primary",
                          )}
                        >
                          {outcome.label}
                        </span>
                      </span>
                      {(lagged || view.outOfOrder) && (
                        <span className="text-caption text-text-muted">
                          {view.outOfOrder && <b>순서 바뀜 · </b>}
                          업체 시각 {formatKstTime(view.occurredAt)}
                        </span>
                      )}
                    </span>
                  </li>
                );
              })}
            </ol>
          )}
        </DialogContent>
      )}
    </Dialog>
  );
}
