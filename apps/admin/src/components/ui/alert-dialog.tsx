import type { ComponentProps } from "react";
import * as AlertDialogPrimitive from "@radix-ui/react-alert-dialog";
import { cn } from "@/lib/utils";

/* shadcn AlertDialog on Radix, themed by tokens (admin/shell D1).
   Used where a tap writes something the ledger cannot take back
   (cash-drops D6). Radix owns the focus trap and the ARIA wiring. */

export const AlertDialog = AlertDialogPrimitive.Root;
export const AlertDialogTrigger = AlertDialogPrimitive.Trigger;
export const AlertDialogAction = AlertDialogPrimitive.Action;
export const AlertDialogCancel = AlertDialogPrimitive.Cancel;

/* feedback-vocabulary-rollout D9, FR-005/FR-006. Arriving and departing have
   one definition each, in packages/ui/src/styles/index.css, and this surface
   consumes it — no duration, curve or keyframe of its own.

   The backdrop carries the same pair as the content so the two never separate
   mid-flight. Opacity only: a surface that slid would break FR-006 and would
   also make the reduced-motion decision behind these keyframes indefensible. */
export function AlertDialogContent({
  className,
  ...props
}: ComponentProps<typeof AlertDialogPrimitive.Content>) {
  return (
    <AlertDialogPrimitive.Portal>
      <AlertDialogPrimitive.Overlay className="fixed inset-0 z-overlay bg-overlay data-[state=open]:animate-enter data-[state=closed]:animate-leave" />
      <AlertDialogPrimitive.Content
        className={cn(
          "fixed left-1/2 top-1/2 z-modal w-[calc(100vw-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-md border border-border bg-card p-6 shadow-lg",
          "data-[state=open]:animate-enter data-[state=closed]:animate-leave",
          className,
        )}
        {...props}
      />
    </AlertDialogPrimitive.Portal>
  );
}

export function AlertDialogTitle({
  className,
  ...props
}: ComponentProps<typeof AlertDialogPrimitive.Title>) {
  return (
    <AlertDialogPrimitive.Title
      className={cn("text-lg font-semibold text-foreground", className)}
      {...props}
    />
  );
}

export function AlertDialogDescription({
  className,
  ...props
}: ComponentProps<typeof AlertDialogPrimitive.Description>) {
  return (
    <AlertDialogPrimitive.Description
      className={cn("mt-2 text-sm text-muted-foreground", className)}
      {...props}
    />
  );
}

export function AlertDialogFooter({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      className={cn("mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end", className)}
      {...props}
    />
  );
}
