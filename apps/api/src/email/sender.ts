import type { Bindings } from "../env";

/* Auth code sender (better-auth.spec.md D4, D9). Codes, never links: a
   link signs in the device that opens the email; a code is read anywhere
   and typed where the session belongs. Copy is es-MX product copy.
   With RESEND_API_KEY it posts to Resend; without it (dev) it logs the
   code so the flow stays fully testable. */

const templates = {
  "email-verification": {
    subject: (otp: string) => `${otp} es tu código para confirmar tu correo — Devolada`,
    body: (otp: string) =>
      `<p>Escribe este código en Devolada para confirmar tu correo:</p><p style="font-size:24px;font-weight:bold;letter-spacing:4px">${otp}</p><p>Si no fuiste tú, ignora este mensaje.</p>`,
  },
  "sign-in": {
    subject: (otp: string) => `${otp} es tu código para entrar — Devolada`,
    body: (otp: string) =>
      `<p>Escribe este código en Devolada para entrar:</p><p style="font-size:24px;font-weight:bold;letter-spacing:4px">${otp}</p><p>Si no fuiste tú, ignora este mensaje.</p>`,
  },
  "forget-password": {
    subject: (otp: string) => `${otp} es tu código para recuperar tu acceso — Devolada`,
    body: (otp: string) =>
      `<p>Escribe este código en Devolada para crear una nueva contraseña:</p><p style="font-size:24px;font-weight:bold;letter-spacing:4px">${otp}</p><p>Si no fuiste tú, ignora este mensaje.</p>`,
  },
} as const;

export type AuthCodeKind = keyof typeof templates;

export async function sendAuthCode(
  env: Bindings,
  kind: string,
  to: string,
  otp: string,
): Promise<void> {
  const template = templates[kind as AuthCodeKind] ?? templates["email-verification"];
  if (!env.RESEND_API_KEY) {
    console.log(`[código:${kind}] ${to} → ${otp}`);
    return;
  }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: env.EMAIL_FROM ?? "Devolada <onboarding@resend.dev>",
      to,
      subject: template.subject(otp),
      html: template.body(otp),
    }),
  });
  if (!res.ok) throw new Error(`resend failed: ${res.status}`);
}
