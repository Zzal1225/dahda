import type { FieldError, UseFormRegisterReturn } from "react-hook-form";
import { Input } from "@/components/ui/input";

/** 라벨·입력·오류 연결을 화면마다 다시 쓰다 빠뜨리지 않으려고 하나로 뒀다. */
export function FormField({
  id,
  label,
  type = "text",
  inputMode,
  autoComplete,
  error,
  registration,
}: {
  id: string;
  label: string;
  type?: string;
  inputMode?: "tel" | "text";
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
        inputMode={inputMode}
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
