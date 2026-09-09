import * as TabsPrimitive from "@radix-ui/react-tabs";
import { type ComponentPropsWithoutRef } from "react";
import { cn } from "@/lib/utils";

/* shadcn Tabs on Radix, themed by tokens. */

export const Tabs = TabsPrimitive.Root;

export function TabsList({ className, ...props }: ComponentPropsWithoutRef<typeof TabsPrimitive.List>) {
  return (
    <TabsPrimitive.List
      className={cn("inline-flex flex-wrap items-center gap-2", className)}
      {...props}
    />
  );
}

export function TabsTrigger({ className, ...props }: ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      className={cn(
        /* design-review 2026-09-01: a trigger never shrinks nor wraps its
           label — in a nowrap scrolling list (Pagos on a phone) a squeezed
           chip broke "En cola" into two lines inside its own pill.
           design-review 2026-09-02 (pagos-filtros): 44px under `sm`, where
           a finger is the pointer; the desktop keeps its density. */
        "h-11 shrink-0 whitespace-nowrap rounded-full border border-border px-4 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground sm:h-9",
        "data-[state=active]:border-transparent data-[state=active]:bg-accent-soft data-[state=active]:text-link",
        className,
      )}
      {...props}
    />
  );
}

export const TabsContent = TabsPrimitive.Content;
