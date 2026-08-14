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
        "h-9 rounded-full border border-border px-4 text-sm font-medium text-muted-foreground transition-colors duration-150 hover:text-foreground",
        "data-[state=active]:border-transparent data-[state=active]:bg-accent-soft data-[state=active]:text-link",
        className,
      )}
      {...props}
    />
  );
}

export const TabsContent = TabsPrimitive.Content;
