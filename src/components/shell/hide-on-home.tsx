"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

/**
 * 첫 화면에서는 상단 바 잔액을 숨긴다. 첫 화면에 잔액 칸이 있어 같은 숫자가 두 번 보인다.
 * 다른 화면에서는 남긴다. 문자 작성·발송 내역에서 잔액을 보려고 첫 화면까지 돌아오게 하지 않기 위해서다.
 * 상단 바는 서버 컴포넌트라 경로를 모르므로 이 부분만 클라이언트에서 판단한다.
 */
export function HideOnHome({ children }: { children: ReactNode }) {
  return usePathname() === "/" ? null : children;
}
