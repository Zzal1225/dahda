import { z } from "zod";
import { normalizePhone } from "@/lib/phone";

/**
 * 휴대전화만 받는다. 유선·대표번호는 문자를 받지 못해 한 번뿐인 기회와 돈만 쓴다.
 * 번호의 주인인지는 확인할 수 없다. 인증 문자도 결국 그 번호로 문자를 보내는 일이라 위험이 줄지 않는다.
 * 그래서 동의 확인과 고정 본문, 번호당 1회, 전체 상한으로 피해 범위를 막는다.
 */
export function demoRecipient(input: string): string | null {
  const phone = normalizePhone(input);
  return phone?.startsWith("01") ? phone : null;
}

export const demoSmsSchema = z.object({
  phone: z.string().refine((value) => demoRecipient(value) !== null, {
    error: "휴대전화 번호를 확인해 주세요",
  }),
  consent: z.boolean().refine((value) => value, {
    error: "본인 번호로 받는 데 동의해 주세요",
  }),
});

export type DemoSmsInput = z.infer<typeof demoSmsSchema>;
