"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useState, useTransition, type ReactNode } from "react";
import { useForm } from "react-hook-form";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent } from "@/components/ui/dialog";
import { FormField } from "@/components/ui/form-field";
import { formatPhone } from "@/lib/format";
import {
  addOptOut,
  createContact,
  createGroup,
  renameGroup,
  updateContact,
} from "./actions";
import type { ContactRow, GroupRow } from "./contact-query";
import {
  contactSchema,
  groupSchema,
  optOutSchema,
  type ContactFormInput,
  type ContactValues,
  type GroupValues,
  type OptOutFormInput,
  type OptOutValues,
} from "./contact-schema";

function Footer({
  pending,
  error,
  label,
}: {
  pending: boolean;
  error: string | undefined;
  label: string;
}) {
  return (
    <>
      {error && (
        <p role="alert" className="text-body-sm text-danger">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <DialogClose asChild>
          <Button variant="secondary">취소</Button>
        </DialogClose>
        <Button type="submit" disabled={pending}>
          {label}
        </Button>
      </div>
    </>
  );
}

/** 대화상자의 공통 동작: 저장 중 표시, 실패하면 사유를 보여 주고 열어 둔다. */
function useSubmit(onOpenChange: (open: boolean) => void) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string>();

  function run(action: () => Promise<{ error: string } | undefined>) {
    setError(undefined);
    startTransition(async () => {
      const result = await action();
      if (result) setError(result.error);
      else onOpenChange(false);
    });
  }
  return { pending, error, setError, run };
}

/** contact가 있으면 수정이다. 추가와 입력이 같아 대화상자를 나누지 않았다. */
export function ContactDialog({
  contact,
  groups,
  trigger,
}: {
  contact?: ContactRow;
  groups: readonly GroupRow[];
  trigger: (open: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const { pending, error, setError, run } = useSubmit(setOpen);
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<ContactFormInput, unknown, ContactValues>({
    resolver: zodResolver(contactSchema),
  });

  function show() {
    reset({
      phone: contact ? formatPhone(contact.phone) : "",
      name: contact?.name ?? "",
      memo: contact?.memo ?? "",
      groupIds: contact?.groupIds ?? [],
    });
    setError(undefined);
    setOpen(true);
  }

  return (
    <>
      {trigger(show)}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          title={contact ? "연락처 고치기" : "연락처 추가"}
          description="번호는 숫자만 저장해요. 광고 문자를 보내려면 수신 동의를 받은 번호여야 해요."
        >
          <form
            onSubmit={handleSubmit((values) =>
              run(() =>
                contact
                  ? updateContact(contact.id, values)
                  : createContact(values),
              ),
            )}
            noValidate
            className="flex flex-col gap-4"
          >
            <FormField
              id="contact-phone"
              label="전화번호"
              inputMode="tel"
              autoComplete="off"
              error={errors.phone}
              registration={register("phone")}
            />
            <FormField
              id="contact-name"
              label="이름"
              autoComplete="off"
              error={errors.name}
              registration={register("name")}
            />
            <FormField
              id="contact-memo"
              label="메모"
              autoComplete="off"
              error={errors.memo}
              registration={register("memo")}
            />
            {groups.length > 0 && (
              <fieldset className="flex flex-col gap-1.5">
                <legend className="text-body-sm font-bold">그룹</legend>
                <div className="flex flex-wrap gap-3">
                  {groups.map((group) => (
                    <label
                      key={group.id}
                      className="flex cursor-pointer items-center gap-1.5 text-body-sm"
                    >
                      <input
                        type="checkbox"
                        value={group.id}
                        className="size-4 accent-primary"
                        {...register("groupIds")}
                      />
                      {group.name}
                    </label>
                  ))}
                </div>
              </fieldset>
            )}
            <Footer
              pending={pending}
              error={error}
              label={contact ? "저장" : "추가"}
            />
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function GroupDialog({
  group,
  trigger,
}: {
  group?: GroupRow;
  trigger: (open: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const { pending, error, setError, run } = useSubmit(setOpen);
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<GroupValues>({ resolver: zodResolver(groupSchema) });

  function show() {
    reset({ name: group?.name ?? "" });
    setError(undefined);
    setOpen(true);
  }

  return (
    <>
      {trigger(show)}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          title={group ? "그룹 이름 바꾸기" : "그룹 만들기"}
          description="그룹은 내 지점 안에서만 쓰여요."
        >
          <form
            onSubmit={handleSubmit((values) =>
              run(() =>
                group ? renameGroup(group.id, values) : createGroup(values),
              ),
            )}
            noValidate
            className="flex flex-col gap-5"
          >
            <FormField
              id="group-name"
              label="그룹 이름"
              autoComplete="off"
              error={errors.name}
              registration={register("name")}
            />
            <Footer
              pending={pending}
              error={error}
              label={group ? "저장" : "만들기"}
            />
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function OptOutDialog({
  trigger,
}: {
  trigger: (open: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const { pending, error, setError, run } = useSubmit(setOpen);
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<OptOutFormInput, unknown, OptOutValues>({
    resolver: zodResolver(optOutSchema),
  });

  function show() {
    reset({ phone: "", reason: "" });
    setError(undefined);
    setOpen(true);
  }

  return (
    <>
      {trigger(show)}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          title="수신거부 등록"
          description="본사 공통 목록이에요. 등록하면 모든 지점의 발송에서 이 번호가 빠져요."
        >
          <form
            onSubmit={handleSubmit((values) => run(() => addOptOut(values)))}
            noValidate
            className="flex flex-col gap-4"
          >
            <FormField
              id="opt-out-phone"
              label="전화번호"
              inputMode="tel"
              autoComplete="off"
              error={errors.phone}
              registration={register("phone")}
            />
            <FormField
              id="opt-out-reason"
              label="사유"
              autoComplete="off"
              error={errors.reason}
              registration={register("reason")}
            />
            <Footer pending={pending} error={error} label="등록" />
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
