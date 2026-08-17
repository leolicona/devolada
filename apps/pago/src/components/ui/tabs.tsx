import * as TabsPrimitive from "@radix-ui/react-tabs";
import { type ComponentPropsWithoutRef } from "react";
import { cn } from "@devolada/ui";

/* shadcn Tabs on Radix, written in token utilities: this app carries no
   shadcn alias bridge (admin/shell.spec.md D1 is the admin's), so the
   package's own layer applies — bg/border/text straight from tokens. */

export const Tabs = TabsPrimitive.Root;

export function TabsList({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof TabsPrimitive.List>) {
  return (
    <TabsPrimitive.List
      className={cn("grid grid-cols-2 gap-2", className)}
      {...props}
    />
  );
}

export function TabsTrigger({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      className={cn(
        /* --size-touch: this is the customer's phone */
        "h-12 rounded-md border border-line px-3 text-sm font-medium text-ink-soft transition-colors duration-150 hover:text-ink",
        "data-[state=active]:border-accent data-[state=active]:bg-accent-soft data-[state=active]:text-accent",
        className,
      )}
      {...props}
    />
  );
}

export const TabsContent = TabsPrimitive.Content;
