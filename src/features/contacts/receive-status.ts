import type { StatusChipTone } from "@/components/ui/status-chip";

/**
 * 연락처의 수신 상태. DB 열이 아니라 계산값이다(contact_page 함수).
 * 수신거부가 동의보다 앞선다. 동의를 받았어도 거부하면 보내면 안 된다(정보통신망법 제50조).
 * 값 이름은 URL 필터에도 그대로 쓴다.
 */
export const RECEIVE_STATUSES = [
  "consented",
  "not_consented",
  "opted_out",
] as const;
export type ReceiveStatus = (typeof RECEIVE_STATUSES)[number];

export const RECEIVE_STATUS_VIEW: Record<
  ReceiveStatus,
  { label: string; tone: StatusChipTone }
> = {
  consented: { label: "동의", tone: "success" },
  not_consented: { label: "미동의", tone: "warning" },
  opted_out: { label: "수신거부", tone: "danger" },
};

export function isReceiveStatus(value: unknown): value is ReceiveStatus {
  return RECEIVE_STATUSES.some((status) => status === value);
}
