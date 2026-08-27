import { type InputHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  /* design-review D8: a field that takes money shows the sign every
     displayed amount already carries. */
  prefix?: string;
}

export function Input({ className, prefix, ...props }: InputProps) {
  const field = (
    <input
      className={cn(
        "h-10 w-full rounded-sm border border-input bg-well text-sm text-foreground placeholder:text-ink-faint focus:border-ring focus-visible:outline-none disabled:opacity-50",
        /* design-review D7 (packages/ui input): the UA's own clear
           button paints in the browser's accent, outside our tokens. */
        "[&::-webkit-search-cancel-button]:hidden",
        prefix ? "pl-7 pr-3" : "px-3",
        className,
      )}
      {...props}
    />
  );
  if (!prefix) return field;
  return (
    <div className="relative">
      <span
        className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-sm text-muted-foreground"
        aria-hidden
      >
        {prefix}
      </span>
      {field}
    </div>
  );
}
