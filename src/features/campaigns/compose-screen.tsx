"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useQueryClient } from "@tanstack/react-query";
import { Lock } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  useEffect,
  useMemo,
  useState,
  useTransition,
  type ReactNode,
} from "react";
import { useForm } from "react-hook-form";
import { PhonePreview } from "./phone-preview";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import { formatPhone, formatWon } from "@/lib/format";
import { kstDayOptions, kstDayTimeToUtc, kstTimeOptions } from "@/lib/kst";
import { cn } from "@/lib/utils";
import {
  previewRecipients,
  searchContactOptions,
  submitCampaign,
  type ContactOption,
  type RecipientSummary,
} from "./actions";
import {
  adPrefix,
  campaignSchema,
  deriveMessage,
  isNightKst,
  LMS_MAX_BYTES,
  MAX_SCHEDULE_DAYS,
  SMS_MAX_BYTES,
  UNIT_PRICE,
  type CampaignInput,
} from "./campaignSchema";

export type GroupOption = {
  id: string;
  name: string;
  branchName: string | null;
  memberCount: number;
};
export type SenderOption = {
  id: string;
  number: string;
  label: string;
  isDefault: boolean;
};

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset className="flex min-w-0 flex-col gap-3 border-t border-border p-6 first:border-t-0">
      <legend className="float-left mb-3 w-full text-title">{title}</legend>
      {children}
    </fieldset>
  );
}

function FieldError({ message }: { message: string | undefined }) {
  if (!message) return null;
  return <p className="text-caption text-danger">{message}</p>;
}

export function ComposeScreen({
  groups,
  senders,
  balance,
  senderName,
  optOutSuffix,
  isBranch,
  initialContactIds = [],
}: {
  groups: readonly GroupOption[];
  senders: readonly SenderOption[];
  balance: number;
  senderName: string;
  optOutSuffix: string;
  isBranch: boolean;
  /** 주소록에서 고른 사람(?contacts=). 받는 사람에 미리 넣는다. */
  initialContactIds?: readonly string[];
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [pending, startTransition] = useTransition();
  const [submitError, setSubmitError] = useState<string>();
  const [confirming, setConfirming] = useState(false);
  const [recipientTab, setRecipientTab] = useState<"group" | "contact">(
    initialContactIds.length > 0 ? "contact" : "group",
  );
  const [summary, setSummary] = useState<RecipientSummary | null>(null);
  const [contactQuery, setContactQuery] = useState("");
  const [contactOptions, setContactOptions] = useState<ContactOption[]>([]);

  const defaultSender =
    senders.find((sender) => sender.isDefault) ?? senders[0];
  // 화면을 열 때 한 번 만든다. 두 번 눌러도, 응답이 끊겨 다시 눌러도 같은 요청으로 처리된다.
  const [clientRequestId] = useState(() => crypto.randomUUID());
  const [now] = useState(() => new Date());
  const dayOptions = useMemo(
    () => kstDayOptions(now, MAX_SCHEDULE_DAYS + 1),
    [now],
  );
  const timeOptions = useMemo(() => kstTimeOptions(), []);

  const [senderForParts, setSenderForParts] = useState(
    defaultSender?.number ?? "",
  );
  const parts = useMemo(
    () => ({
      prefix: adPrefix(senderName, formatPhone(senderForParts)),
      suffix: optOutSuffix,
    }),
    [senderName, senderForParts, optOutSuffix],
  );

  const schema = useMemo(
    () => campaignSchema({ ...parts, now: () => new Date() }),
    [parts],
  );

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors, isValid },
  } = useForm<CampaignInput>({
    resolver: zodResolver(schema),
    mode: "onChange",
    defaultValues: {
      clientRequestId,
      groupIds: [],
      contactIds: [...initialContactIds],
      isAd: false,
      body: "",
      senderId: defaultSender?.id ?? "",
      sendMode: "now",
      scheduledDay: dayOptions[0]?.value ?? "",
      scheduledTime: "",
    },
  });

  const groupIds = watch("groupIds");
  const contactIds = watch("contactIds");
  const isAd = watch("isAd");
  const body = watch("body");
  const senderId = watch("senderId");
  const sendMode = watch("sendMode");
  const scheduledDay = watch("scheduledDay");
  const scheduledTime = watch("scheduledTime");

  useEffect(() => {
    const number = senders.find((sender) => sender.id === senderId)?.number;
    if (number) setSenderForParts(number);
  }, [senderId, senders]);

  const message = deriveMessage({ body, isAd }, parts);
  const fixedBytes = isAd
    ? message.bytes - deriveMessage({ body, isAd: false }, parts).bytes
    : 0;

  // 선택이 바뀔 때마다 서버에서 실제 수신자 수를 다시 센다. 저장과 같은 계산이어야 숫자를 믿을 수 있다.
  const selectionKey = JSON.stringify([groupIds, contactIds, isAd]);
  useEffect(() => {
    let current = true;
    const timer = setTimeout(() => {
      if (groupIds.length === 0 && contactIds.length === 0) {
        if (current) setSummary(null);
        return;
      }
      void previewRecipients({ groupIds, contactIds, isAd }).then((result) => {
        if (current && !("error" in result)) setSummary(result);
      });
    }, 200);
    return () => {
      current = false;
      clearTimeout(timer);
    };
    // groupIds·contactIds는 내용이 같아도 새 배열이라 문자열로 비교한다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectionKey]);

  useEffect(() => {
    if (recipientTab !== "contact") return;
    let current = true;
    const timer = setTimeout(() => {
      void searchContactOptions(contactQuery).then((options) => {
        if (current) setContactOptions(options);
      });
    }, 300);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [contactQuery, recipientTab]);

  const total = summary?.total ?? 0;
  const cost = total * message.unitPrice;
  const needsApproval = isAd && isBranch;
  const shortage = !needsApproval && cost > balance ? cost - balance : 0;
  const noRecipients =
    groupIds.length + contactIds.length > 0 && summary?.total === 0;
  const canSubmit = isValid && total > 0 && shortage === 0 && !pending;

  const buttonLabel = needsApproval
    ? "승인 요청"
    : sendMode === "scheduled"
      ? "예약하기"
      : "보내기";

  const scheduledAt =
    sendMode === "scheduled"
      ? kstDayTimeToUtc(scheduledDay, scheduledTime)
      : null;
  const whenText = scheduledAt
    ? `${scheduledDay.replace(/-/g, ".")} ${scheduledTime} KST`
    : "지금";

  function toggleIn(
    field: "groupIds" | "contactIds",
    current: readonly string[],
    id: string,
  ) {
    setValue(
      field,
      current.includes(id)
        ? current.filter((item) => item !== id)
        : [...current, id],
      { shouldValidate: true, shouldDirty: true },
    );
  }

  function submit(values: CampaignInput) {
    setSubmitError(undefined);
    startTransition(async () => {
      const result = await submitCampaign(values);
      if ("error" in result) {
        setConfirming(false);
        setSubmitError(result.error);
        return;
      }
      // 발송 내역을 먼저 봤다면 캐시된 목록에 새 건이 없어 선택한 건이 열리지 않는다.
      await queryClient.invalidateQueries({ queryKey: ["campaigns"] });
      router.push(`/history?campaign=${result.campaignId}`);
    });
  }

  return (
    <div className="grid grid-cols-1 gap-8 xl:grid-cols-[minmax(0,1fr)_300px]">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          setConfirming(true);
        }}
        noValidate
        className="flex min-w-0 flex-col"
      >
        <div className="flex flex-col rounded-lg border border-border bg-surface">
          <Section title="받는 사람">
            <Segmented
              label="받는 사람 고르는 방법"
              value={recipientTab}
              options={[
                { value: "group", label: "그룹 선택" },
                { value: "contact", label: "주소록에서 선택" },
              ]}
              onChange={setRecipientTab}
            />

            {recipientTab === "group" &&
              (groups.length === 0 ? (
                <p className="text-body-sm text-text-muted">
                  아직 그룹이 없어요. 주소록에서 그룹을 만들어 주세요.
                </p>
              ) : (
                <ul aria-label="받는 그룹" className="flex flex-col">
                  {groups.map((group) => (
                    <li key={group.id}>
                      <label className="flex min-h-11 cursor-pointer items-center gap-3 border-b border-border text-body-sm last:border-b-0">
                        <input
                          type="checkbox"
                          className="size-4 accent-primary"
                          checked={groupIds.includes(group.id)}
                          onChange={() =>
                            toggleIn("groupIds", groupIds, group.id)
                          }
                        />
                        <span className="font-bold">{group.name}</span>
                        {group.branchName && (
                          <span className="text-caption text-text-muted">
                            {group.branchName}
                          </span>
                        )}
                        <span className="ml-auto text-text-muted">
                          {group.memberCount.toLocaleString("ko-KR")}명
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
              ))}

            {recipientTab === "contact" && (
              <div className="flex flex-col gap-2">
                {/* 주소록에서 고른 사람은 검색 목록에 안 보일 수 있다. 몇 명이 들어 있는지와 비우는 방법을 보인다. */}
                {contactIds.length > 0 && (
                  <div className="flex items-center justify-between gap-3 rounded-md bg-primary-subtle px-3 py-2 text-body-sm">
                    <span>
                      고른 연락처{" "}
                      <b className="tabular-nums">
                        {contactIds.length.toLocaleString("ko-KR")}명
                      </b>
                    </span>
                    <Button
                      variant="ghost"
                      className="h-8"
                      onClick={() =>
                        setValue("contactIds", [], {
                          shouldValidate: true,
                          shouldDirty: true,
                        })
                      }
                    >
                      모두 빼기
                    </Button>
                  </div>
                )}
                <Input
                  type="search"
                  aria-label="받는 사람 검색"
                  placeholder="이름 또는 번호 검색"
                  value={contactQuery}
                  onChange={(event) => setContactQuery(event.target.value)}
                />
                <ul className="flex max-h-64 flex-col overflow-y-auto">
                  {contactOptions.map((contact) => (
                    <li key={contact.id}>
                      <label
                        className={cn(
                          "flex h-9 items-center gap-3 text-body-sm",
                          contact.optedOut
                            ? "text-text-disabled"
                            : "cursor-pointer",
                        )}
                      >
                        <input
                          type="checkbox"
                          className="size-4 accent-primary"
                          disabled={contact.optedOut}
                          checked={contactIds.includes(contact.id)}
                          onChange={() =>
                            toggleIn("contactIds", contactIds, contact.id)
                          }
                        />
                        <span className="w-24 truncate">
                          {contact.name ?? "—"}
                        </span>
                        <span className="text-mono">
                          {formatPhone(contact.phone)}
                        </span>
                        {contact.optedOut && (
                          <span className="text-caption font-bold text-danger">
                            수신거부
                          </span>
                        )}
                      </label>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div
              role="status"
              className={cn(
                "rounded-md px-4 py-3 text-body-sm",
                noRecipients ? "bg-danger-subtle text-danger" : "bg-surface-2",
              )}
            >
              {summary && total > 0 ? (
                <>
                  총 <b>{total.toLocaleString("ko-KR")}명</b>
                  {summary.optedOut > 0 &&
                    ` · 수신거부 ${summary.optedOut.toLocaleString("ko-KR")}명 제외`}
                  {summary.noConsent > 0 &&
                    ` · 미동의 ${summary.noConsent.toLocaleString("ko-KR")}명 제외`}
                  {summary.duplicates > 0 &&
                    ` · 중복 ${summary.duplicates.toLocaleString("ko-KR")}명 제외`}
                </>
              ) : (
                "받는 사람을 1명 이상 선택해 주세요"
              )}
            </div>
            <p className="text-caption text-text-muted">
              광고 문자는 수신 동의를 받은 번호에만 나가요. 미동의 번호는
              자동으로 빠져요.
            </p>
          </Section>

          <Section title="광고 문자">
            <label className="flex cursor-pointer items-center gap-3 text-body-sm">
              <input
                type="checkbox"
                role="switch"
                className="size-4 accent-primary"
                {...register("isAd")}
              />
              광고 문자예요
            </label>
            {isAd && (
              <div className="flex flex-col gap-1 rounded-md bg-surface-2 px-4 py-3 text-body-sm">
                <span>
                  (광고) 표기와 무료 수신거부 안내가 자동으로 들어가요.
                  21:00~08:00에는 보낼 수 없어요.
                </span>
                {isBranch && (
                  <span>
                    <b>본사 승인 후 발송돼요.</b> 요청은 본사 승인함으로 가고,
                    진행 상황은 발송 내역에서 볼 수 있어요.
                  </span>
                )}
              </div>
            )}
          </Section>

          <Section title="내용">
            <div
              className={cn(
                "flex flex-col rounded-md border",
                errors.body ? "border-danger" : "border-border-strong",
              )}
            >
              {isAd && (
                <div className="flex items-center gap-1 border-b border-border px-3 py-2 text-body-sm text-text-muted">
                  <Lock aria-hidden className="size-3.5" />
                  {parts.prefix}
                </div>
              )}
              <textarea
                aria-label="보낼 내용"
                aria-invalid={errors.body ? true : undefined}
                className="h-44 resize-none rounded-md bg-transparent p-3 text-body outline-none"
                {...register("body")}
              />
              {isAd && (
                <div className="flex items-center gap-1 border-t border-border px-3 py-2 text-body-sm text-text-muted">
                  <Lock aria-hidden className="size-3.5" />
                  {parts.suffix}
                </div>
              )}
              <div className="flex items-center justify-between gap-3 border-t border-border px-3 py-2">
                <span className="text-caption text-text-muted">
                  {isAd
                    ? `자동 문구 ${fixedBytes}byte 포함`
                    : "한글 2byte · 영문·숫자 1byte"}
                </span>
                <span
                  data-testid="byte-counter"
                  className={cn(
                    "inline-flex h-6 items-center rounded-sm px-2 text-mono font-bold",
                    message.bytes > LMS_MAX_BYTES
                      ? "bg-danger-subtle text-danger"
                      : message.kind === "lms"
                        ? "bg-primary-subtle text-primary"
                        : "bg-surface-2",
                  )}
                >
                  {message.bytes.toLocaleString("ko-KR")} /{" "}
                  {(message.kind === "sms"
                    ? SMS_MAX_BYTES
                    : LMS_MAX_BYTES
                  ).toLocaleString("ko-KR")}{" "}
                  byte · {message.kind.toUpperCase()}
                </span>
              </div>
            </div>
            <FieldError message={errors.body?.message} />
            {message.kind === "lms" && message.bytes <= LMS_MAX_BYTES && (
              <p className="text-caption text-text-muted">
                {SMS_MAX_BYTES}byte를 넘어서 LMS로 바뀌었어요. 건당 비용이{" "}
                {formatWon(UNIT_PRICE.sms)} → {formatWon(UNIT_PRICE.lms)}이
                됩니다.
              </p>
            )}
          </Section>

          <Section title="발신번호">
            <select
              aria-label="발신번호"
              className="h-(--control-h) w-full max-w-sm cursor-pointer rounded-md border border-border-strong bg-surface px-2 text-body-sm outline-none focus-visible:ring-2 focus-visible:ring-focus"
              {...register("senderId")}
            >
              {senders.map((sender) => (
                <option key={sender.id} value={sender.id}>
                  {formatPhone(sender.number)} {sender.label}
                </option>
              ))}
            </select>
            <p className="text-caption text-text-muted">
              등록된 번호만 쓸 수 있어요.
            </p>
            <FieldError message={errors.senderId?.message} />
          </Section>

          <Section title="보내는 시각">
            <div className="flex flex-wrap gap-4 text-body-sm">
              <label className="flex cursor-pointer items-center gap-2">
                <input
                  type="radio"
                  value="now"
                  className="size-4 accent-primary"
                  {...register("sendMode")}
                />
                지금 보내기
              </label>
              <label className="flex cursor-pointer items-center gap-2">
                <input
                  type="radio"
                  value="scheduled"
                  className="size-4 accent-primary"
                  {...register("sendMode")}
                />
                예약 발송
              </label>
            </div>
            <FieldError message={errors.sendMode?.message} />
            {sendMode === "scheduled" && (
              <div className="flex flex-wrap items-center gap-2">
                <select
                  aria-label="예약 날짜"
                  className="h-(--control-h) w-48 cursor-pointer rounded-md border border-border-strong bg-surface px-2 text-body-sm"
                  {...register("scheduledDay")}
                >
                  {dayOptions.map((day) => (
                    <option key={day.value} value={day.value}>
                      {day.label}
                    </option>
                  ))}
                </select>
                <select
                  aria-label="예약 시각"
                  className="h-(--control-h) w-28 cursor-pointer rounded-md border border-border-strong bg-surface px-2 text-body-sm"
                  {...register("scheduledTime")}
                >
                  <option value="">시각 선택</option>
                  {timeOptions.map((time) => {
                    const at = kstDayTimeToUtc(scheduledDay, time);
                    const night = isAd && at !== null && isNightKst(at);
                    return (
                      <option key={time} value={time} disabled={night}>
                        {time}
                        {night ? " 야간" : ""}
                      </option>
                    );
                  })}
                </select>
                <span className="text-caption text-text-muted">KST</span>
              </div>
            )}
            <FieldError message={errors.scheduledTime?.message} />
          </Section>

          <Section title="예상 비용">
            <p className="text-body">
              {total.toLocaleString("ko-KR")}건 ×{" "}
              {message.unitPrice.toLocaleString("ko-KR")}원 ={" "}
              <b className="text-title">{formatWon(cost)}</b>
            </p>
            {needsApproval ? (
              <p className="text-caption text-text-muted">
                잔액은 본사가 승인할 때 차감돼요.
              </p>
            ) : shortage > 0 ? (
              <p className="text-body-sm font-bold text-danger">
                잔액이 {formatWon(shortage)} 부족해요{" "}
                <Link href="/billing" className="underline">
                  충전하기
                </Link>
              </p>
            ) : (
              <p className="text-body-sm text-text-muted">
                발송 후 잔액 {formatWon(balance - cost)}
              </p>
            )}
          </Section>
        </div>

        <div className="flex items-center justify-end gap-3 py-4">
          {submitError && (
            <p role="alert" className="mr-auto text-body-sm text-danger">
              {submitError}
            </p>
          )}
          <Button type="submit" disabled={!canSubmit}>
            {buttonLabel}
          </Button>
        </div>
      </form>

      <aside aria-label="미리보기" className="xl:sticky xl:top-6 xl:self-start">
        <PhonePreview
          className="h-[600px] w-[300px]"
          sender={senderForParts}
          caption={`${message.kind.toUpperCase()} · ${whenText}`}
          body={message.fullBody || "보낼 내용을 입력해 주세요"}
          testId="preview-body"
        />
        <p className="mt-2 text-center text-caption text-text-muted">
          미리보기는 기기마다 다르게 보일 수 있어요
        </p>
      </aside>

      {confirming && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={needsApproval ? "승인 요청 확인" : "보내기 확인"}
          className="fixed inset-0 z-40 flex items-center justify-center bg-overlay p-4"
        >
          <div className="flex w-full max-w-[440px] flex-col gap-5 rounded-lg bg-surface p-6 shadow-floating">
            <div className="flex flex-col gap-2">
              <h2 className="text-title">
                {needsApproval
                  ? "승인을 요청할까요?"
                  : `${total.toLocaleString("ko-KR")}명에게 ${sendMode === "scheduled" ? "예약할까요?" : "보낼까요?"}`}
              </h2>
              <p className="text-body-sm text-text-muted">
                {needsApproval
                  ? "본사가 승인하면 발송돼요."
                  : sendMode === "scheduled"
                    ? "예약 시각 전까지는 발송 내역에서 취소할 수 있어요."
                    : "보낸 뒤에는 취소할 수 없어요."}
              </p>
            </div>
            <dl className="flex flex-col gap-1 rounded-md bg-surface-2 p-4 text-body-sm">
              {[
                ["받는 사람", `${total.toLocaleString("ko-KR")}명`],
                ["종류", message.kind.toUpperCase()],
                ["발신번호", formatPhone(senderForParts)],
                ["보내는 시각", whenText],
                ["예상 차감", formatWon(cost)],
              ].map(([label, value]) => (
                <div key={label} className="flex justify-between gap-4">
                  <dt className="text-text-muted">{label}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>
            <div className="flex justify-end gap-2">
              <Button
                variant="secondary"
                disabled={pending}
                onClick={() => setConfirming(false)}
              >
                취소
              </Button>
              <Button
                disabled={pending}
                onClick={() => void handleSubmit(submit)()}
              >
                {needsApproval
                  ? "승인 요청"
                  : `${total.toLocaleString("ko-KR")}건 ${sendMode === "scheduled" ? "예약" : "보내기"}`}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
