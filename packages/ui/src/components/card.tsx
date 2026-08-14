import type { HTMLAttributes } from "react";
import { Slot } from "@radix-ui/react-slot";
import { cn } from "../lib/cn";

/* shadcn Card in token utilities (shell spec D5). The panel both
   surfaces build with: the admin's tables-as-cards and the PWA's
   balance, breakdown and ledger groups. */

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  /* A card that is itself a tap target renders as its child, so the
     recipe stays here and the anchor stays an anchor (the PWA's
     balance and customer cards are links). */
  asChild?: boolean;
}

export function Card({ className, asChild, ...props }: CardProps) {
  const Comp = asChild ? Slot : "div";
  return <Comp className={cn("rounded-md border border-line bg-card", className)} {...props} />;
}

export function CardHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex flex-col gap-1 p-6", className)} {...props} />;
}

export function CardTitle({ className, ...props }: HTMLAttributes<HTMLHeadingElement>) {
  return <h2 className={cn("text-lg font-semibold", className)} {...props} />;
}

export function CardDescription({ className, ...props }: HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn("text-sm text-ink-soft", className)} {...props} />;
}

export function CardContent({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("p-6 pt-0", className)} {...props} />;
}
