/* cash-at-stores D31 (FR-043): the store receipt's message is a platform
   template the operator edits in Reglas. Pure data and one pure check —
   no server import — so the panel checks a draft by the same rules the
   API saves by, before it saves (constitution III: one contract). */

/* The placeholders, in Spanish because the operator reads them */
export const RECEIPT_PLACEHOLDERS = [
  "negocio",
  "tienda",
  "folio",
  "cliente",
  "monto",
  "cargo",
  "total",
  "fecha",
  "hora",
  "pendiente",
  "estado",
] as const;
export type ReceiptPlaceholder = (typeof RECEIPT_PLACEHOLDERS)[number];

/* What each one is filled with, as the Reglas tab lists it */
export const RECEIPT_PLACEHOLDER_HELP: Record<ReceiptPlaceholder, string> = {
  negocio: "el nombre del negocio",
  tienda: "el nombre de la tienda",
  folio: "el folio del pago (obligatorio)",
  cliente: "el nombre del cliente",
  monto: "lo que se aplicó al adeudo",
  cargo: "el cargo por servicio",
  total: "monto más cargo",
  fecha: "la fecha del pago",
  hora: "la hora del pago",
  pendiente: "«Queda por pagar: $X» si el pago no cubrió todo; si no, nada",
  estado: "lo que pasó con el servicio",
};

/* D31: 20–1000 characters, `{folio}` required, only the names above */
export const RECEIPT_TEMPLATE_MIN = 20;
export const RECEIPT_TEMPLATE_MAX = 1000;

/* D31's default — the customer reads *pago*, never *cobro* (D27) */
export const DEFAULT_RECEIPT_TEMPLATE = `Comprobante de pago · {negocio}

Folio: {folio}
Cliente: {cliente}
Pagaste: {monto}
Cargo por servicio: {cargo}
Total: {total}
{pendiente}
Tienda: {tienda}
Fecha: {fecha}, {hora}

{estado}
Guarda este folio como comprobante.`;

/* Every `{name}` the text uses — a brace pair around letters, the only
   shape a placeholder takes */
export function placeholdersIn(text: string): string[] {
  return [...text.matchAll(/\{([a-zA-ZáéíóúñÁÉÍÓÚÑ_]+)\}/g)].map((m) => m[1]);
}

export type TemplateProblem =
  | { kind: "length" }
  | { kind: "missing_folio" }
  | { kind: "unknown_placeholder"; name: string };

/* The first reason a draft cannot be saved, or null. The panel names it
   (FR-043); the API refuses it with INVALID_SETTING. */
export function receiptTemplateProblem(text: string): TemplateProblem | null {
  const trimmed = text.trim();
  if (trimmed.length < RECEIPT_TEMPLATE_MIN || trimmed.length > RECEIPT_TEMPLATE_MAX) return { kind: "length" };
  const unknown = placeholdersIn(trimmed).find((p) => !(RECEIPT_PLACEHOLDERS as readonly string[]).includes(p));
  if (unknown) return { kind: "unknown_placeholder", name: unknown };
  if (!placeholdersIn(trimmed).includes("folio")) return { kind: "missing_folio" };
  return null;
}
