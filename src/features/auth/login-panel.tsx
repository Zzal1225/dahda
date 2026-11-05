"use client";

import Link from "next/link";
import { zodResolver } from "@hookform/resolvers/zod";
import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { signIn, startTrial } from "./actions";
import { loginSchema, type LoginInput } from "./login-schema";

export function LoginPanel() {
  const [pending, startTransition] = useTransition();
  const [formError, setFormError] = useState<string>();
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginInput>({ resolver: zodResolver(loginSchema) });

  function submit(input: LoginInput) {
    setFormError(undefined);
    startTransition(async () => {
      const result = await signIn(input);
      if (result) setFormError(result.error);
    });
  }

  function beginTrial() {
    setFormError(undefined);
    startTransition(async () => {
      const result = await startTrial();
      if (result) setFormError(result.error);
    });
  }

  return (
    <div className="flex w-full max-w-[400px] flex-col gap-6 rounded-lg border border-border bg-surface p-8">
      <div className="flex flex-col gap-1">
        <h1 className="text-title-lg text-primary">dahda</h1>
        <p className="text-body-sm text-text-muted">
          문자가 닿았는지까지 확인하는 발송 콘솔
        </p>
      </div>

      {/* 방문자 대부분은 채용 담당자라 가입하지 않는다. 체험을 먼저, 크게 둔다. */}
      <div className="flex flex-col gap-2">
        <Button
          onClick={beginTrial}
          disabled={pending}
          className="h-12 text-[15px]"
        >
          로그인 없이 체험하기
        </Button>
        <p className="text-center text-caption text-text-muted">
          샘플 데이터예요. 실제 문자는 번호를 직접 넣을 때만 나가요
        </p>
      </div>

      <div className="flex items-center gap-3 text-caption text-text-muted">
        <span aria-hidden className="h-px flex-1 bg-border" />
        이미 계정이 있다면
        <span aria-hidden className="h-px flex-1 bg-border" />
      </div>

      <form
        onSubmit={handleSubmit(submit)}
        noValidate
        className="flex flex-col gap-4"
      >
        <div className="flex flex-col gap-1.5">
          <label htmlFor="email" className="text-body-sm font-bold">
            이메일
          </label>
          <Input
            id="email"
            type="email"
            autoComplete="username"
            aria-invalid={errors.email ? true : undefined}
            aria-describedby={errors.email ? "email-error" : undefined}
            {...register("email")}
          />
          {errors.email && (
            <p id="email-error" className="text-caption text-danger">
              {errors.email.message}
            </p>
          )}
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="password" className="text-body-sm font-bold">
            비밀번호
          </label>
          <Input
            id="password"
            type="password"
            autoComplete="current-password"
            aria-invalid={errors.password ? true : undefined}
            aria-describedby={errors.password ? "password-error" : undefined}
            {...register("password")}
          />
          {errors.password && (
            <p id="password-error" className="text-caption text-danger">
              {errors.password.message}
            </p>
          )}
        </div>

        {formError && (
          <p role="alert" className="text-body-sm text-danger">
            {formError}
          </p>
        )}

        <Button type="submit" variant="secondary" disabled={pending}>
          로그인
        </Button>
      </form>

      <Link
        href="/privacy"
        className="text-center text-caption text-text-muted underline"
      >
        개인정보처리방침
      </Link>
    </div>
  );
}
