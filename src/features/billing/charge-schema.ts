import { z } from "zod";

/** 직접 입력을 받지 않는다. 버튼 네 개면 금액 검증의 경우의 수가 사라진다. */
export const CHARGE_AMOUNTS = [10_000, 30_000, 50_000, 100_000] as const;

export const chargeAmountSchema = z.coerce
  .number()
  .refine((value) => (CHARGE_AMOUNTS as readonly number[]).includes(value), {
    message: "충전 금액을 선택해 주세요",
  });

/** 토스 규칙: 영문·숫자·-_=, 6~64자. 추측할 수 없게 uuid를 쓴다. */
export function newOrderId(uuid: string): string {
  return `dh-${uuid}`;
}

const KIND_LABEL = {
  charge: "충전",
  reserve: "발송 차감",
  release: "실패분 환불",
  refund: "취소 환불",
} as const;

export function ledgerKindLabel(kind: keyof typeof KIND_LABEL): string {
  return KIND_LABEL[kind];
}

/** 알 수 없는 코드와 토스 message를 그대로 보여 주지 않는다. 주소로 받은 문구라 누구나 꾸며 보낼 수 있다. */
export function chargeResultMessage(
  result: string | undefined,
  code: string | undefined,
): { tone: "success" | "pending" | "error"; text: string } | null {
  if (result === "done") return { tone: "success", text: "충전했어요" };
  if (result === "pending") {
    return {
      tone: "pending",
      text: "결제 결과를 확인하고 있어요. 다시 결제하지 말고 잠시 뒤 새로고침해 주세요",
    };
  }
  if (result !== "failed") return null;
  return {
    tone: "error",
    text:
      code === "PAY_PROCESS_CANCELED"
        ? "결제를 취소했어요"
        : "결제하지 못했어요. 출금되지 않았다면 다시 시도해 주세요",
  };
}
