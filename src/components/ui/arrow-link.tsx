import { ArrowRight } from "lucide-react";
import Link from "next/link";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

/**
 * 다른 화면으로 옮겨 가는 링크. 밑줄 대신 오른쪽 화살표로 "이동"임을 보인다.
 * 규칙: 이동은 이 링크, 그 자리에서 무언가를 하는 동작은 버튼. 둘이 같은 모양이면 누르기 전에 결과를 알 수 없다.
 */
export function ArrowLink({
  className,
  children,
  ...props
}: ComponentProps<typeof Link>) {
  return (
    <Link
      className={cn(
        "inline-flex items-center gap-1 rounded-sm text-body-sm font-bold text-primary outline-none hover:text-primary-hover focus-visible:ring-2 focus-visible:ring-focus",
        className,
      )}
      {...props}
    >
      {children}
      <ArrowRight aria-hidden className="size-4" strokeWidth={2} />
    </Link>
  );
}
