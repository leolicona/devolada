import { type InputHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        "h-10 w-full rounded-sm border border-input bg-well px-3 text-sm text-foreground placeholder:text-ink-faint focus:border-ring focus-visible:outline-none disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}
