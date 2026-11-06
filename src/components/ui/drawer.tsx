"use client";

import { X } from "lucide-react";
import { Dialog as Primitive } from "radix-ui";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * 오른쪽에서 열리는 상세 패널. 대화상자(dialog.tsx)와 같은 Radix Dialog라 포커스 가두기·Esc·바깥 클릭 닫기가 같다.
 * 표 위에 덮지 않고 옆에 붙이는 방식(분할 화면)을 쓰지 않은 이유: 1280px에서 표의 열이 줄어 가로 스크롤이 생긴다.
 * 그림자는 대화상자와 같은 shadow-floating 토큰만 쓴다.
 */
export function Drawer({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <Primitive.Root open={open} onOpenChange={onOpenChange}>
      <Primitive.Portal>
        <Primitive.Overlay className="fixed inset-0 z-40 bg-overlay" />
        <Primitive.Content
          className={cn(
            "fixed top-0 right-0 z-50 flex h-dvh w-full max-w-[420px] flex-col bg-surface shadow-floating outline-none",
          )}
          // 설명이 없을 때 Radix가 경고하지 않게 명시한다.
          {...(description ? {} : { "aria-describedby": undefined })}
        >
          <div className="flex items-start justify-between gap-3 border-b border-border px-6 py-5">
            <div className="flex min-w-0 flex-col gap-1">
              <Primitive.Title className="truncate text-title">
                {title}
              </Primitive.Title>
              {description && (
                <Primitive.Description className="text-body-sm text-text-muted">
                  {description}
                </Primitive.Description>
              )}
            </div>
            <Primitive.Close
              aria-label="닫기"
              className="flex size-8 flex-none cursor-pointer items-center justify-center rounded-md text-text-muted outline-none hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-focus"
            >
              <X aria-hidden className="size-4" strokeWidth={2} />
            </Primitive.Close>
          </div>
          <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto px-6 py-5">
            {children}
          </div>
          {footer && (
            <div className="flex justify-end gap-2 border-t border-border px-6 py-4">
              {footer}
            </div>
          )}
        </Primitive.Content>
      </Primitive.Portal>
    </Primitive.Root>
  );
}
