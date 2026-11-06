import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * 결과가 확정됐다는 도장. 첫 화면 진행 목록과 발송 상세의 도착 확인증이 같은 모양을 쓴다.
 * 살짝 기울인 이유: 꽉 찬 막대나 초록 배지보다 "끝났다, 확인됐다"가 먼저 읽힌다. 배지는 상태가 바뀔 수 있는 곳에 쓰고
 * 도장은 다시 바뀌지 않는 결과에만 쓴다(최종 상태는 덮어쓰지 않는다는 규칙과 같은 뜻).
 * 색은 상태 색 delivered 하나만 쓴다. 새 색을 만들지 않으려고 배경을 칠하지 않고 테두리와 글자만 쓴다.
 */
export function StatusStamp({
  children,
  size = "sm",
  className,
}: {
  children: ReactNode;
  /** sm은 목록 한 줄 안, lg는 확인증처럼 블록의 주인공일 때. */
  size?: "sm" | "lg";
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-block flex-none -rotate-[4deg] rounded-sm border-status-delivered font-bold whitespace-nowrap text-status-delivered",
        size === "sm"
          ? "border px-2 py-0.5 text-caption"
          : "border-2 px-3 py-1 text-body-sm",
        className,
      )}
    >
      {children}
    </span>
  );
}
