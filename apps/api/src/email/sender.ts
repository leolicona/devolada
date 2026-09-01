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

/* business-and-memberships D8: a member invitation. The link opens the
   admin's accept page; an invitee who already has an account just gains
   the membership (US-B02). es-MX product copy. */
const ROLE_LABELS: Record<string, string> = {
  owner: "Dueño",
  admin: "Administrador",
  operator: "Operador",
  viewer: "Lector",
};

export async function sendMemberInvitation(
  env: Bindings,
  to: string,
  invite: { businessName: string; role: string; inviterName: string; invitationId: string },
): Promise<void> {
  const url = `${env.ADMIN_BASE_URL}/invitaciones/${invite.invitationId}`;
  const label = ROLE_LABELS[invite.role] ?? invite.role;
  if (!env.RESEND_API_KEY) {
    console.log(`[invitación] ${to} → ${invite.businessName} como ${label}: ${url}`);
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
      subject: `${invite.inviterName} te invita a ${invite.businessName} en Devolada`,
      html: `<p>${invite.inviterName} te invitó a <strong>${invite.businessName}</strong> como <strong>${label}</strong>.</p><p><a href="${url}">Aceptar la invitación</a></p><p>Si no esperabas este correo, ignóralo.</p>`,
    }),
  });
  if (!res.ok) throw new Error(`resend failed: ${res.status}`);
}

/* prepaid-credit D7: two emails that change what an owner would do today —
   the balance reached zero, or the business entered the pause. Once per
   crossing, never one per validation. es-MX product copy. */
export async function sendCreditCrossing(
  env: Bindings,
  to: string[],
  kind: "empty" | "paused",
  businessName: string,
): Promise<void> {
  if (to.length === 0) return;
  const url = `${env.ADMIN_BASE_URL}/settings`;
  const subject =
    kind === "empty"
      ? `${businessName}: tu saldo llegó a cero — Devolada`
      : `${businessName}: validación en pausa — Devolada`;
  const body =
    kind === "empty"
      ? `<p>El saldo de <strong>${businessName}</strong> llegó a cero. Los pagos de tus clientes se siguen validando por unos días más; recarga para no llegar a la pausa.</p><p><a href="${url}">Recargar saldo</a></p>`
      : `<p><strong>${businessName}</strong> entró en pausa: los comprobantes nuevos de tus clientes quedan guardados sin validarse hasta que recargues.</p><p><a href="${url}">Recargar saldo</a></p>`;
  if (!env.RESEND_API_KEY) {
    console.log(`[saldo:${kind}] ${to.join(", ")} → ${subject}`);
    return;
  }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: env.EMAIL_FROM ?? "Devolada <onboarding@resend.dev>", to, subject, html: body }),
  });
  if (!res.ok) throw new Error(`resend failed: ${res.status}`);
}

/* provisional-release D8 (US-D15): the one exception the ISP signed up
   to know about — a provisionally released payment that expired with the
   debt still pending. The promise lapses on its own; the ISP's bank app
   is the last arbiter. Copy is es-MX product copy, like the codes. */
export async function sendProvisionalExpiry(
  env: Bindings,
  to: string,
  customer: { name: string; usuario: string },
): Promise<void> {
  const subject = `Reconexión provisional sin confirmar — ${customer.name}`;
  const html =
    `<p>El pago de <strong>${customer.name}</strong> (${customer.usuario}) no fue ` +
    `confirmado por Banxico en 6 horas y su servicio estaba liberado provisionalmente.</p>` +
    `<p>Su deuda sigue pendiente y la promesa de pago vence sola, así que el corte ` +
    `vuelve a aplicar según WispHub. Si el cliente te muestra su comprobante, ` +
    `verifica la transferencia en tu app del banco — puedes registrar su pago a mano.</p>`;
  if (!env.RESEND_API_KEY) {
    console.log(`[provisional-expiry] ${to} → ${customer.usuario}`);
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
      subject,
      html,
    }),
  });
  if (!res.ok) throw new Error(`resend failed: ${res.status}`);
}
