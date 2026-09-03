import { type ComponentType, type InputHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  /* design-review D8: a field that takes money shows the sign every
     displayed amount already carries. */
  prefix?: string;
  /* pagos-filtros review (2026-09-02), mirroring the `@devolada/ui` atom:
     a leading icon says what a field is when its label is gone — a
     magnifier carries "search" in a shape, not in 2.19:1 placeholder text. */
  icon?: ComponentType<{ className?: string }>;
}

export function Input({ className, prefix, icon: Icon, ...props }: InputProps) {
  const field = (
    <input
      className={cn(
        "h-10 w-full rounded-sm border border-input bg-well text-sm text-foreground placeholder:text-ink-faint focus:border-ring focus-visible:outline-none disabled:opacity-50",
        /* design-review D7 (packages/ui input): the UA's own clear
           button paints in the browser's accent, outside our tokens. */
        "[&::-webkit-search-cancel-button]:hidden",
        Icon ? "pl-9 pr-3" : prefix ? "pl-7 pr-3" : "px-3",
        className,
      )}
      {...props}
    />
  );
  if (!prefix && !Icon) return field;
  return (
    <div className="relative">
      {Icon && (
        <Icon
          className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-faint"
          aria-hidden
        />
      )}
      {prefix && (
        <span
          className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-sm text-muted-foreground"
          aria-hidden
        >
          {prefix}
        </span>
      )}
      {field}
    </div>
  );
}
