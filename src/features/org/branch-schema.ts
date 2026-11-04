import { z } from "zod";

// 브라우저 폼과 Server Action이 같은 스키마를 쓴다. 검증 메시지는 여기에만 둔다.
export const branchNameSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "지점 이름을 입력해 주세요")
    .max(30, "지점 이름은 30자까지 쓸 수 있어요"),
});
export type BranchNameInput = z.infer<typeof branchNameSchema>;

export const branchAccountSchema = z.object({
  displayName: z
    .string()
    .trim()
    .min(1, "담당자 이름을 입력해 주세요")
    .max(30, "담당자 이름은 30자까지 쓸 수 있어요"),
  email: z.email("이메일 형식을 확인해 주세요"),
  // 로그인과 달리 새 비밀번호를 만드는 단계라 길이 규칙을 둔다.
  password: z.string().min(8, "비밀번호는 8자 이상이어야 해요"),
});
export type BranchAccountInput = z.infer<typeof branchAccountSchema>;
