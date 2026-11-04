import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import Home from "./page";

// 화면 내용보다 JSX 변환·jsdom·matcher 설정이 함께 동작하는지 확인하는 테스트다.
// 이 페이지를 로그인 화면으로 바꿀 때(1-4) 함께 교체한다.
describe("첫 화면", () => {
  it("서비스 이름을 제목으로 보여 준다", () => {
    render(<Home />);
    expect(screen.getByRole("heading", { name: "dahda" })).toBeInTheDocument();
  });
});
