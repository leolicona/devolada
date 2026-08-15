import { cloneElement, useId, type ComponentType, type InputHTMLAttributes, type ReactElement } from "react";
import { cn } from "../lib/cn";

/* Text input at counter height (48px) with an optional leading icon or
   currency sign. */

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  icon?: ComponentType<{ className?: string }>;
  /* design-review D8: a field that takes money shows the sign every
     displayed amount already carries. */
  prefix?: string;
}

export function Input({ icon: Icon, prefix, className, ...props }: InputProps) {
  const lead = Icon ? "pl-12 pr-4" : prefix ? "pl-8 pr-4" : "px-4";
  const field = (
    <input
      className={cn(
        /* border-line-input, not border-line: a field must be findable
           (polish/dark-and-contrast.spec.md D4, WCAG 1.4.11) */
        "h-12 w-full rounded-sm border border-line-input bg-well text-base text-ink placeholder:text-ink-faint focus:border-focus disabled:text-ink-faint",
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
          className="pointer-events-none absolute top-1/2 left-4 size-5 -translate-y-1/2 text-ink-faint"
          aria-hidden
        />
      )}
      {prefix && (
        <span
          className="pointer-events-none absolute top-1/2 left-4 -translate-y-1/2 text-base text-ink-soft"
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
