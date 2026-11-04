"use client";

import { DropdownMenu as Primitive } from "radix-ui";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

// shadcn/ui 구조를 따르되 필요한 부품만 옮겼다. 키보드 이동·Esc·바깥 클릭은 Radix가 맡는다.
export const DropdownMenu = Primitive.Root;
export const DropdownMenuTrigger = Primitive.Trigger;
export const DropdownMenuRadioGroup = Primitive.RadioGroup;
export const DropdownMenuItemIndicator = Primitive.ItemIndicator;

export function DropdownMenuContent({
  className,
  sideOffset = 6,
  ...props
}: ComponentProps<typeof Primitive.Content>) {
  return (
    <Primitive.Portal>
      <Primitive.Content
        sideOffset={sideOffset}
        className={cn(
          "z-50 flex flex-col rounded-md border border-border bg-surface p-1 shadow-floating",
          className,
        )}
        {...props}
      />
    </Primitive.Portal>
  );
}

export function DropdownMenuLabel({
  className,
  ...props
}: ComponentProps<typeof Primitive.Label>) {
  return (
    <Primitive.Label
      className={cn(
        "px-3 pt-2 pb-1 text-caption font-bold text-text-muted",
        className,
      )}
      {...props}
    />
  );
}

export function DropdownMenuItem({
  className,
  ...props
}: ComponentProps<typeof Primitive.Item>) {
  return (
    <Primitive.Item
      className={cn(
        "flex h-9 cursor-pointer items-center gap-2 rounded-sm px-3 text-body-sm outline-none data-highlighted:bg-surface-2",
        className,
      )}
      {...props}
    />
  );
}

export function DropdownMenuRadioItem({
  className,
  ...props
}: ComponentProps<typeof Primitive.RadioItem>) {
  return (
    <Primitive.RadioItem
      className={cn(
        "grid cursor-pointer grid-cols-[16px_minmax(0,1fr)] items-start gap-2 rounded-sm px-3 py-2 text-left outline-none data-highlighted:bg-surface-2 data-[state=checked]:bg-primary-subtle",
        className,
      )}
      {...props}
    />
  );
}
