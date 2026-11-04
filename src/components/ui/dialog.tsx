"use client";

import { Dialog as Primitive } from "radix-ui";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/utils";

// shadcn/ui 구조를 따른다. 포커스 가두기·Esc·바깥 클릭은 Radix가 맡는다.
export const Dialog = Primitive.Root;
export const DialogClose = Primitive.Close;

export function DialogContent({
  title,
  description,
  className,
  children,
  ...props
}: Omit<ComponentProps<typeof Primitive.Content>, "title"> & {
  title: string;
  description: ReactNode;
}) {
  return (
    <Primitive.Portal>
      <Primitive.Overlay className="fixed inset-0 z-40 bg-overlay" />
      <Primitive.Content
        className={cn(
          "fixed top-1/2 left-1/2 z-50 flex w-[calc(100%-32px)] max-w-[440px] -translate-x-1/2 -translate-y-1/2 flex-col gap-5 rounded-lg bg-surface p-6 shadow-floating outline-none",
          className,
        )}
        {...props}
      >
        <div className="flex flex-col gap-2">
          <Primitive.Title className="text-title">{title}</Primitive.Title>
          <Primitive.Description className="text-body-sm text-text-muted">
            {description}
          </Primitive.Description>
        </div>
        {children}
      </Primitive.Content>
    </Primitive.Portal>
  );
}
