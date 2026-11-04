"use client";

import { Check, ChevronDown } from "lucide-react";
import { useState, useTransition } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItemIndicator,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { switchTrialRole } from "@/features/auth/actions";
import type { TrialRoleOption } from "@/features/auth/trial-role-options";

// Radix 라디오 값은 빈 값이 될 수 없어 본사 역할(null)을 이 값으로 나타낸다.
const HQ_VALUE = "hq";

export function RoleSwitcher({
  options,
  currentBranchId,
}: {
  options: readonly TrialRoleOption[];
  currentBranchId: string | null;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string>();

  function handleChange(value: string) {
    setError(undefined);
    startTransition(async () => {
      const result = await switchTrialRole(value === HQ_VALUE ? null : value);
      if (result) setError(result.error);
    });
  }

  return (
    <div className="flex items-center gap-2">
      {error && (
        <span role="alert" className="text-caption text-danger">
          {error}
        </span>
      )}
      <DropdownMenu>
        <DropdownMenuTrigger
          disabled={pending}
          className="flex h-(--control-h) cursor-pointer items-center gap-2 rounded-md border border-border-strong bg-surface px-3 text-body-sm font-bold outline-none hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-focus disabled:cursor-wait disabled:text-text-disabled"
        >
          <span className="text-status-pending">체험 중</span>
          <span className="font-medium text-text-muted">·</span>
          역할 전환
          <span className="text-caption text-text-muted">
            {currentBranchId ? "지점" : "본사"}
          </span>
          <ChevronDown
            aria-hidden
            className="size-3.5 text-text-muted"
            strokeWidth={2}
          />
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          aria-label="체험할 역할"
          className="w-[300px]"
        >
          <DropdownMenuLabel>어떤 역할로 둘러볼까요?</DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={currentBranchId ?? HQ_VALUE}
            onValueChange={handleChange}
          >
            {options.map((option) => (
              <DropdownMenuRadioItem
                key={option.branchId ?? HQ_VALUE}
                value={option.branchId ?? HQ_VALUE}
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
                <span className="flex flex-col gap-0.5">
                  <span className="text-body-sm font-bold">{option.label}</span>
                  <span className="text-caption text-text-muted">
                    {option.description}
                  </span>
                </span>
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
