"use client";

import { ChevronDown } from "lucide-react";
import { useState, useTransition } from "react";
import { ArrowLink } from "@/components/ui/arrow-link";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { addContactsToGroup } from "./actions";
import type { GroupRow } from "./contact-query";

/**
 * 작성 화면으로 넘기는 연락처 수의 상한. id를 주소에 싣는다(uuid 36자 × 200 ≈ 7KB).
 * 주소 길이는 브라우저·프록시마다 제한이 달라 넉넉히 낮게 둔다. 더 많은 사람에게는 그룹으로 보낸다.
 */
export const MAX_COMPOSE_CONTACTS = 200;

export function composeHref(ids: readonly string[]): string {
  return `/compose?contacts=${ids.join(",")}`;
}

/**
 * 표 위에 붙는 선택 막대. 선택이 없으면 그리지 않는다.
 * "그룹에 추가"는 지점 담당자만 있다(그룹은 지점 소유). 본사는 고른 사람에게 문자만 쓴다.
 */
export function SelectionBar({
  selectedIds,
  groups,
  canAddToGroup,
  onClear,
}: {
  selectedIds: ReadonlySet<string>;
  groups: readonly GroupRow[];
  canAddToGroup: boolean;
  onClear: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ text: string; error: boolean }>();
  const ids = [...selectedIds];
  const tooMany = ids.length > MAX_COMPOSE_CONTACTS;

  function addTo(group: GroupRow) {
    setMessage(undefined);
    startTransition(async () => {
      const result = await addContactsToGroup({
        groupId: group.id,
        contactIds: ids,
      });
      setMessage(
        "error" in result
          ? { text: result.error, error: true }
          : {
              text: `${result.added.toLocaleString("ko-KR")}명을 "${group.name}"에 넣었어요${
                result.added < ids.length ? " (이미 있던 사람은 건너뜀)" : ""
              }`,
              error: false,
            },
      );
    });
  }

  return (
    <div
      role="region"
      aria-label="선택한 연락처"
      className="flex min-h-11 flex-wrap items-center gap-x-3 gap-y-1 rounded-md bg-primary-subtle px-4 py-1.5 text-body-sm"
    >
      <b className="tabular-nums">
        {ids.length.toLocaleString("ko-KR")}명 선택
      </b>
      {canAddToGroup && groups.length > 0 && (
        <>
          <span aria-hidden className="text-text-muted">
            ·
          </span>
          <DropdownMenu>
            <DropdownMenuTrigger
              disabled={pending}
              className="flex h-8 cursor-pointer items-center gap-1 rounded-md px-2 font-bold text-primary outline-none hover:bg-surface focus-visible:ring-2 focus-visible:ring-focus disabled:cursor-wait"
            >
              그룹에 추가
              <ChevronDown aria-hidden className="size-3.5" strokeWidth={2} />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="min-w-44">
              <DropdownMenuLabel>어느 그룹에 넣을까요?</DropdownMenuLabel>
              {groups.map((group) => (
                <DropdownMenuItem key={group.id} onSelect={() => addTo(group)}>
                  {group.name}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </>
      )}
      <span aria-hidden className="text-text-muted">
        ·
      </span>
      {tooMany ? (
        <span className="text-text-muted">
          문자 작성은 {MAX_COMPOSE_CONTACTS}명까지 넘길 수 있어요. 더 많으면
          그룹으로 보내 주세요
        </span>
      ) : (
        <ArrowLink href={composeHref(ids)}>문자 작성</ArrowLink>
      )}
      {message && (
        <span
          role={message.error ? "alert" : "status"}
          className={message.error ? "text-danger" : "text-text-muted"}
        >
          {message.text}
        </span>
      )}
      <Button variant="ghost" onClick={onClear} className="ml-auto h-8">
        선택 해제
      </Button>
    </div>
  );
}
