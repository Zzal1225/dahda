import { z } from "zod";

// 브라우저 폼과 Server Action이 같은 스키마를 쓴다. 브라우저 검증은 건너뛸 수 있어 서버에서 다시 검사한다.
// 비밀번호 규칙은 넣지 않는다. 로그인은 "규칙에 맞는가"가 아니라 "맞는 비밀번호인가"를 보는 단계이고,
// 길이 규칙을 안내하면 공격자에게 후보 범위만 알려 준다.
export const loginSchema = z.object({
  email: z.email("이메일 형식을 확인해 주세요"),
  password: z.string().min(1, "비밀번호를 입력해 주세요"),
});

export type LoginInput = z.infer<typeof loginSchema>;
