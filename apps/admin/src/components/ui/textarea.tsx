import { type TextareaHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={cn(
        "min-h-20 w-full rounded-sm border border-input bg-well px-3 py-2 text-sm text-foreground placeholder:text-ink-faint focus:border-ring focus-visible:outline-none disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}
