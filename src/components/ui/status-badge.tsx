import type { StatusTone } from "@/features/campaigns/campaign-view";
import { cn } from "@/lib/utils";

const TONE_CLASS: Record<StatusTone, string> = {
  idle: "text-status-idle",
  sent: "text-status-sent",
  delivered: "text-status-delivered",
  failed: "text-status-failed",
  pending: "text-status-pending",
  approved: "text-status-approved",
  rejected: "text-status-rejected",
};

/** 상태는 색만으로 구분하지 않는다(핸드오프). 모양을 함께 쓴다. 도형 값은 핸드오프 표를 그대로 옮겼다. */
export function StatusIcon({ tone }: { tone: StatusTone }) {
  const shared = { fill: "none", stroke: "currentColor" } as const;
  return (
    <svg
      aria-hidden
      viewBox="0 0 10 10"
      className={cn("size-2.5 flex-none", TONE_CLASS[tone])}
    >
      {tone === "idle" && (
        <circle
          {...shared}
          cx="5"
          cy="5"
          r="3.8"
          strokeWidth="1.5"
          strokeDasharray="2 1.6"
        />
      )}
      {tone === "sent" && (
        <circle {...shared} cx="5" cy="5" r="3.6" strokeWidth="1.6" />
      )}
      {tone === "delivered" && (
        <circle cx="5" cy="5" r="4.2" fill="currentColor" />
      )}
      {tone === "failed" && (
        <path
          {...shared}
          d="M2 2l6 6M8 2L2 8"
          strokeWidth="1.8"
          strokeLinecap="round"
        />
      )}
      {tone === "pending" && (
        <>
          <circle {...shared} cx="5" cy="5" r="3.7" strokeWidth="1.4" />
          <path d="M5 1.3A3.7 3.7 0 0 1 5 8.7Z" fill="currentColor" />
        </>
      )}
      {tone === "approved" && (
        <path
          {...shared}
          d="M1.5 5.3L4 7.7l4.5-5"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}
      {tone === "rejected" && (
        <>
          <circle {...shared} cx="5" cy="5" r="3.7" strokeWidth="1.4" />
          <path {...shared} d="M2.4 7.6l5.2-5.2" strokeWidth="1.4" />
        </>
      )}
    </svg>
  );
}

export function StatusBadge({
  tone,
  label,
}: {
  tone: StatusTone;
  label: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex h-6 items-center gap-1.5 rounded-full border border-border bg-surface pr-2.5 pl-2 text-caption font-bold whitespace-nowrap",
        TONE_CLASS[tone],
      )}
    >
      <StatusIcon tone={tone} />
      {label}
    </span>
  );
}
