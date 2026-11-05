import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

/**
 * shadcn/ui Button을 복사해 핸드오프 명세로 바꿨다. shadcn의 background·foreground 변수를 거치지 않고
 * 토큰을 바로 쓴다. 이름을 한 번 더 연결하면 토큰 원본에서 화면까지 따라가는 단계만 늘어난다.
 */
export const buttonVariants = cva(
  "inline-flex h-(--control-h) cursor-pointer items-center justify-center gap-2 rounded-md px-4 text-body-sm font-bold whitespace-nowrap outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:bg-surface-2 disabled:text-text-disabled",
  {
    variants: {
      variant: {
        primary:
          "bg-primary text-primary-fg hover:bg-primary-hover active:bg-primary-pressed",
        secondary:
          "border border-border-strong bg-surface text-text hover:bg-surface-2",
        ghost: "bg-transparent text-text hover:bg-surface-2",
        danger:
          "bg-danger text-danger-fg hover:bg-danger-hover active:bg-danger-pressed",
      },
    },
    defaultVariants: { variant: "primary" },
  },
);

export function Button({
  className,
  variant,
  type = "button",
  ...props
}: ComponentProps<"button"> & VariantProps<typeof buttonVariants>) {
  // type 기본값을 button으로 둔다. HTML 기본값 submit은 폼 안의 보조 버튼이 폼을 제출하게 만든다.
  return (
    <button
      type={type}
      className={cn(buttonVariants({ variant }), className)}
      {...props}
    />
  );
}
