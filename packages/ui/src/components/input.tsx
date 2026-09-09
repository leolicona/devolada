import { cloneElement, useId, type ComponentType, type InputHTMLAttributes, type ReactElement } from "react";
import { cn } from "../lib/cn";

/* The one text field (design-foundations D6; constitution VI). This file
   replaced apps/admin/src/components/ui/input.tsx, whose only real difference
   was height: 40px for a pointer, against this one's 48px for a thumb. That
   is a size, not a second component.

   The admin wrote its colours through shadcn's aliases — border-input,
   focus:border-ring, text-foreground — which exist only in
   apps/admin/src/styles.css. Each resolves to the same custom property as the
   name used here, so the merge changes no pixel; it just stops the payer's
   page from depending on a stylesheet it does not load. */

const SIZES = {
  /* --size-touch: the counter-height default */
  standard: {
    field: "h-12 text-base",
    lead: { icon: "pl-12 pr-4", prefix: "pl-8 pr-4", none: "px-4" },
    icon: "left-4 size-5",
    prefix: "left-4 text-base",
  },
  /* The back office, where a pointer does the aiming. Clears WCAG 2.2 SC
     2.5.8 (24px) comfortably; it is below the 44px AAA target on purpose. */
  compact: {
    field: "h-10 text-sm",
    lead: { icon: "pl-9 pr-3", prefix: "pl-7 pr-3", none: "px-3" },
    icon: "left-3 size-4",
    prefix: "left-3 text-sm",
  },
} as const;

export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "size"> {
  icon?: ComponentType<{ className?: string }>;
  /* design-review D8: a field that takes money shows the sign every
     displayed amount already carries. */
  prefix?: string;
  /* Shadows the native `size` attribute, which counts characters and which
     nothing in this product uses. */
  size?: keyof typeof SIZES;
}

export function Input({ icon: Icon, prefix, className, size = "standard", ...props }: InputProps) {
  const spec = SIZES[size];
  const lead = Icon ? spec.lead.icon : prefix ? spec.lead.prefix : spec.lead.none;
  const field = (
    <input
      className={cn(
        /* border-line-input, not border-line: a field must be findable
           (polish/dark-and-contrast.spec.md D4, WCAG 1.4.11) */
        "w-full rounded-sm border border-line-input bg-well text-ink placeholder:text-ink-faint focus:border-focus focus-visible:outline-none disabled:text-ink-faint",
        spec.field,
        /* design-review D7: the UA's own clear button paints in the
           browser's accent and sits outside our token system. */
        "[&::-webkit-search-cancel-button]:hidden",
        lead,
        className,
      )}
      {...props}
    />
  );
  if (!Icon && !prefix) return field;
  return (
    <div className="relative">
      {Icon && (
        <Icon
          className={cn(
            "pointer-events-none absolute top-1/2 -translate-y-1/2 text-ink-faint",
            spec.icon,
          )}
          aria-hidden
        />
      )}
      {prefix && (
        <span
          className={cn(
            "pointer-events-none absolute top-1/2 -translate-y-1/2 text-ink-soft",
            spec.prefix,
          )}
          aria-hidden
        >
          {prefix}
        </span>
      )}
      {field}
    </div>
  );
}

/* Label wrapper: keeps inputs reachable by getByLabelText in tests
   and consistent label typography everywhere.

   The label points at the field by id rather than wrapping it. Wrapping
   made the label's text everything inside it, so the "$" a money field
   shows (design-review D8) became part of the field's name. */
export function Field({
  label,
  children,
}: {
  label: string;
  children: ReactElement<{ id?: string }>;
}) {
  const generated = useId();
  const id = children.props.id ?? generated;
  return (
    <div className="block">
      <label htmlFor={id} className="mb-2 block text-sm font-medium text-ink-soft">
        {label}
      </label>
      {cloneElement(children, { id })}
    </div>
  );
}
