import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { type ComponentPropsWithoutRef } from "react";
import { cn } from "@/lib/utils";

/* shadcn Sheet: a Radix Dialog that docks to an edge. Bottom only for
   now — the date range's phone container (payments-and-classes D4,
   2026-09-02 revision). Same dep as dialog.tsx, so no second Radix
   copy can ever disagree with it. */

export const Sheet = DialogPrimitive.Root;
export const SheetTrigger = DialogPrimitive.Trigger;
export const SheetClose = DialogPrimitive.Close;
export const SheetTitle = DialogPrimitive.Title;

/* feedback-vocabulary-rollout D9, FR-005/FR-006. Arriving and departing have
   one definition each, in packages/ui/src/styles/index.css, and this surface
   consumes it — no duration, curve or keyframe of its own.

   The backdrop carries the same pair as the content so the two never separate
   mid-flight. Opacity only: a surface that slid would break FR-006 and would
   also make the reduced-motion decision behind these keyframes indefensible. */
export function SheetContent({
  className,
  children,
  ...props
}: ComponentPropsWithoutRef<typeof DialogPrimitive.Content>) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-overlay bg-overlay data-[state=open]:animate-enter data-[state=closed]:animate-leave" />
      <DialogPrimitive.Content
        className={cn(
          /* docked to the bottom, capped so the list behind stays a
             visible context; the safe area keeps the buttons above a
             phone's home indicator */
          "fixed inset-x-0 bottom-0 z-modal max-h-[90dvh] overflow-y-auto rounded-t-2xl border-t border-border bg-background p-4 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-lg",
          "data-[state=open]:animate-enter data-[state=closed]:animate-leave",
          className,
        )}
        {...props}
      >
        {children}
        <DialogPrimitive.Close className="absolute right-4 top-4 flex size-11 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground">
          <X className="size-5" aria-hidden />
          <span className="sr-only">Cerrar</span>
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}
