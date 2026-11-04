"use client";

import { AlertDialog as Primitive } from "radix-ui";
import { useState, useTransition, type ReactNode } from "react";
import { Button } from "@/components/ui/button";

/**
 * 되돌리기 어려운 동작의 확인 대화상자(CLAUDE.md 규칙).
 * 실패하면 닫지 않고 사유를 보여 준다. 닫으면 처리된 줄로 오해한다.
 */
export function ConfirmDialog({
  trigger,
  title,
  description,
  confirmLabel,
  onConfirm,
}: {
  trigger: (open: () => void) => ReactNode;
  title: string;
  description: ReactNode;
  confirmLabel: string;
  onConfirm: () => Promise<{ error: string } | undefined>;
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string>();

  function confirm() {
    setError(undefined);
    startTransition(async () => {
      const result = await onConfirm();
      if (result) setError(result.error);
      else setOpen(false);
    });
  }

  return (
    <>
      {trigger(() => {
        setError(undefined);
        setOpen(true);
      })}
      <Primitive.Root open={open} onOpenChange={setOpen}>
        <Primitive.Portal>
          <Primitive.Overlay className="fixed inset-0 z-40 bg-overlay" />
          <Primitive.Content className="fixed top-1/2 left-1/2 z-50 flex w-[calc(100%-32px)] max-w-[440px] -translate-x-1/2 -translate-y-1/2 flex-col gap-5 rounded-lg bg-surface p-6 shadow-floating outline-none">
            <div className="flex flex-col gap-2">
              <Primitive.Title className="text-title">{title}</Primitive.Title>
              <Primitive.Description className="text-body-sm text-text-muted">
                {description}
              </Primitive.Description>
            </div>
            {error && (
              <p role="alert" className="text-body-sm text-danger">
                {error}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <Primitive.Cancel asChild>
                <Button variant="secondary">취소</Button>
              </Primitive.Cancel>
              <Button variant="danger" disabled={pending} onClick={confirm}>
                {confirmLabel}
              </Button>
            </div>
          </Primitive.Content>
        </Primitive.Portal>
      </Primitive.Root>
    </>
  );
}
