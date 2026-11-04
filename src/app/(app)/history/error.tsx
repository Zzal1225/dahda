"use client";

import { Button } from "@/components/ui/button";

export default function HistoryError({ reset }: { reset: () => void }) {
  return (
    <div
      role="alert"
      className="flex flex-col items-center gap-3 rounded-lg border border-border bg-surface p-12 text-center"
    >
      <p className="text-body-sm text-text-muted">
        발송 내역을 불러오지 못했어요
      </p>
      <Button variant="secondary" onClick={reset}>
        다시 시도
      </Button>
    </div>
  );
}
