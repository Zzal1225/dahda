import type { MessageCounts } from "@/features/campaigns/campaign-view";

/** 숫자는 aria-label로 함께 제공한다. 색 막대만으로는 읽을 수 없다. */
export function ProgressBar({
  counts,
  total,
}: {
  counts: MessageCounts;
  total: number;
}) {
  const percent = (count: number) => (total > 0 ? (count / total) * 100 : 0);

  return (
    <div
      role="img"
      aria-label={`도착 ${counts.delivered}건, 확인 중 ${counts.sent}건, 실패 ${counts.failed}건, 대기 ${counts.queued}건`}
      className="flex h-1.5 w-full gap-0.5 overflow-hidden rounded-full bg-surface-2"
    >
      {counts.delivered > 0 && (
        <div
          className="bg-status-delivered transition-[width] duration-800"
          style={{ width: `${percent(counts.delivered)}%` }}
        />
      )}
      {counts.sent > 0 && (
        <div
          className="bg-[repeating-linear-gradient(135deg,var(--st-sent)_0_2px,var(--surface)_2px_4px)]"
          style={{ width: `${percent(counts.sent)}%` }}
        />
      )}
      {counts.failed > 0 && (
        <div
          className="min-w-[3px] bg-status-failed"
          style={{ width: `${percent(counts.failed)}%` }}
        />
      )}
    </div>
  );
}
