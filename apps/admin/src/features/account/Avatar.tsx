import { cn } from "@/lib/utils";
import { STEP_COPY } from "../credit/CreditChip";
import type { BusinessActor } from "../auth/session";

/* account-hub D2: no image source exists (the `user.image` column is
   never written), so the avatar is the initials of the person's name. */
export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const first = parts[0]![0] ?? "";
  const last = parts.length > 1 ? (parts[parts.length - 1]![0] ?? "") : "";
  return (first + last).toUpperCase();
}

const SIZES = {
  xs: "size-6 text-[10px]",
  sm: "size-7 text-[11px]",
  lg: "size-14 text-lg",
} as const;

/* account-hub D3: from "Saldo bajo" on, the step's own glyph rides the
   avatar — never color alone; the accessible name is the parent's job
   (the nav item says "Cuenta, saldo bajo"). Decorative on its own. */
export function Avatar({
  name,
  size = "sm",
  step,
  className,
}: {
  name: string;
  size?: keyof typeof SIZES;
  step?: BusinessActor["credit"]["step"];
  className?: string;
}) {
  const marked = step && step !== "ok" ? STEP_COPY[step] : null;
  const Glyph = marked?.icon;
  return (
    <span
      className={cn(
        "relative inline-flex shrink-0 select-none items-center justify-center rounded-full bg-accent-soft font-semibold text-link",
        SIZES[size],
        className,
      )}
      aria-hidden
    >
      {initialsOf(name)}
      {marked && Glyph && (
        <span
          data-testid="avatar-step"
          className={cn(
            "absolute -bottom-1 -right-1 flex items-center justify-center rounded-full border border-card bg-card",
            marked.tone,
          )}
        >
          <Glyph className={size === "lg" ? "size-4" : "size-3"} />
        </span>
      )}
    </span>
  );
}
