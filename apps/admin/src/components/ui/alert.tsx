import { type HTMLAttributes } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const alertVariants = cva("rounded-md border px-4 py-3 text-sm font-medium", {
  variants: {
    variant: {
      default: "border-border bg-muted text-muted-foreground",
      warning: "border-warning-line bg-warning-soft text-warning",
      destructive: "border-error-line bg-error-soft text-error",
      success: "border-success-line bg-success-soft text-success",
    },
  },
  defaultVariants: { variant: "default" },
});

export interface AlertProps
  extends HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof alertVariants> {}

export function Alert({ className, variant, ...props }: AlertProps) {
  return <div role="alert" className={cn(alertVariants({ variant }), className)} {...props} />;
}
