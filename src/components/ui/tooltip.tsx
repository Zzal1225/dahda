"use client";

import { Tooltip as Primitive } from "radix-ui";
import type { ReactNode } from "react";

/**
 * 짧은 보조 설명. title 속성을 쓰지 않는 이유: 키보드 포커스로는 보이지 않고, 나타나기까지 1초 가까이 걸린다.
 * 내용이 꼭 필요한 정보라면 툴팁에만 두지 않는다(메모는 행을 누르면 상세에서도 보인다).
 */
export function Tooltip({
  content,
  children,
}: {
  content: ReactNode;
  /** 포커스를 받을 수 있는 요소여야 한다(버튼 등). */
  children: ReactNode;
}) {
  return (
    <Primitive.Provider delayDuration={150}>
      <Primitive.Root>
        <Primitive.Trigger asChild>{children}</Primitive.Trigger>
        <Primitive.Portal>
          <Primitive.Content
            sideOffset={6}
            className="z-50 max-w-[280px] rounded-md bg-text px-3 py-2 text-caption text-surface shadow-floating"
          >
            {content}
            <Primitive.Arrow className="fill-text" />
          </Primitive.Content>
        </Primitive.Portal>
      </Primitive.Root>
    </Primitive.Provider>
  );
}
