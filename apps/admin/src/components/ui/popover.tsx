import * as PopoverPrimitive from "@radix-ui/react-popover";
import { type ComponentPropsWithoutRef } from "react";
import { cn } from "@/lib/utils";

/* shadcn Popover on Radix, themed by tokens (payments-and-classes D4,
   2026-09-02 revision): the date range's desktop container. */

export const Popover = PopoverPrimitive.Root;
export const PopoverTrigger = PopoverPrimitive.Trigger;
export const PopoverClose = PopoverPrimitive.Close;

export function PopoverContent({
  className,
  align = "end",
  sideOffset = 6,
  ...props
}: ComponentPropsWithoutRef<typeof PopoverPrimitive.Content>) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        align={align}
        sideOffset={sideOffset}
        className={cn(
          "z-50 rounded-lg border border-border bg-background p-4 shadow-lg outline-none",
          className,
        )}
        {...props}
      />
    </PopoverPrimitive.Portal>
  );
}
