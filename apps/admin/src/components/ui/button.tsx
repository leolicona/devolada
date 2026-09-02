import { type ButtonHTMLAttributes } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

/* shadcn-style button, themed by tokens (spec D1).
   design-review D6: disabled is a different fill, not a lower opacity. A
   washed accent reads as a low-contrast enabled button — worst in dark,
   where the two sat two cards apart and looked the same. */
const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 rounded-md font-medium transition-colors duration-150 disabled:pointer-events-none disabled:bg-well disabled:text-ink-faint disabled:border-line focus-visible:outline-none",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-accent-hover active:bg-accent-active",
        outline: "border border-border bg-card text-foreground hover:bg-muted",
        ghost: "text-muted-foreground hover:bg-muted hover:text-foreground disabled:bg-transparent",
        destructive: "bg-destructive text-destructive-foreground hover:opacity-90",
        /* The text-link button: "Reenviar código", "Cerrar sesión" and
           their kin, once six hand-rolled <button>s (design review
           identidad-2). Inline, no box, the link colour. */
        link: "text-link hover:underline disabled:bg-transparent disabled:text-ink-faint",
      },
      size: {
        default: "h-10 px-5 text-sm",
        lg: "h-12 px-6 text-base",
        icon: "h-10 w-10",
      },
    },
    /* A link has no box: the size's height and padding leave with it */
    compoundVariants: [{ variant: "link", class: "h-auto rounded-none p-0 text-sm" }],
    defaultVariants: { variant: "default", size: "default" },
  },
);

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

export function Button({ className, variant, size, type = "button", ...props }: ButtonProps) {
  return <button type={type} className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}
