"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent } from "@/components/ui/dialog";
import { approveCampaign, rejectCampaign } from "./approval-actions";

const QUICK_REASONS = [
  "문구 수정이 필요해요",
  "수신 동의 확인이 필요해요",
  "행사 내용을 확인해 주세요",
  "발송 시각을 바꿔 주세요",
];

/** 모바일은 아래에서 올라오는 시트로, PC는 가운데 대화상자로 보여 준다(핸드오프). */
const SHEET_CLASS =
  "top-auto bottom-0 w-full max-w-none translate-y-0 rounded-t-lg rounded-b-none md:top-1/2 md:bottom-auto md:w-[calc(100%-32px)] md:max-w-[440px] md:-translate-y-1/2 md:rounded-lg";

/** 시트 안의 버튼도 손가락으로 누르므로 모바일에서는 터치 높이를 쓴다. */
const TOUCH_CLASS = "h-(--control-h-touch) md:h-(--control-h)";

export function ApprovalDecision({
  campaignId,
  branchName,
  summary,
}: {
  campaignId: string;
  branchName: string;
  summary: readonly (readonly [string, string])[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [mode, setMode] = useState<"approve" | "reject" | null>(null);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string>();

  function open(next: "approve" | "reject") {
    setError(undefined);
    setReason("");
    setMode(next);
  }

  function run(
    action: () => Promise<{ error: string } | undefined>,
    done: string,
  ) {
    setError(undefined);
    startTransition(async () => {
      const result = await action();
      if (result) {
        setError(result.error);
        return;
      }
      router.push(`/approvals?done=${done}`);
    });
  }

  return (
    <>
      {/* 모바일에서는 화면 아래에 고정한다. 실수를 줄이려고 두 버튼 사이를 넓게 둔다(핸드오프). */}
      <div className="fixed inset-x-0 bottom-0 z-30 flex gap-6 border-t border-border bg-surface p-4 md:static md:justify-end md:gap-2 md:border-t-0 md:bg-transparent md:p-0">
        <Button
          variant="secondary"
          className="h-12 flex-1 md:h-(--control-h) md:flex-none"
          onClick={() => open("reject")}
        >
          반려
        </Button>
        <Button
          className="h-12 flex-1 md:h-(--control-h) md:flex-none"
          onClick={() => open("approve")}
        >
          승인
        </Button>
      </div>

      <Dialog
        open={mode === "approve"}
        onOpenChange={(next) => !next && setMode(null)}
      >
        <DialogContent
          className={SHEET_CLASS}
          title={`${branchName} 광고를 승인할까요?`}
          description="승인하면 아래 시각에 발송되고, 승인 후에는 취소할 수 없어요."
        >
          <dl className="flex flex-col gap-1 rounded-md bg-surface-2 p-4 text-body-sm">
            {summary.map(([label, value]) => (
              <div key={label} className="flex justify-between gap-4">
                <dt className="text-text-muted">{label}</dt>
                <dd className="text-right">{value}</dd>
              </div>
            ))}
          </dl>
          {error && (
            <p role="alert" className="text-body-sm text-danger">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <DialogClose asChild>
              <Button variant="ghost" className={TOUCH_CLASS}>
                취소
              </Button>
            </DialogClose>
            <Button
              className={TOUCH_CLASS}
              disabled={pending}
              onClick={() => run(() => approveCampaign(campaignId), "approved")}
            >
              승인하기
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={mode === "reject"}
        onOpenChange={(next) => !next && setMode(null)}
      >
        <DialogContent
          className={SHEET_CLASS}
          title={`${branchName} 광고를 반려할까요?`}
          description={`${branchName}에서 발송 내역으로 사유를 볼 수 있어요. 반려 후에는 되돌릴 수 없어요.`}
        >
          <div className="flex flex-wrap gap-2">
            {QUICK_REASONS.map((quick) => (
              <button
                key={quick}
                type="button"
                onClick={() => setReason(quick)}
                className="h-(--control-h-touch) cursor-pointer rounded-full border border-border-strong px-3 text-caption outline-none hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-focus md:h-9"
              >
                {quick}
              </button>
            ))}
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="reject-reason" className="text-body-sm font-bold">
              반려 사유
            </label>
            <textarea
              id="reject-reason"
              value={reason}
              maxLength={200}
              onChange={(event) => setReason(event.target.value)}
              className="h-[88px] resize-none rounded-md border border-border-strong bg-surface p-3 text-body-sm outline-none focus-visible:ring-2 focus-visible:ring-focus"
            />
          </div>
          {error && (
            <p role="alert" className="text-body-sm text-danger">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <DialogClose asChild>
              <Button variant="ghost" className={TOUCH_CLASS}>
                취소
              </Button>
            </DialogClose>
            {/* 실패가 아니므로 danger가 아니다(핸드오프). */}
            <Button
              variant="secondary"
              className={TOUCH_CLASS}
              disabled={pending}
              onClick={() =>
                run(() => rejectCampaign(campaignId, reason), "rejected")
              }
            >
              반려하기
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
