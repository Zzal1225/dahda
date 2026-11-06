"use client";

import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { DeliveryTimeline } from "@/components/ui/delivery-timeline";
import { StatusStamp } from "@/components/ui/status-stamp";
import { formatKstTime } from "@/lib/kst";
import { isFullyDelivered, type CampaignRow } from "./campaign-view";
import {
  receiptNumber,
  receiptStages,
  webhookSummary,
  type ReceiptTotals,
} from "./delivery-receipt";

async function fetchReceipt(
  campaignId: string,
  signal: AbortSignal,
): Promise<ReceiptTotals> {
  const response = await fetch(`/api/campaigns/${campaignId}/receipt`, {
    signal,
  });
  if (!response.ok)
    throw new Error(`도착 확인증 조회 실패: ${response.status}`);
  return (await response.json()) as ReceiptTotals;
}

/**
 * 발송 상세 맨 위의 "도착 확인증". 문자는 보낸 순간이 아니라 도착이 확인된 순간에 끝난다는 이 콘솔의 주장을 한 블록으로 보인다.
 * 영수증처럼 위아래 점선으로 끊는다. 카드 그림자·배경색을 쓰지 않아 새 색 없이 "따로 떼어 볼 수 있는 증서"로 읽힌다.
 *
 * 캐시 키를 수신자 표와 같은 ["messages", scope, campaignId, ...] 아래 둔다. 웹훅이 올 때 발송 내역이 하는 무효화가
 * 이 집계도 함께 다시 읽어, 따로 구독하지 않아도 진행 중에 숫자가 따라 움직인다.
 * 도장은 첫 화면과 같은 isFullyDelivered로 판단한다. 집계 함수 결과로 따로 판단하면 두 화면이 잠깐 다르게 말할 수 있다.
 */
export function DeliveryReceiptCard({
  scope,
  campaign,
}: {
  scope: string;
  campaign: Pick<
    CampaignRow,
    "id" | "status" | "recipientCount" | "deliveredCount"
  >;
}) {
  const query = useQuery({
    queryKey: ["messages", scope, campaign.id, "receipt"],
    queryFn: ({ signal }) => fetchReceipt(campaign.id, signal),
  });
  const receipt = query.data;
  const summary = receipt ? webhookSummary(receipt) : null;
  const delivered = isFullyDelivered(campaign);

  return (
    <section
      aria-label="도착 확인증"
      className="mx-5 mb-4 flex flex-col gap-4 border-y border-dashed border-border-strong py-4"
    >
      <div className="flex items-baseline justify-between gap-4">
        <div className="flex items-baseline gap-2">
          <h3 className="text-body-sm font-bold">도착 확인증</h3>
          <span className="text-caption text-text-muted">
            시각은 단계마다 첫 건 기준
          </span>
        </div>
        <span className="text-mono text-text-muted tabular-nums">
          {receiptNumber(campaign.id)}
        </span>
      </div>

      {query.isPending && (
        <div aria-hidden className="h-[104px] rounded-sm bg-skeleton" />
      )}

      {query.isError && (
        <div role="alert" className="flex items-center gap-3">
          <p className="text-body-sm text-text-muted">
            도착 확인증을 불러오지 못했어요
          </p>
          <Button variant="secondary" onClick={() => void query.refetch()}>
            다시 시도
          </Button>
        </div>
      )}

      {receipt && (
        <div className="flex items-center gap-6">
          <DeliveryTimeline
            label="발송 단계"
            stages={receiptStages(receipt)}
            className="flex-1"
          />
          {delivered && (
            <div className="flex flex-none flex-col items-center gap-2 pr-2">
              <StatusStamp size="lg">도착 확인</StatusStamp>
              <span className="text-caption text-text-muted tabular-nums">
                {campaign.recipientCount.toLocaleString("ko-KR")}명 모두 도착
              </span>
            </div>
          )}
        </div>
      )}

      {receipt && (
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-t border-dashed border-border pt-3 text-caption text-text-muted tabular-nums">
          <span>
            {receipt.completedAt
              ? `결과 확정 ${formatKstTime(receipt.completedAt)}`
              : "결과 확인 중 · 확정되면 숫자가 더 바뀌지 않아요"}
          </span>
          {summary && <span>{summary}</span>}
        </div>
      )}
    </section>
  );
}
