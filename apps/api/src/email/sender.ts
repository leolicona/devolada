import type { Bindings } from "../env";

/* Provider-agnostic auth-link sender (spec D6, TD-003 spirit).
   With RESEND_API_KEY it posts to Resend; without it (dev) it logs the
   link so the flow stays fully testable. Copy is es-MX product copy. */

const templates = {
  verify: {
    subject: "Confirma tu correo — Devolada",
    body: (link: string) =>
      `<p>Confirma tu correo para empezar a operar en Devolada.</p><p><a href="${link}">Confirmar correo</a></p><p>Si no creaste esta cuenta, ignora este mensaje.</p>`,
  },
  recover: {
    subject: "Restablece tu contraseña — Devolada",
    body: (link: string) =>
      `<p>Recibimos una solicitud para restablecer tu contraseña.</p><p><a href="${link}">Crear nueva contraseña</a></p><p>Si no fuiste tú, ignora este mensaje.</p>`,
  },
} as const;

export async function sendAuthLink(
  env: Bindings,
  kind: keyof typeof templates,
  to: string,
  link: string,
): Promise<void> {
  if (!env.RESEND_API_KEY) {
    console.log(`[email:${kind}] ${to} → ${link}`);
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
      subject: templates[kind].subject,
      html: templates[kind].body(link),
    }),
  });
  if (!res.ok) throw new Error(`resend failed: ${res.status}`);
}
