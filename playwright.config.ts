import { defineConfig } from "@playwright/test";

// 다른 프로젝트의 서버가 3000을 쓰고 있으면 E2E_PORT로 옮긴다. reuseExistingServer라 같은 포트면 남의 서버에 붙을 수 있다.
const PORT = Number(process.env.E2E_PORT ?? 3000);
const BASE_URL = `http://127.0.0.1:${PORT}`;

// 개발 서버가 아니라 프로덕션 빌드로 돌린다. Suspense 위반 같은 빌드 오류와 실제 스트리밍 동작을 함께 확인하려는 것이다.
export default defineConfig({
  testDir: "./e2e",
  // 역할 전환은 사용자별 데이터만 바꾸지만, 로컬 Auth의 익명 로그인 횟수 제한이 있어 한 번에 하나씩 돈다.
  workers: 1,
  fullyParallel: false,
  outputDir: "./test-results",
  use: {
    baseURL: BASE_URL,
    viewport: { width: 1280, height: 800 },
    locale: "ko-KR",
    trace: "retain-on-failure",
  },
  webServer: {
    command: `npm run build && npm run start -- --port ${PORT}`,
    url: `${BASE_URL}/login`,
    reuseExistingServer: true,
    timeout: 240_000,
  },
});
