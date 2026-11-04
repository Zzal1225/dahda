"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useState, useTransition, type ReactNode } from "react";
import {
  useForm,
  type FieldError,
  type UseFormRegisterReturn,
} from "react-hook-form";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { assignBranchAccount, createBranch, renameBranch } from "./actions";
import {
  branchAccountSchema,
  branchNameSchema,
  type BranchAccountInput,
  type BranchNameInput,
} from "./branch-schema";

function Field({
  id,
  label,
  type = "text",
  autoComplete,
  error,
  registration,
}: {
  id: string;
  label: string;
  type?: string;
  autoComplete?: string;
  error: FieldError | undefined;
  registration: UseFormRegisterReturn;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-body-sm font-bold">
        {label}
      </label>
      <Input
        id={id}
        type={type}
        autoComplete={autoComplete}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
        {...registration}
      />
      {error && (
        <p id={`${id}-error`} className="text-caption text-danger">
          {error.message}
        </p>
      )}
    </div>
  );
}

function FormFooter({
  pending,
  error,
  submitLabel,
}: {
  pending: boolean;
  error: string | undefined;
  submitLabel: string;
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
          {submitLabel}
        </Button>
      </div>
    </>
  );
}

/** 추가와 이름 변경은 입력이 같아 한 대화상자를 쓴다. branch가 있으면 이름 변경이다. */
export function BranchNameDialog({
  branch,
  trigger,
}: {
  branch?: { id: string; name: string };
  trigger: (open: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [formError, setFormError] = useState<string>();
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<BranchNameInput>({
    resolver: zodResolver(branchNameSchema),
    defaultValues: { name: branch?.name ?? "" },
  });

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (next) {
      // 취소한 입력과 이전 오류가 다음에 열 때 남지 않게 한다.
      reset({ name: branch?.name ?? "" });
      setFormError(undefined);
    }
  }

  function submit(input: BranchNameInput) {
    setFormError(undefined);
    startTransition(async () => {
      const result = branch
        ? await renameBranch(branch.id, input)
        : await createBranch(input);
      if (result) setFormError(result.error);
      else setOpen(false);
    });
  }

  return (
    <>
      {trigger(() => handleOpenChange(true))}
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent
          title={branch ? "지점 이름 바꾸기" : "지점 추가"}
          description={
            branch
              ? "이름을 바꿔도 발송 내역과 잔액은 그대로 남아요."
              : "새 지점의 잔액은 ₩0에서 시작해요."
          }
        >
          <form
            onSubmit={handleSubmit(submit)}
            noValidate
            className="flex flex-col gap-5"
          >
            <Field
              id="branch-name"
              label="지점 이름"
              error={errors.name}
              registration={register("name")}
            />
            <FormFooter
              pending={pending}
              error={formError}
              submitLabel={branch ? "저장" : "추가"}
            />
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function BranchAccountDialog({
  branch,
}: {
  branch: { id: string; name: string };
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [formError, setFormError] = useState<string>();
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<BranchAccountInput>({
    resolver: zodResolver(branchAccountSchema),
  });

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (next) {
      reset({ displayName: "", email: "", password: "" });
      setFormError(undefined);
    }
  }

  function submit(input: BranchAccountInput) {
    setFormError(undefined);
    startTransition(async () => {
      const result = await assignBranchAccount(branch.id, input);
      if (result) setFormError(result.error);
      else setOpen(false);
    });
  }

  return (
    <>
      <Button variant="ghost" onClick={() => handleOpenChange(true)}>
        계정 지정
      </Button>
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent
          title={`${branch.name} 담당 계정 지정`}
          description="지점 담당자는 한 명이에요. 이 이메일과 비밀번호를 담당자에게 직접 전달해 주세요."
        >
          <form
            onSubmit={handleSubmit(submit)}
            noValidate
            className="flex flex-col gap-4"
          >
            <Field
              id="account-name"
              label="담당자 이름"
              error={errors.displayName}
              registration={register("displayName")}
            />
            <Field
              id="account-email"
              label="이메일"
              type="email"
              autoComplete="off"
              error={errors.email}
              registration={register("email")}
            />
            <Field
              id="account-password"
              label="임시 비밀번호"
              type="password"
              autoComplete="new-password"
              error={errors.password}
              registration={register("password")}
            />
            <FormFooter
              pending={pending}
              error={formError}
              submitLabel="계정 만들기"
            />
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
