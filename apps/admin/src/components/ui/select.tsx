import type { ComponentProps } from "react";
import * as SelectPrimitive from "@radix-ui/react-select";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

/* shadcn Select on Radix, themed by tokens (admin/shell D1). */

export const Select = SelectPrimitive.Root;
export const SelectValue = SelectPrimitive.Value;

/* feedback-vocabulary-rollout D9, FR-005/FR-006. Arriving and departing have
   one definition each, in packages/ui/src/styles/index.css, and this surface
   consumes it — no duration, curve or keyframe of its own.

   The backdrop carries the same pair as the content so the two never separate
   mid-flight. Opacity only: a surface that slid would break FR-006 and would
   also make the reduced-motion decision behind these keyframes indefensible. */
export function SelectTrigger({
  className,
  children,
  ...props
}: ComponentProps<typeof SelectPrimitive.Trigger>) {
  return (
    <SelectPrimitive.Trigger
      className={cn(
        "flex h-10 w-full items-center justify-between gap-2 rounded-sm border border-input bg-well px-3 text-sm text-foreground focus:border-ring focus-visible:outline-none disabled:opacity-50",
        className,
      )}
      {...props}
    >
      {children}
      <SelectPrimitive.Icon asChild>
        <ChevronDown className="size-4 shrink-0 text-muted-foreground" aria-hidden />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  );
}

export function SelectContent({
  className,
  children,
  ...props
}: ComponentProps<typeof SelectPrimitive.Content>) {
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Content
        position="popper"
        sideOffset={4}
        className={cn(
          /* bug: bank-picker-unreachable — the popup MUST be bounded. Radix's
             viewport is `overflow: hidden auto` inside `flex: 1`, so it can
             only scroll within a parent whose height is fixed; unbounded, a
             long list simply grew past the window, and Radix's own scroll
             lock meant the page behind it could not move either. Everything
             below the fold was unreachable. The available-height variable is
             the space the popup actually has after collision handling. */
          "z-dropdown max-h-[var(--radix-select-content-available-height)] min-w-[var(--radix-select-trigger-width)] overflow-hidden rounded-md border border-border bg-card p-1 shadow-lg",
          "data-[state=open]:animate-enter data-[state=closed]:animate-leave",
          className,
        )}
        {...props}
      >
        <SelectPrimitive.Viewport className="max-h-72 overflow-y-auto">{children}</SelectPrimitive.Viewport>
      </SelectPrimitive.Content>
    </SelectPrimitive.Portal>
  );
}

export function SelectItem({
  className,
  children,
  ...props
}: ComponentProps<typeof SelectPrimitive.Item>) {
  return (
    <SelectPrimitive.Item
      className={cn(
        "flex cursor-default items-center justify-between gap-3 rounded-sm px-3 py-2 text-sm text-foreground outline-none data-[highlighted]:bg-muted",
        className,
      )}
      {...props}
    >
      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
      <SelectPrimitive.ItemIndicator>
        <Check className="size-4 text-link" aria-hidden />
      </SelectPrimitive.ItemIndicator>
    </SelectPrimitive.Item>
  );
}
