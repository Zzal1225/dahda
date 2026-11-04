import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

export function Input({ className, ...props }: ComponentProps<"input">) {
  return (
    <input
      className={cn(
        "h-(--control-h) w-full rounded-md border border-border-strong bg-surface px-3 text-body-sm text-text outline-none placeholder:text-text-disabled focus-visible:ring-2 focus-visible:ring-focus aria-invalid:border-danger",
        className,
      )}
      {...props}
    />
  );
}
