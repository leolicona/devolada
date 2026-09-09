import * as SwitchPrimitive from "@radix-ui/react-switch";
import { type ComponentPropsWithoutRef } from "react";
import { cn } from "@/lib/utils";

/* shadcn Switch on Radix, themed by tokens. */

export function Switch({ className, ...props }: ComponentPropsWithoutRef<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      className={cn(
        "inline-flex h-6 w-11 shrink-0 items-center rounded-full border border-border transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
        "disabled:cursor-not-allowed disabled:opacity-50",
        "bg-muted data-[state=checked]:border-transparent data-[state=checked]:bg-primary",
        className,
      )}
      {...props}
    >
      {/* Geometry stays on the spacing scale (no arbitrary values): the
          track's inner width is 42px (44 − borders), the thumb 20px with
          a 2px inset — so "checked" is exactly translate-x-5. */}
      <SwitchPrimitive.Thumb
        className={cn(
          "block size-5 translate-x-0.5 rounded-full bg-background shadow-sm transition-transform",
          "data-[state=checked]:translate-x-5",
        )}
      />
    </SwitchPrimitive.Root>
  );
}
