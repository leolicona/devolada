import type { HTMLAttributes } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../lib/cn";

/* shadcn Alert in token utilities (shell spec D5). The variant carries
   the meaning; color never travels alone, so callers pass the matching
   lucide icon as the first child (FRONTEND.md). */
const alertVariants = cva("rounded-md border px-4 py-3 text-sm font-medium", {
  variants: {
    variant: {
      default: "border-line bg-well text-ink-soft",
      warning: "border-warning-line bg-warning-soft text-warning",
      destructive: "border-error-line bg-error-soft text-error",
      success: "border-success-line bg-success-soft text-success",
    },
    /* Icon + text needs the two to line up; text-only notices don't. */
    layout: {
      block: "",
      icon: "flex items-start gap-2 [&>svg]:mt-0.5 [&>svg]:size-4 [&>svg]:shrink-0",
    },
  },
  defaultVariants: { variant: "default", layout: "block" },
});

/* The variant decides how loudly this is announced. shadcn's Alert puts
   role="alert" on every one, which is wrong for us: an empty list is not
   an emergency, and an assertive live region on a sentence that renders
   with the page interrupts a screen reader for no reason (list-states
   D1 relies on the distinction — "no movements yet" must not read as a
   failure). Only a failure is assertive; a warning is polite; neutral
   and success notices are plain content. An explicit `role` still wins. */
const roleFor = (variant: AlertProps["variant"]) =>
  variant === "destructive" ? "alert" : variant === "warning" ? "status" : undefined;

export interface AlertProps
  extends HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof alertVariants> {}

export function Alert({ className, variant, layout, ...props }: AlertProps) {
  return (
    <div
      role={roleFor(variant)}
      className={cn(alertVariants({ variant, layout }), className)}
      {...props}
    />
  );
}
