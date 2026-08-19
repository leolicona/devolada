import { ChevronDown } from "lucide-react";
import type { SelectHTMLAttributes } from "react";
import { cn } from "@devolada/ui";

/* A native <select>, deliberately — direct-payment D16.

   The catalogue's Select (Radix, as the admin uses it) renders a custom
   listbox. That is right for the admin's short lists on a desktop; it is
   wrong here. This field holds 97 banks and is filled once, on a phone,
   by someone who has just moved money and wants to be done. The platform
   control gives them their OS picker with type-ahead — "nu" jumps to
   NUBANK — momentum scrolling and the assistive behaviour they already
   have configured, and it adds no dependency to a public page whose load
   time sits on the critical path of a payment.

   Styled to the same counter height and tokens as Input so the form reads
   as one thing (FRONTEND.md). */
export function NativeSelect({
  className,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <div className="relative">
      <select
        className={cn(
          "h-12 w-full appearance-none rounded-sm border border-line-input bg-well pr-12 pl-4 text-base text-ink focus:border-focus disabled:text-ink-faint",
          /* An unchosen field must not read as a chosen one */
          "invalid:text-ink-faint",
          className,
        )}
        {...props}
      />
      <ChevronDown
        className="pointer-events-none absolute top-1/2 right-4 size-5 -translate-y-1/2 text-ink-faint"
        aria-hidden
      />
    </div>
  );
}
