import { formatPhone } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * 받는 사람 화면 미리보기. 작성 화면과 승인 화면이 같은 모양을 봐야 승인자가 본 것이 곧 작성자가 본 것이다.
 * 크기만 다르다. 시안이 작성 화면은 300×600, 모바일 승인 상세는 264×480으로 정했다.
 */
export function PhonePreview({
  sender,
  caption,
  body,
  testId,
  className,
}: {
  sender: string;
  caption: string;
  body: string;
  testId: string;
  className: string;
}) {
  return (
    <div className={cn("mx-auto rounded-[44px] bg-text p-2.5", className)}>
      <div className="flex h-full flex-col gap-3 overflow-y-auto rounded-[34px] bg-surface p-4">
        <div className="flex flex-col items-center gap-1 border-b border-border pb-3">
          <span className="flex size-10 items-center justify-center rounded-full bg-surface-2 text-caption">
            발신
          </span>
          <span className="text-caption">{formatPhone(sender)}</span>
        </div>
        <span className="text-center text-caption text-text-muted">
          {caption}
        </span>
        <p
          data-testid={testId}
          className="max-w-[200px] rounded-[18px_18px_18px_4px] bg-surface-2 px-3.5 py-2.5 text-body-sm break-words whitespace-pre-wrap"
        >
          {body}
        </p>
      </div>
    </div>
  );
}
