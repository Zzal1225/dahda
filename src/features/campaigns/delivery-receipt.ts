import type {
  TimelineStage,
  TimelineStageState,
} from "@/components/ui/delivery-timeline";
import { formatKstTime } from "@/lib/kst";

/**
 * campaign_receipt(DB 함수)의 결과. 메시지 상태별 건수, 단계별 첫 건 시각, 결과 웹훅 기록 횟수.
 * 실패를 둘로 나눠 받는다. 업체가 받지도 않은 실패(vendorFailed)와 통신사까지 갔다가 실패한 건(carrierFailed)을
 * 섞으면 "통신사 전달" 건수가 "발송" 건수보다 커질 수 있다.
 */
export type ReceiptTotals = {
  startedAt: string | null;
  completedAt: string | null;
  queued: number;
  /** 업체가 접수했고 결과를 기다리는 건(sent) */
  awaiting: number;
  delivered: number;
  carrierFailed: number;
  vendorFailed: number;
  firstAcceptedAt: string | null;
  firstResultAt: string | null;
  firstDeliveredAt: string | null;
  webhookCount: number;
  /** 이미 확정된 뒤 또는 더 오래된 결과라 상태를 바꾸지 않은 웹훅 */
  webhookIgnored: number;
  /** 결과가 접수 기록보다 먼저 와서 접수가 나중에 시각만 채운 건 */
  acceptedLate: number;
};

export type ReceiptStageKey = "queued" | "accepted" | "carrier" | "delivered";

const time = (value: string | null) => (value ? formatKstTime(value) : null);

function stageState(reached: boolean, finished: boolean): TimelineStageState {
  if (finished) return reached ? "done" : "empty";
  return reached ? "active" : "waiting";
}

/**
 * 네 단계의 건수·시각·상태. 상태 열 하나로는 "업체가 받았다"와 "휴대폰에 닿았다"가 구분되지 않아 단계로 편다.
 *
 * 단계와 데이터의 대응(우리가 실제로 관찰하는 것만 쓴다):
 * - 접수: dahda가 발송 건을 큐에 넣은 때(started_at). 메시지 전체 건수.
 * - 발송: 문자 업체가 받은 건(sent_at이 있는 건 + 결과가 먼저 온 도착 건).
 * - 통신사 전달: 업체가 통신사로 넘겨 결과가 돌아온 건(도착 + 통신사 실패). 업체 접수 거절은 통신사에 가지 않았다.
 *   업체가 통신사로 넘긴 순간 자체는 업체가 알려 주지 않는다. 그래서 "결과가 돌아온 것"을 통신사를 거친 증거로 쓴다.
 * - 도착: 통신사가 휴대폰 도착을 알린 건.
 *
 * 끝남 판단은 건수가 아니라 앞 단계에 남은 건으로 한다. 실패가 빠지므로 "발송 = 접수 건수"로는 영원히 끝나지 않는다.
 * 시각은 첫 건 기준이다(이유는 마이그레이션 20261106000400 주석).
 */
export function receiptStages(totals: ReceiptTotals): TimelineStage[] {
  const total =
    totals.queued +
    totals.awaiting +
    totals.delivered +
    totals.carrierFailed +
    totals.vendorFailed;
  const accepted = totals.awaiting + totals.delivered + totals.carrierFailed;
  const carrier = totals.delivered + totals.carrierFailed;

  const queuedDone = totals.startedAt !== null;
  const acceptedDone = queuedDone && totals.queued === 0;
  const resultDone = acceptedDone && totals.awaiting === 0;

  const stages: (TimelineStage & { key: ReceiptStageKey })[] = [
    {
      key: "queued",
      label: "접수",
      caption: "dahda 발송 큐",
      time: time(totals.startedAt),
      count: queuedDone ? total : 0,
      state: stageState(queuedDone && total > 0, queuedDone),
    },
    {
      key: "accepted",
      label: "발송",
      caption: "문자 업체 접수",
      time: time(totals.firstAcceptedAt),
      count: accepted,
      state: stageState(accepted > 0, acceptedDone),
    },
    {
      key: "carrier",
      label: "통신사 전달",
      caption: "통신사 결과 회신",
      time: time(totals.firstResultAt),
      count: carrier,
      state: stageState(carrier > 0, resultDone),
    },
    {
      key: "delivered",
      label: "도착",
      caption: "휴대폰 도착",
      time: time(totals.firstDeliveredAt),
      count: totals.delivered,
      state: stageState(totals.delivered > 0, resultDone),
    },
  ];
  return stages;
}

/**
 * 결과 웹훅 기록 한 줄. 0인 항목은 쓰지 않는다. 기록이 없으면 null(웹훅 없이 업체 조회로만 확정된 경우 등).
 * 중복·순서 바뀜을 숨기지 않고 센다. "몇 번 왔고 몇 번은 반영하지 않았다"가 멱등 처리의 증거다.
 */
export function webhookSummary(
  totals: Pick<
    ReceiptTotals,
    "webhookCount" | "webhookIgnored" | "acceptedLate"
  >,
): string | null {
  if (totals.webhookCount === 0) return null;
  const parts = [
    `결과 웹훅 ${totals.webhookCount.toLocaleString("ko-KR")}회 수신`,
  ];
  if (totals.webhookIgnored > 0) {
    parts.push(
      `중복·지난 결과 ${totals.webhookIgnored.toLocaleString("ko-KR")}회는 반영 안 함`,
    );
  }
  if (totals.acceptedLate > 0) {
    parts.push(
      `접수 기록보다 먼저 온 결과 ${totals.acceptedLate.toLocaleString("ko-KR")}건`,
    );
  }
  return parts.join(" · ");
}

/** 확인증 번호. uuid 전체는 읽을 수 없어 앞 8자리만 쓴다. 고객 문의에서 발송 건을 찾는 데는 이 정도면 충분하다. */
export function receiptNumber(campaignId: string): string {
  return `No. ${campaignId.replaceAll("-", "").slice(0, 8).toUpperCase()}`;
}
