import * as PopoverPrimitive from "@radix-ui/react-popover";
import { type ComponentPropsWithoutRef } from "react";
import { cn } from "@/lib/utils";

/* shadcn Popover on Radix, themed by tokens (payments-and-classes D4,
   2026-09-02 revision): the date range's desktop container. */

export const Popover = PopoverPrimitive.Root;
export const PopoverTrigger = PopoverPrimitive.Trigger;
/* The anchor a control positions itself against when the control is not
   a trigger — the combobox's field stays a field, and keeps the keyboard. */
export const PopoverAnchor = PopoverPrimitive.Anchor;
export const PopoverClose = PopoverPrimitive.Close;

/* feedback-vocabulary-rollout D9, FR-005/FR-006. Arriving and departing have
   one definition each, in packages/ui/src/styles/index.css, and this surface
   consumes it — no duration, curve or keyframe of its own.

   The backdrop carries the same pair as the content so the two never separate
   mid-flight. Opacity only: a surface that slid would break FR-006 and would
   also make the reduced-motion decision behind these keyframes indefensible. */
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
          "z-dropdown rounded-lg border border-border bg-background p-4 shadow-lg outline-none",
          "data-[state=open]:animate-enter data-[state=closed]:animate-leave",
          className,
        )}
        {...props}
      />
    </PopoverPrimitive.Portal>
  );
}
