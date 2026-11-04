import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// globals를 끄고 쓰면 Testing Library의 자동 정리가 동작하지 않는다.
// 전역 describe/it에 기대지 않으려고 globals를 끈 대신 여기서 직접 정리한다.
afterEach(() => {
  cleanup();
});
