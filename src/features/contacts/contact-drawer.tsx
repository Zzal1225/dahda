"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Drawer } from "@/components/ui/drawer";
import { StatusBadge } from "@/components/ui/status-badge";
import { StatusChip } from "@/components/ui/status-chip";
import { campaignTitle } from "@/features/campaigns/campaign-view";
import { MESSAGE_STATUS_VIEW } from "@/features/messages/message-view";
import { formatPhone } from "@/lib/format";
import { formatKstDate, formatKstDateTime } from "@/lib/kst";
import { deleteContact } from "./actions";
import { ContactDialog } from "./contact-dialogs";
import type { ContactRow, GroupRow } from "./contact-query";
import { GroupChips } from "./contact-table";
import { RECEIVE_STATUS_VIEW } from "./receive-status";
import type { RecentMessage } from "./recent-messages-query";

async function fetchRecent(
  contactId: string,
  signal: AbortSignal,
): Promise<RecentMessage[]> {
  const response = await fetch(`/api/contacts/${contactId}/messages`, {
    signal,
  });
  if (!response.ok) throw new Error(`받은 문자 조회 실패: ${response.status}`);
  return (await response.json()) as RecentMessage[];
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[72px_minmax(0,1fr)] items-start gap-3">
      <dt className="pt-0.5 text-caption font-bold text-text-muted">{label}</dt>
      <dd className="min-w-0 text-body-sm">{children}</dd>
    </div>
  );
}

/**
 * 연락처 상세. 표는 번호를 가리지만 여기서는 전체 번호를 보인다. 한 사람을 골라 연 화면이라 확인이 필요한 때다.
 * 받은 문자는 열 때 읽는다. 표 50행마다 미리 읽으면 쓰지 않을 조회가 50번 생긴다.
 * 고치기·삭제는 지점 담당자만 한다(주소록은 지점 소유, RLS도 같다).
 */
export function ContactDrawer({
  scope,
  contact,
  groups,
  canEdit,
  showBranch,
  onClose,
}: {
  scope: string;
  contact: ContactRow | null;
  groups: readonly GroupRow[];
  canEdit: boolean;
  showBranch: boolean;
  onClose: () => void;
}) {
  const recent = useQuery({
    queryKey: ["contacts", scope, "recent-messages", contact?.id],
    queryFn: ({ signal }) => fetchRecent(contact?.id ?? "", signal),
    enabled: contact !== null,
  });
  const nameOf = new Map(groups.map((group) => [group.id, group.name]));
  const branchGroups = groups.filter(
    (group) => group.branchId === contact?.branchId,
  );

  return (
    <Drawer
      open={contact !== null}
      onOpenChange={(open) => !open && onClose()}
      title={contact?.name ?? "이름 없음"}
      description={
        contact && showBranch ? `${contact.branchName ?? ""} 주소록` : undefined
      }
      footer={
        contact && canEdit ? (
          <>
            <ConfirmDialog
              title="연락처를 삭제할까요?"
              description={`${formatPhone(contact.phone)} 번호를 주소록에서 지워요. 지난 발송 기록은 그대로 남아요.`}
              confirmLabel="삭제"
              onConfirm={async () => {
                const result = await deleteContact(contact.id);
                if (!result) onClose();
                return result;
              }}
              trigger={(open) => (
                <Button variant="ghost" onClick={open} className="mr-auto">
                  삭제
                </Button>
              )}
            />
            <ContactDialog
              contact={contact}
              groups={branchGroups}
              trigger={(open) => <Button onClick={open}>수정</Button>}
            />
          </>
        ) : undefined
      }
    >
      {contact && (
        <>
          <dl className="flex flex-col gap-3">
            <Field label="전화번호">
              <span className="text-mono tabular-nums">
                {formatPhone(contact.phone)}
              </span>
            </Field>
            <Field label="수신 상태">
              <StatusChip {...RECEIVE_STATUS_VIEW[contact.receiveStatus]} />
            </Field>
            <Field label="그룹">
              <GroupChips ids={contact.groupIds} nameOf={nameOf} wrap />
            </Field>
            <Field label="메모">
              {contact.memo ?? <span className="text-text-disabled">—</span>}
            </Field>
            <Field label="등록일">
              <span className="tabular-nums">
                {formatKstDate(contact.createdAt)}
              </span>
            </Field>
          </dl>

          <section aria-label="최근 받은 문자" className="flex flex-col gap-2">
            <h3 className="text-body-sm font-bold">최근 받은 문자</h3>
            {recent.isPending && (
              <div aria-hidden className="flex flex-col gap-2">
                {[0, 1, 2].map((index) => (
                  <div key={index} className="h-14 rounded-md bg-skeleton" />
                ))}
              </div>
            )}
            {recent.isError && (
              <div role="alert" className="flex items-center gap-3">
                <p className="text-body-sm text-text-muted">
                  받은 문자를 불러오지 못했어요
                </p>
                <Button
                  variant="secondary"
                  onClick={() => void recent.refetch()}
                >
                  다시 시도
                </Button>
              </div>
            )}
            {recent.data?.length === 0 && (
              <p className="text-body-sm text-text-muted">
                아직 받은 문자가 없어요
              </p>
            )}
            {recent.data && recent.data.length > 0 && (
              <ol className="flex flex-col">
                {recent.data.map((message) => (
                  <li
                    key={message.id}
                    className="flex flex-col gap-1 border-b border-border py-2.5 last:border-b-0"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-caption text-text-muted tabular-nums">
                        {formatKstDateTime(message.sentAt ?? message.createdAt)}
                      </span>
                      <StatusBadge {...MESSAGE_STATUS_VIEW[message.status]} />
                    </div>
                    <Link
                      href={`/history?campaign=${message.campaignId}`}
                      className="truncate text-body-sm outline-none hover:underline focus-visible:ring-2 focus-visible:ring-focus"
                    >
                      {message.isAd && (
                        <span className="text-text-muted">(광고) </span>
                      )}
                      {campaignTitle(message.body, message.isAd, 32)}
                    </Link>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </>
      )}
    </Drawer>
  );
}
