import type { ComponentType, InputHTMLAttributes, ReactNode } from "react";
import { cn } from "../lib/cn";

/* Text input at counter height (48px) with optional leading icon. */

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  icon?: ComponentType<{ className?: string }>;
}

export function Input({ icon: Icon, className, ...props }: InputProps) {
  const field = (
    <input
      className={cn(
        "h-12 w-full rounded-sm border border-line bg-well text-base text-ink placeholder:text-ink-faint focus:border-focus disabled:text-ink-faint",
        Icon ? "pl-12 pr-4" : "px-4",
        className,
      )}
      {...props}
    />
  );
  if (!Icon) return field;
  return (
    <div className="relative">
      <Icon
        className="pointer-events-none absolute top-1/2 left-4 size-5 -translate-y-1/2 text-ink-faint"
        aria-hidden
      />
      {field}
    </div>
  );
}

/* Label wrapper: keeps inputs reachable by getByLabelText in tests
   and consistent label typography everywhere. */
export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-2 block text-sm font-medium text-ink-soft">{label}</span>
      {children}
    </label>
  );
}
