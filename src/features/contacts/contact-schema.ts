import { z } from "zod";
import { normalizePhone } from "@/lib/phone";

/**
 * 브라우저 폼과 Server Action이 같은 스키마를 쓴다. 검증 메시지는 여기에만 둔다.
 * transform으로 저장 값을 만들어, 정규화를 빠뜨린 번호가 저장 단계까지 갈 수 없게 한다.
 *
 * 폼이 변환한 값을 서버가 같은 스키마로 다시 검사하므로, 변환 결과도 다시 통과해야 한다.
 * 그래서 비운 값이 null이 되는 항목은 null도 입력으로 받는다.
 */
export const phoneField = z.string().transform((value, context) => {
  const phone = normalizePhone(value);
  if (!phone) {
    context.addIssue({
      code: "custom",
      message: "전화번호 형식을 확인해 주세요",
    });
    return z.NEVER;
  }
  return phone;
});

export const contactSchema = z.object({
  phone: phoneField,
  name: z
    .string()
    .trim()
    .max(30, "이름은 30자까지 쓸 수 있어요")
    .nullable()
    .transform((value) => value || null),
  memo: z
    .string()
    .trim()
    .max(200, "메모는 200자까지 쓸 수 있어요")
    .nullable()
    .transform((value) => value || null),
  // 일시가 아니라 여부만 받는다. 시각은 서버가 정해 사용자가 과거 동의를 꾸며 넣을 수 없게 한다.
  consent: z.boolean().default(false),
  // 체크박스가 하나뿐이면 React Hook Form이 배열 대신 값 하나나 false를 준다. 그룹이 1개인 지점에서 생긴다.
  groupIds: z.preprocess((value) => {
    if (value === false || value === undefined || value === null) return [];
    return Array.isArray(value) ? value : [value];
  }, z.array(z.uuid())),
});
export type ContactFormInput = z.input<typeof contactSchema>;
export type ContactValues = z.output<typeof contactSchema>;

export const groupSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "그룹 이름을 입력해 주세요")
    .max(30, "그룹 이름은 30자까지 쓸 수 있어요"),
});
export type GroupValues = z.output<typeof groupSchema>;

export const optOutSchema = z.object({
  phone: phoneField,
  reason: z
    .string()
    .trim()
    .max(100, "사유는 100자까지 쓸 수 있어요")
    .nullable()
    .transform((value) => value || null),
});
export type OptOutFormInput = z.input<typeof optOutSchema>;
export type OptOutValues = z.output<typeof optOutSchema>;
