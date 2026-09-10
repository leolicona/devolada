import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

/* shadcn dialog, themed with our tokens (FRONTEND law). */

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

/* feedback-vocabulary-rollout D9, FR-005/FR-006. Arriving and departing have
   one definition each, in packages/ui/src/styles/index.css, and this surface
   consumes it — no duration, curve or keyframe of its own.

   The backdrop carries the same pair as the content so the two never separate
   mid-flight. Opacity only: a surface that slid would break FR-006 and would
   also make the reduced-motion decision behind these keyframes indefensible. */
export function DialogContent({
  className,
  children,
  ...props
}: React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>) {
  return (
    <DialogPrimitive.Portal>
      {/* The pair replaced here is `data-[state=open]:animate-in
          data-[state=open]:fade-in-0`, which came from `tailwindcss-animate`.
          That plugin is not installed in this repo and index.css carries no
          @plugin directive, so Tailwind emitted no rule for either class and
          this overlay has always appeared instantly (research R5). FR-007 asks
          that an inert decoration be given a working treatment or removed;
          this one gets the working treatment. */}
      <DialogPrimitive.Overlay className="fixed inset-0 z-overlay bg-overlay data-[state=open]:animate-enter data-[state=closed]:animate-leave" />
      <DialogPrimitive.Content
        className={cn(
          "fixed left-1/2 top-1/2 z-modal grid max-h-[85vh] w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 gap-4 overflow-y-auto rounded-lg border border-border bg-background p-6 shadow-lg",
          "data-[state=open]:animate-enter data-[state=closed]:animate-leave",
          className,
        )}
        {...props}
      >
        {children}
        <DialogPrimitive.Close className="absolute right-4 top-4 rounded-sm text-muted-foreground hover:text-foreground">
          <X className="size-4" aria-hidden />
          <span className="sr-only">Cerrar</span>
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

export function DialogTitle({
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>) {
  return <DialogPrimitive.Title className={cn("text-base font-semibold", className)} {...props} />;
}

export function DialogDescription({
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description className={cn("text-sm text-muted-foreground", className)} {...props} />
  );
}
