import type { ButtonHTMLAttributes } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../lib/cn";

/* The one button (design-foundations D6; constitution VI). This file
   replaced apps/admin/src/components/ui/button.tsx, which had drifted into a
   second recipe with its own names for the same three sizes and the same
   handful of variants.

   The admin's recipe wrote its colours through shadcn's semantic aliases —
   bg-primary, hover:bg-muted, border-border. Those are declared only in
   apps/admin/src/styles.css, so carrying them here verbatim would have left
   the payer's page rendering an unstyled button with nothing to say so. They
   are written in this package's own tokens instead; every pair resolves to
   the same custom property, so nothing moved on either surface.

   Sizes are declared, not improvised:
   - compact  (40px) the back office, where a pointer does the aiming
   - standard (48px) the default: --size-touch, a thumb's target
   - decisive (64px) the charge path's committing action, full width

   design-review D6: disabled is a DIFFERENT FILL, never a lower opacity. A
   washed accent reads as a low-contrast enabled button — worst in dark, where
   the two sat two cards apart and looked the same. */

const buttonVariants = cva(
  /* No duration here: the theme's --default-transition-duration now carries
     --duration-fast, so a bare transition-colors already obeys the tokens.
     A literal would be drift (design-foundations D15, debt
     unmapped-motion-tokens). */
  "inline-flex items-center justify-center gap-2 rounded-md font-medium transition-colors focus-visible:outline-none disabled:pointer-events-none",
  {
    variants: {
      variant: {
        primary:
          "bg-accent text-ink-inverse hover:bg-accent-hover active:bg-accent-active disabled:bg-well disabled:text-ink-faint disabled:border-line",
        secondary:
          "border border-line bg-card text-ink hover:bg-well disabled:bg-well disabled:text-ink-faint disabled:border-line",
        ghost:
          "text-ink-soft hover:bg-well hover:text-ink disabled:bg-transparent disabled:text-ink-faint",
        destructive:
          "bg-error text-ink-inverse hover:opacity-90 disabled:bg-well disabled:text-ink-faint",
        /* The text-link button: "Reenviar código", "Cerrar sesión" and their
           kin, once six hand-rolled <button>s (design review identidad-2).
           Inline, no box, the link colour. */
        link: "text-link hover:underline disabled:bg-transparent disabled:text-ink-faint",
      },
      size: {
        compact: "h-10 px-5 text-sm",
        standard: "h-12 px-6 text-base",
        decisive: "h-16 w-full text-md font-semibold",
      },
    },
    /* A link has no box: the size's height and padding leave with it */
    compoundVariants: [{ variant: "link", class: "h-auto rounded-none p-0 text-sm" }],
    defaultVariants: { variant: "primary", size: "standard" },
  },
);

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

export function Button({ variant, size, className, type = "button", ...props }: ButtonProps) {
  return (
    <button type={type} className={cn(buttonVariants({ variant, size }), className)} {...props} />
  );
}

export { buttonVariants };
