import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  resolve: {
    // tsconfig의 "@/*"와 같은 규칙. 별칭 플러그인을 더 들이지 않으려고 한 줄로 맞춘다.
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "server-only": fileURLToPath(
        new URL("./src/test/server-only-stub.ts", import.meta.url),
      ),
    },
  },
  test: {
    // 상태 전이·금액 계산은 DOM이 필요 없지만, 파일마다 환경을 고르는 실수를 없애려고 jsdom으로 통일한다.
    // 측정해서 느려지면 그때 순수 로직만 node 환경으로 나눈다.
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.test.{ts,tsx}", "supabase/seed/**/*.test.ts"],
    // RLS 통합 테스트는 실제 DB가 필요해 별도 설정으로 돌린다(1-2). 단위 테스트는 항상 DB 없이 돌아야 한다.
    exclude: ["src/**/*.integration.test.{ts,tsx}"],
  },
});
