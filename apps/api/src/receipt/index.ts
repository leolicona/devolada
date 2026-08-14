import { charges } from "../db/schema";

/* The receipt (receipt spec). The API owns the text (D2): the same words
   must reach the customer whether the shopkeeper sends them from their
   own WhatsApp today or a provider sends them later. */

type Charge = typeof charges.$inferSelect;

const pesos = (cents: number) =>
  (cents / 100).toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/* D5: the message says what actually happened to the service */
const statusLine: Record<Charge["reconnectionStatus"], string> = {
  reconnected: "Tu internet ya está activo.",
  queued: "Tu internet se reactiva en unos minutos.",
  failed: "Tu pago quedó registrado. Si tu internet sigue sin servicio, comunícate con tu proveedor y menciona tu folio.",
};

export function receiptText(charge: Charge, storeName: string): string {
  return [
    `Comprobante de pago Devolada`,
    ``,
    `Folio: ${charge.folio}`,
    `Cliente: ${charge.customerName}`,
    `Mensualidad: $${pesos(charge.monthlyFeeCents)}`,
    `Cargo por servicio: $${pesos(charge.serviceFeeCents)}`,
    `Total pagado: $${pesos(charge.totalCents)}`,
    `Pagaste en: ${storeName}`,
    ``,
    statusLine[charge.reconnectionStatus],
    `Guarda este folio como comprobante.`,
  ].join("\n");
}

/* WhatsApp needs digits with a country code. Mexican numbers arrive from
   WispHub in whatever shape the ISP typed them: 10 digits, with 52, with
   +52, with spaces or dashes. Anything we cannot read confidently becomes
   null and the link drops the number (D3) rather than opening a stranger's
   chat. */
export function toWhatsAppPhone(raw: string | null): string | null {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 10) return `52${digits}`;
  if (digits.length === 12 && digits.startsWith("52")) return digits;
  /* 521XXXXXXXXXX: the old WhatsApp-only "1" that Mexico no longer needs */
  if (digits.length === 13 && digits.startsWith("521")) return `52${digits.slice(3)}`;
  return null;
}

/* D3: no number is not a dead end — WhatsApp opens its contact picker */
export function whatsAppLink(text: string, phone: string | null): string {
  const encoded = encodeURIComponent(text);
  return phone ? `https://wa.me/${phone}?text=${encoded}` : `https://wa.me/?text=${encoded}`;
}
