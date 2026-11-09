"use client";

import { Pencil, Plus, Trash2 } from "lucide-react";
import type { ReactNode } from "react";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { cn } from "@/lib/utils";
import { deleteGroup } from "./actions";
import { GroupDialog } from "./contact-dialogs";
import { OPT_OUT_VIEW, type GroupRow } from "./contact-query";

/**
 * 왼쪽 그룹 목록. "전체 / 각 그룹 / 수신거부"를 한 목록에 둔다.
 * 예전의 "연락처 / 수신거부" 탭을 대신한다. 수신거부도 "누구에게 보내면 안 되는가"라는 사람 묶음이라 그룹 옆에 두는 편이
 * 찾기 쉽고, 탭이 있으면 그룹 고르기와 탭이 두 단계로 나뉘어 지금 무엇을 보는지 헷갈렸다.
 *
 * 선택은 URL(group)에 남는다. 링크가 아니라 버튼인 이유: 같은 화면에서 표만 바뀌는 "고르기"이고,
 * 다른 필터(검색·수신 상태)를 그대로 둔 채 group만 바꿔야 한다.
 */
export function GroupList({
  groups,
  selected,
  counts,
  showBranchName,
  canEdit,
  onSelect,
}: {
  groups: readonly GroupRow[];
  /** null = 전체 */
  selected: string | null;
  counts: { all: number; optOuts: number };
  /** 본사가 지점을 고르지 않았으면 그룹 이름이 지점마다 겹친다. */
  showBranchName: boolean;
  canEdit: boolean;
  onSelect: (group: string | null) => void;
}) {
  return (
    <nav aria-label="그룹" className="flex flex-col gap-1">
      <ul className="flex flex-col gap-0.5">
        <Item
          label="전체"
          count={counts.all}
          active={selected === null}
          onClick={() => onSelect(null)}
        />
        {groups.map((group) => (
          <Item
            key={group.id}
            label={group.name}
            caption={showBranchName ? group.branchName : null}
            count={group.memberCount}
            active={selected === group.id}
            onClick={() => onSelect(group.id)}
            actions={
              canEdit ? (
                <>
                  <GroupDialog
                    group={group}
                    trigger={(open) => (
                      <IconButton
                        label={`${group.name} 이름 바꾸기`}
                        onClick={open}
                      >
                        <Pencil
                          aria-hidden
                          className="size-3.5"
                          strokeWidth={2}
                        />
                      </IconButton>
                    )}
                  />
                  <ConfirmDialog
                    title={`"${group.name}" 그룹을 삭제할까요?`}
                    description="그룹만 지워져요. 연락처는 주소록에 그대로 남아요."
                    confirmLabel="삭제"
                    onConfirm={async () => {
                      const result = await deleteGroup(group.id);
                      if (!result && selected === group.id) onSelect(null);
                      return result;
                    }}
                    trigger={(open) => (
                      <IconButton label={`${group.name} 삭제`} onClick={open}>
                        <Trash2
                          aria-hidden
                          className="size-3.5"
                          strokeWidth={2}
                        />
                      </IconButton>
                    )}
                  />
                </>
              ) : null
            }
          />
        ))}
      </ul>
      <div className="my-2 border-t border-border" />
      <ul>
        <Item
          label="수신거부"
          count={counts.optOuts}
          active={selected === OPT_OUT_VIEW}
          onClick={() => onSelect(OPT_OUT_VIEW)}
        />
      </ul>
      {canEdit && (
        <GroupDialog
          trigger={(open) => (
            <button
              type="button"
              onClick={open}
              className="mt-2 flex h-9 cursor-pointer items-center gap-1.5 rounded-md px-3 text-body-sm font-bold text-primary outline-none hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-focus"
            >
              <Plus aria-hidden className="size-4" strokeWidth={2} />새 그룹
            </button>
          )}
        />
      )}
    </nav>
  );
}

function Item({
  label,
  caption,
  count,
  active,
  onClick,
  actions,
}: {
  label: string;
  caption?: string | null;
  count: number;
  active: boolean;
  onClick: () => void;
  actions?: ReactNode;
}) {
  return (
    <li className="group/item relative">
      <button
        type="button"
        // 인원 숫자는 수정·삭제 아이콘이 나타날 때 숨는다(visibility). 숨으면 접근성 이름에서도 빠지므로 이름을 직접 준다.
        aria-label={`${label}${caption ? ` ${caption}` : ""} ${count.toLocaleString("ko-KR")}명`}
        aria-current={active ? "true" : undefined}
        onClick={onClick}
        className={cn(
          "flex h-9 w-full cursor-pointer items-center gap-2 rounded-md px-3 text-left text-body-sm outline-none hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-focus",
          active &&
            "bg-primary-subtle font-bold text-primary hover:bg-primary-subtle",
        )}
      >
        <span className="min-w-0 truncate">{label}</span>
        {caption && (
          <span className="flex-none text-caption font-medium text-text-muted">
            {caption}
          </span>
        )}
        <span
          className={cn(
            "ml-auto flex-none text-caption tabular-nums",
            active ? "text-primary" : "text-text-muted",
            // 수정·삭제 아이콘이 나타나는 자리와 겹치지 않게 숨긴다.
            actions &&
              "group-focus-within/item:invisible group-hover/item:invisible",
          )}
        >
          {count.toLocaleString("ko-KR")}
        </span>
      </button>
      {actions && (
        // 마우스를 올리거나 키보드로 들어오면 보인다. 늘 보이면 목록이 아이콘으로 어지럽다.
        // display: none이 아니라 투명도로 숨긴다. 숨긴 버튼도 Tab으로 들어올 수 있어야 키보드 사용자가 쓸 수 있다.
        <span className="absolute top-1/2 right-1 flex -translate-y-1/2 items-center opacity-0 group-focus-within/item:opacity-100 group-hover/item:opacity-100">
          {actions}
        </span>
      )}
    </li>
  );
}

function IconButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className="flex size-7 cursor-pointer items-center justify-center rounded-sm text-text-muted outline-none hover:bg-surface hover:text-text focus-visible:ring-2 focus-visible:ring-focus"
    >
      {children}
    </button>
  );
}
