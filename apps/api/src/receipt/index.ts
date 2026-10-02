/* WhatsApp helpers shared by the direct SPEI channel (receipt spec
   D2/D3 heritage): the API owns the message and the number. The store
   receipt text retired to devolada-red, and returns here with the store
   channel (cash-at-stores D31): `renderReceipt` fills the operator's
   template. */

import { nationalPhone } from "../phone";
import { placeholdersIn, RECEIPT_PLACEHOLDERS, type ReceiptPlaceholder } from "./template";

/* WhatsApp needs digits with a country code. Mexican numbers arrive from
   WispHub in whatever shape the ISP typed them: 10 digits, with 52, with
   +52, with spaces or dashes. Anything we cannot read confidently becomes
   null and the link drops the number (D3) rather than opening a stranger's
   chat. payment-without-receipt D2: what "a phone" is lives in the core's
   `nationalPhone`, shared with the payer's reference — this is `52` in
   front of it, the same outputs as before. */
export function toWhatsAppPhone(raw: string | null): string | null {
  const national = nationalPhone(raw);
  return national ? `52${national}` : null;
}

/* D3: no number is not a dead end — WhatsApp opens its contact picker */
export function whatsAppLink(text: string, phone: string | null): string {
  const encoded = encodeURIComponent(text);
  return phone ? `https://wa.me/${phone}?text=${encoded}` : `https://wa.me/?text=${encoded}`;
}

/* cash-at-stores D31: what one receipt says. Money in cents, the moment
   in ms; the renderer formats them in the business's timezone and clock. */
export type ReceiptValues = {
  negocio: string;
  tienda: string;
  folio: string;
  cliente: string;
  montoCents: number;
  cargoCents: number;
  /* What remains owed after a short payment; 0 on a whole one */
  pendienteCents: number;
  at: number;
  timezone: string;
  timeFormat: "12h" | "24h";
  /* The outcome's sentence (D18) */
  estado: string;
};

/* Constitution II: es-MX, MXN, never a float in between — cents divided
   only at the formatter's door */
const money = (cents: number) =>
  new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" }).format(cents / 100);

/* cash-at-stores D31: fill the template. A line that held a placeholder
   and is empty once filled is dropped, so `{pendiente}` costs nothing on
   a whole payment; a line the operator left blank stays. An unknown
   placeholder never reaches here (the save refuses it), and would stay as
   typed rather than vanish. */
export function renderReceipt(template: string, v: ReceiptValues): string {
  const date = new Intl.DateTimeFormat("es-MX", {
    timeZone: v.timezone,
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(v.at);
  const time = new Intl.DateTimeFormat("es-MX", {
    timeZone: v.timezone,
    hour: "numeric",
    minute: "2-digit",
    hour12: v.timeFormat === "12h",
  }).format(v.at);
  const filled: Record<ReceiptPlaceholder, string> = {
    negocio: v.negocio,
    tienda: v.tienda,
    folio: v.folio,
    cliente: v.cliente,
    monto: money(v.montoCents),
    cargo: money(v.cargoCents),
    total: money(v.montoCents + v.cargoCents),
    fecha: date,
    hora: time,
    pendiente: v.pendienteCents > 0 ? `Queda por pagar: ${money(v.pendienteCents)}` : "",
    estado: v.estado,
  };
  const known = new Set<string>(RECEIPT_PLACEHOLDERS);
  return template
    .replace(/\r\n/g, "\n")
    .split("\n")
    .flatMap((line) => {
      const out = line.replace(/\{([a-zA-ZáéíóúñÁÉÍÓÚÑ_]+)\}/g, (whole, name: string) =>
        known.has(name) ? filled[name as ReceiptPlaceholder] : whole,
      );
      return placeholdersIn(line).length > 0 && out.trim() === "" ? [] : [out];
    })
    .join("\n")
    .trim();
}
