import { defineConfig } from "@playwright/test";

// 개발 서버가 아니라 프로덕션 빌드로 돌린다. Suspense 위반 같은 빌드 오류와 실제 스트리밍 동작을 함께 확인하려는 것이다.
export default defineConfig({
  testDir: "./e2e",
  // 역할 전환은 사용자별 데이터만 바꾸지만, 로컬 Auth의 익명 로그인 횟수 제한이 있어 한 번에 하나씩 돈다.
  workers: 1,
  fullyParallel: false,
  outputDir: "./test-results",
  use: {
    baseURL: "http://127.0.0.1:3000",
    viewport: { width: 1280, height: 800 },
    locale: "ko-KR",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "npm run build && npm run start",
    url: "http://127.0.0.1:3000/login",
    reuseExistingServer: true,
    timeout: 240_000,
  },
});
