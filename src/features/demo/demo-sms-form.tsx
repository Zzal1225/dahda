"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { FormField } from "@/components/ui/form-field";
import { sendDemoSms } from "./actions";
import { demoSmsSchema, type DemoSmsInput } from "./demo-schema";

/** 발송 내역으로 보내는 이유: 접수에서 도착으로 바뀌는 화면이 이 체험의 핵심이고, 그 화면은 이미 있다. */
export function DemoSmsForm() {
  const router = useRouter();
  const form = useForm<DemoSmsInput>({
    resolver: zodResolver(demoSmsSchema),
    defaultValues: { phone: "", consent: false },
  });
  const consentError = form.formState.errors.consent;

  return (
    <form
      className="flex flex-col gap-4"
      noValidate
      onSubmit={(event) => event.preventDefault()}
    >
      <FormField
        id="demo-phone"
        label="내 휴대전화 번호"
        type="tel"
        inputMode="tel"
        autoComplete="tel"
        error={form.formState.errors.phone}
        registration={form.register("phone")}
      />
      <div className="flex flex-col gap-1.5">
        <label className="flex items-start gap-2 text-body-sm">
          <input
            type="checkbox"
            className="mt-1"
            aria-invalid={consentError ? true : undefined}
            aria-describedby={consentError ? "demo-consent-error" : undefined}
            {...form.register("consent")}
          />
          <span>
            본인 번호이며, 이 문자 1건을 받는 데 동의해요. 번호는 체험 계정과
            함께 3일 뒤 지워지고, 중복 발송을 막는 값만 30일간 보관해요.
          </span>
        </label>
        {consentError && (
          <p id="demo-consent-error" className="text-caption text-danger">
            {consentError.message}
          </p>
        )}
      </div>
      <ConfirmDialog
        title="실제 문자를 보낼까요?"
        description="입력한 번호로 실제 문자 1건이 나가요. 체험 계정마다 한 번만 보낼 수 있어요."
        confirmLabel="보내기"
        onConfirm={async () => {
          const result = await sendDemoSms(form.getValues());
          if ("error" in result) return result;
          router.push(`/history?campaign=${result.campaignId}`);
          return undefined;
        }}
        trigger={(open) => (
          <Button
            type="button"
            className="self-start"
            onClick={form.handleSubmit(() => open())}
          >
            실제 문자 받아 보기
          </Button>
        )}
      />
    </form>
  );
}
