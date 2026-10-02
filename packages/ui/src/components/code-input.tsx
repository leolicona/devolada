import type { ClipboardEvent } from "react";
import { Field, Input, type InputProps } from "./input";

/* The código field (passwordless-access D12; constitution VI). Every door
   this product has now ends in six digits — the panel's sign-in and
   registration, the invitation, Seguridad's step-up, the store app — and each
   screen had grown its own hand-made field, some compact, some not, each
   with its own `.replace(/\D/g, "")`. One definition here.

   - `inputMode="numeric"` raises the phone's digit pad; `type` stays "text",
     because a number field drops a leading zero and spins on the wheel.
   - `autoComplete="one-time-code"` lets iOS and Android offer the código
     from the email or the message above the keyboard.
   - The mono face the product keeps for folios and keys, spaced out, so the
     six digits read one by one against the email (the design canvas,
     `input-code`).

   `onChange` receives the digits and nothing else, cut to six: what reaches
   the app is always something it can send. */

export const CODE_LENGTH = 6;

const digitsOf = (raw: string) => raw.replace(/\D/g, "").slice(0, CODE_LENGTH);

export interface CodeInputProps
  extends Omit<
    InputProps,
    | "value"
    | "defaultValue"
    | "onChange"
    | "type"
    | "inputMode"
    | "autoComplete"
    | "maxLength"
    | "icon"
    | "prefix"
    | "className"
  > {
  /* Controlled: the app owns the código, because the app sends it */
  value: string;
  /* Digits only, at most six — never the raw keystrokes */
  onChange: (value: string) => void;
  /* The visible label, and the field's accessible name */
  label?: string;
  /* Shorthand for `aria-invalid`, for the app that just heard the código was
     wrong. The words saying so live in the app's Alert: a field is never
     marked wrong by colour alone (constitution VI). */
  invalid?: boolean;
  /* On the wrapper (label + field), so a screen can place the pair */
  className?: string;
}

export function CodeInput({
  value,
  onChange,
  label = "Código",
  invalid,
  size = "standard",
  className,
  onPaste,
  "aria-invalid": ariaInvalid,
  ...props
}: CodeInputProps) {
  /* A paste is caught before the browser applies `maxLength`, because the
     browser cuts first and filters never: "482 913" is seven characters, so
     the native paste keeps "482 91" and the app would get "48291" — one
     digit short, with no way to tell why. Reading the clipboard ourselves
     keeps all six (passwordless-access D12: "a paste of «482 913» becomes
     «482913»"). Typed keys still go through the native path below. */
  const paste = (event: ClipboardEvent<HTMLInputElement>) => {
    onPaste?.(event);
    if (event.defaultPrevented) return;
    const text = event.clipboardData?.getData("text/plain") ?? "";
    if (!text) return;
    event.preventDefault();
    const field = event.currentTarget;
    const start = field.selectionStart ?? value.length;
    const end = field.selectionEnd ?? value.length;
    onChange(digitsOf(value.slice(0, start) + text + value.slice(end)));
  };

  return (
    <div className={className}>
      <Field label={label}>
        <Input
          {...props}
          size={size}
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={CODE_LENGTH}
          spellCheck={false}
          aria-invalid={invalid || ariaInvalid || undefined}
          value={value}
          onChange={(event) => onChange(digitsOf(event.target.value))}
          onPaste={paste}
          className="font-mono tracking-widest"
        />
      </Field>
    </div>
  );
}
