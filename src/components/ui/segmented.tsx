import { cn } from "@/lib/utils";

export function Segmented<TValue extends string | number>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: TValue;
  options: readonly { value: TValue; label: string }[];
  onChange: (value: TValue) => void;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="inline-flex h-(--control-h) gap-0.5 rounded-md bg-surface-2 p-1"
    >
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(option.value)}
            className={cn(
              "cursor-pointer rounded-sm px-3 text-caption font-bold whitespace-nowrap outline-none focus-visible:ring-2 focus-visible:ring-focus",
              selected
                ? "bg-surface text-text shadow-[0_1px_2px_rgba(28,23,24,.08)]"
                : "text-text-muted",
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
