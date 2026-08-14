import type { ButtonHTMLAttributes } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../lib/cn";

/* The visual recipes for buttons live here and nowhere else
   (ARCHITECTURE.md: repeating a Tailwind recipe is drift).
   - primary: accent action
   - secondary: bordered neutral
   - ghost: text-only, for actions that must not compete (logout)
   - size md: 48px (--size-touch) · size critical: 64px (--size-touch-lg),
     full-width — reserved for the charge path's decisive actions. */

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 rounded-md transition-colors duration-150",
  {
    variants: {
      variant: {
        primary:
          "bg-accent text-ink-inverse hover:bg-accent-hover active:bg-accent-active disabled:bg-well disabled:text-ink-faint",
        secondary:
          "border border-line bg-card text-ink hover:bg-well disabled:text-ink-faint disabled:hover:bg-card",
        ghost: "text-ink-soft hover:text-ink disabled:text-ink-faint",
      },
      size: {
        md: "h-12 px-6 text-base font-medium",
        critical: "h-16 w-full text-md font-semibold",
      },
    },
    defaultVariants: { variant: "primary", size: "md" },
  },
);

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

export function Button({ variant, size, className, type = "button", ...props }: ButtonProps) {
  return (
    <button
      type={type}
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  );
}

export { buttonVariants };
