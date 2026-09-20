import type { ComponentProps, ReactNode } from "react";
import { Alert, Field, Input, inputClassName } from "@devolada/ui";
import { Check, CircleAlert, Clock3 } from "lucide-react";

/* The shared atoms, composed for a page that renders them at build
   (landing-page D2; constitution VI). Astro hands a framework component
   its children as static HTML, so `Field` — which reaches into its child
   for the input's id — cannot wrap an `Input` from an .astro file; here
   the two sit in one React tree and the label points at the field. Same
   for `Alert`, whose icon must be its first child for the icon layout.
   Nothing here is a new recipe: every class comes from the package. Never
   hydrated — no client:* directive names these. */

type FieldProps = { label: string; id: string };

export function LabeledInput({ label, id, ...props }: FieldProps & Omit<ComponentProps<typeof Input>, "id" | "size">) {
  return (
    <Field label={label}>
      <Input id={id} {...props} />
    </Field>
  );
}

/* The one control the package has no atom for: a native <select>, wearing
   the field's own recipe as a class string (`inputClassName`, D2). Native
   on purpose — it works without a script and opens the phone's own picker. */
export function LabeledSelect({
  label,
  id,
  options,
  ...props
}: FieldProps & { options: readonly { value: string; label: string }[] } & Omit<ComponentProps<"select">, "id" | "className">) {
  return (
    <Field label={label}>
      <select id={id} className={inputClassName("standard")} {...props}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </Field>
  );
}

const ICONS = { check: Check, alert: CircleAlert, clock: Clock3 } as const;

/* An outcome or a state in words with its icon — colour never travels
   alone (constitution VI). `data-motion` and the breath class ride through
   `props` for the one Alert on the page that waits (the flow's second
   moment, D25). */
export function Notice({
  icon,
  children,
  ...props
}: { icon: keyof typeof ICONS; children: ReactNode } & Omit<ComponentProps<typeof Alert>, "layout" | "children">) {
  const Icon = ICONS[icon];
  return (
    <Alert layout="icon" {...props}>
      <Icon aria-hidden />
      <span>{children}</span>
    </Alert>
  );
}
