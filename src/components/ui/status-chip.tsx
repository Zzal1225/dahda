import { cn } from "@/lib/utils";

/**
 * 점 + 글자 상태 표시. 한 열 안의 상태는 이것 하나로만 그린다(테두리 배지·굵은 글자·흐린 글자가 섞이면
 * 무엇이 더 중요한지 모양이 다르게 말한다).
 *
 * 토큰: 핸드오프에 success·warning 이름의 토큰이 없어 같은 뜻의 기존 색을 쓴다. 새 색은 만들지 않는다.
 *   success → status-delivered(초록), warning → status-pending(황색), danger → danger(빨강), neutral → text-muted
 */
export type StatusChipTone = "success" | "warning" | "danger" | "neutral";

const TONE: Record<StatusChipTone, { dot: string; text: string }> = {
  success: { dot: "bg-status-delivered", text: "text-status-delivered" },
  warning: { dot: "bg-status-pending", text: "text-status-pending" },
  danger: { dot: "bg-danger", text: "text-danger" },
  neutral: { dot: "bg-text-muted", text: "text-text-muted" },
};

export function StatusChip({
  tone,
  label,
  className,
}: {
  tone: StatusChipTone;
  label: string;
  className?: string;
}) {
  const style = TONE[tone];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 text-caption font-bold whitespace-nowrap",
        style.text,
        className,
      )}
    >
      <span
        aria-hidden
        className={cn("size-1.5 flex-none rounded-full", style.dot)}
      />
      {label}
    </span>
  );
}
