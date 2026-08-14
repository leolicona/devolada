import type { ButtonHTMLAttributes } from "react";

/* The visual recipes for buttons live here and nowhere else
   (ARCHITECTURE.md: repeating a Tailwind recipe is drift).
   - primary: accent action
   - secondary: bordered neutral
   - size md: 48px (--size-touch) · size critical: 64px (--size-touch-lg),
     full-width — reserved for the charge path's decisive actions. */

const variants = {
  primary:
    "bg-accent text-ink-inverse hover:bg-accent-hover active:bg-accent-active disabled:bg-well disabled:text-ink-faint",
  secondary:
    "border border-line bg-card text-ink hover:bg-well disabled:text-ink-faint disabled:hover:bg-card",
} as const;

const sizes = {
  md: "h-12 px-6 text-base font-medium",
  critical: "h-16 w-full text-md font-semibold",
} as const;

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: keyof typeof variants;
  size?: keyof typeof sizes;
}

export function Button({
  variant = "primary",
  size = "md",
  className = "",
  type = "button",
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={`inline-flex items-center justify-center gap-2 rounded-md transition-colors duration-150 ${variants[variant]} ${sizes[size]} ${className}`}
      {...props}
    />
  );
}
