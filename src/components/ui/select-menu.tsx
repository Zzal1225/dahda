"use client";

import { Check, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItemIndicator,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "./dropdown-menu";

export type SelectMenuOption = { value: string; label: string };

/**
 * 고르기 칸. 네이티브 <select>를 쓰지 않는 이유: 펼친 목록의 모양·글꼴을 OS가 정해 토큰을 적용할 수 없고,
 * 역할 전환 메뉴와 같은 화면 안에서 두 가지 목록 모양이 보이게 된다. 키보드 이동·Esc는 Radix 드롭다운이 맡는다.
 *
 * 접근성 이름은 "라벨: 현재 값"이다. 버튼 글자만으로는 무엇을 고르는 칸인지 화면 읽기 도구가 알 수 없다.
 */
export function SelectMenu({
  label,
  value,
  options,
  onChange,
  className,
  align = "start",
}: {
  label: string;
  value: string;
  options: readonly SelectMenuOption[];
  onChange: (value: string) => void;
  className?: string;
  align?: "start" | "end";
}) {
  const current = options.find((option) => option.value === value);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={`${label}: ${current?.label ?? "선택 안 함"}`}
        className={cn(
          "flex h-(--control-h) min-w-0 cursor-pointer items-center justify-between gap-2 rounded-md border border-border-strong bg-surface px-3 text-body-sm outline-none hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-focus",
          className,
        )}
      >
        <span className="truncate">{current?.label ?? label}</span>
        <ChevronDown
          aria-hidden
          className="size-3.5 flex-none text-text-muted"
          strokeWidth={2}
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align={align}
        aria-label={label}
        className="max-h-80 min-w-(--radix-dropdown-menu-trigger-width) overflow-y-auto"
      >
        <DropdownMenuRadioGroup value={value} onValueChange={onChange}>
          {options.map((option) => (
            <DropdownMenuRadioItem
              key={option.value}
              value={option.value}
              className="py-1.5"
            >
              <span className="flex pt-[3px]">
                <DropdownMenuItemIndicator>
                  <Check
                    aria-hidden
                    className="size-3.5 text-primary"
                    strokeWidth={2.6}
                  />
                </DropdownMenuItemIndicator>
              </span>
              <span className="text-body-sm">{option.label}</span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
