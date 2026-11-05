"use client";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { signOut } from "@/features/auth/actions";

// 시안의 로그아웃은 설정 화면에 있다. 어느 화면에서든 바로 나갈 수 있어 아바타 메뉴에도 둔다.
export function AccountMenu({ displayName }: { displayName: string }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label="내 계정"
        className="flex size-8 flex-none cursor-pointer items-center justify-center rounded-full bg-primary-subtle text-caption font-bold text-primary outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2"
      >
        {displayName.slice(0, 1)}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-40">
        <DropdownMenuLabel>{displayName}</DropdownMenuLabel>
        <DropdownMenuItem onSelect={() => void signOut()}>
          로그아웃
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
