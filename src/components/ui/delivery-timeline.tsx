import { cn } from "@/lib/utils";
import { StatusIcon } from "./status-badge";

/**
 * 단계의 진행 상태.
 * done: 앞 단계에 남은 건이 없어 이 단계는 더 늘지 않는다.
 * active: 이미 도달한 건이 있고 더 올 수 있다.
 * waiting: 아직 아무도 도달하지 않았고 더 올 수 있다.
 * empty: 끝났는데 한 건도 도달하지 않았다(예: 전부 업체 접수 거절). waiting과 나누지 않으면 영원히 기다리는 것처럼 보인다.
 */
export type TimelineStageState = "done" | "active" | "waiting" | "empty";

export type TimelineStage = {
  key: string;
  label: string;
  /** 단계가 무엇을 세는지 한 줄. 이름만으로는 "통신사 전달"이 무엇을 뜻하는지 알 수 없다. */
  caption: string;
  /** 이미 HH:mm:ss로 바꾼 값. 시간대 변환은 lib/kst.ts 한 곳에서만 한다. 없으면 null. */
  time: string | null;
  count: number;
  state: TimelineStageState;
};

// 색만으로 구분하지 않는다. 상태 배지와 같은 도형(채운 원·빈 원·점선 원)을 쓴다. 새 색을 만들지 않는다.
const STATE_TONE = {
  done: "delivered",
  active: "sent",
  waiting: "idle",
  empty: "idle",
} as const;

const STATE_LABEL: Record<TimelineStageState, string> = {
  done: "끝남",
  active: "진행 중",
  waiting: "대기",
  empty: "해당 없음",
};

/**
 * 가로 단계 표시. 무엇을 셀지는 모른다. 단계 계산은 부르는 쪽의 순수 함수가 하고 여기는 그리기만 한다.
 * 연결선: 다음 단계에 한 건이라도 도달했으면 실선, 아니면 점선. "여기까지 왔다"가 선으로 읽힌다.
 * 숫자는 tabular-nums. 실시간으로 바뀔 때 자릿수 폭이 달라 글자가 흔들리지 않게 한다.
 */
export function DeliveryTimeline({
  stages,
  label,
  className,
}: {
  stages: readonly TimelineStage[];
  /** 목록의 접근성 이름 */
  label: string;
  className?: string;
}) {
  return (
    <ol
      aria-label={label}
      className={cn("grid min-w-0", className)}
      style={{
        gridTemplateColumns: `repeat(${stages.length}, minmax(0, 1fr))`,
      }}
    >
      {stages.map((stage, index) => {
        const next = stages[index + 1];
        const reachedNext =
          next !== undefined &&
          (next.state === "done" || next.state === "active");
        return (
          <li key={stage.key} className="flex min-w-0 flex-col gap-2">
            <div aria-hidden className="flex items-center gap-2 pr-2">
              <span className="flex size-4 flex-none items-center justify-center [&>svg]:size-3.5">
                <StatusIcon tone={STATE_TONE[stage.state]} />
              </span>
              {next !== undefined && (
                <span
                  className={cn(
                    "h-0 flex-1 border-t border-border-strong",
                    !reachedNext && "border-dashed",
                  )}
                />
              )}
            </div>
            <div className="flex min-w-0 flex-col gap-0.5 pr-3">
              <span className="text-body-sm font-bold">
                {stage.label}
                <span className="sr-only"> {STATE_LABEL[stage.state]}</span>
              </span>
              <span className="truncate text-caption text-text-muted">
                {stage.caption}
              </span>
              <span className="text-mono tabular-nums">
                {stage.time ?? (
                  <span className="text-text-disabled">--:--:--</span>
                )}
              </span>
              <span
                className={cn(
                  "text-body-sm font-bold tabular-nums",
                  (stage.state === "waiting" || stage.state === "empty") &&
                    "text-text-muted",
                )}
              >
                {stage.count.toLocaleString("ko-KR")}
                <span className="text-caption font-medium text-text-muted">
                  건
                </span>
              </span>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
