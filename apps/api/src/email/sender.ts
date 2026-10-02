import type { Bindings } from "../env";

/* Auth code sender (better-auth.spec.md D4, D9). Codes, never links: a
   link signs in the device that opens the email; a code is read anywhere
   and typed where the session belongs. Copy is es-MX product copy.
   With RESEND_API_KEY it posts to Resend; without it (dev) it logs the
   code so the flow stays fully testable.

   passwordless-access D13 (contracts/codigo-email.md): the `sign-in`
   template is the one email for registration and sign-in alike — the
   server must not say which is happening (FR-005). The digits ride the
   subject so a phone's notification shows them, and the email carries no
   `<a>` and no URL (FR-024). The log line below is a contract too: the API
   suite's `sentCode` reads it (D14).

   PR 2 (D4, D13): the email-verification and password-recovery templates
   left with their doors. Any other kind the plugin still names gets the
   one template — a código never goes out in words nobody chose. */

const templates = {
  "sign-in": {
    subject: (otp: string) => `${otp} es tu código para entrar — Devolada`,
    body: (otp: string) =>
      `<p>Escribe este código en Devolada para entrar:</p><p style="font-size:32px;font-weight:bold;letter-spacing:8px">${otp}</p><p>Vence en 10 minutos.</p><p>Si no fuiste tú, ignora este mensaje.</p>`,
  },
} as const;

export type AuthCodeKind = keyof typeof templates;

export async function sendAuthCode(
  env: Bindings,
  kind: string,
  to: string,
  otp: string,
): Promise<void> {
  const template = templates[kind as AuthCodeKind] ?? templates["sign-in"];
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

/* landing-page D10 (FR-018): a prospect left their WhatsApp on the landing
   page. One email to every platform operator, every field as typed, the
   form it came from and the channel. One attempt, no retry: the caller
   writes the outcome on the request's row, and the operator's list shows
   it (the row is the safety net, not a sweep). Returns the outcome rather
   than throwing, because a mail problem must never lose the request.
   Without RESEND_API_KEY the notice is logged, as the OTP is (constitution
   VIII). es-MX product copy. */
export type AccessRequestNotice = {
  whatsapp: string;
  name: string | null;
  billingSystem: string | null;
  form: string;
  channel: string;
};

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch] ?? ch);

export async function sendAccessRequestNotice(
  env: Bindings,
  request: AccessRequestNotice,
): Promise<{ notifiedAt: number } | { error: string }> {
  const to = (env.PLATFORM_OPERATOR_EMAILS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const subject = `Nuevo WhatsApp — ${request.whatsapp}`;
  const lines = [
    `WhatsApp: ${request.whatsapp}`,
    `Nombre: ${request.name ?? "—"}`,
    `Sistema de facturación: ${request.billingSystem ?? "—"}`,
    `Formulario: ${request.form}`,
    `Canal: ${request.channel}`,
  ];
  if (to.length === 0) {
    console.warn(`[solicitud] sin PLATFORM_OPERATOR_EMAILS — nadie recibe: ${lines.join(" · ")}`);
    return { error: "NO_OPERATOR_EMAILS" };
  }
  if (!env.RESEND_API_KEY) {
    console.log(`[solicitud] ${to.join(", ")} → ${subject} · ${lines.join(" · ")}`);
    return { error: "NO_RESEND_KEY" };
  }
  const html =
    `<p>Alguien dejó su WhatsApp en la página de Devolada.</p><ul>` +
    lines.map((l) => `<li>${escapeHtml(l)}</li>`).join("") +
    `</ul><p>Escríbele en menos de un día hábil.</p>`;
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: env.EMAIL_FROM ?? "Devolada <onboarding@resend.dev>", to, subject, html }),
    });
    if (!res.ok) return { error: `RESEND_${res.status}` };
    return { notifiedAt: Date.now() };
  } catch (err) {
    /* The provider unreachable is an outcome too, not an exception: the
       row says so and the request is already stored. */
    console.warn("[solicitud] Resend unreachable:", err);
    return { error: "RESEND_UNREACHABLE" };
  }
}
