import { WispHubError, type PaymentMethod, type WispHub } from "./client";
import type { DevoladaMethodLine, DevoladaMethods } from "../routes/integrations/schema";
import type { ActionAttemptInput } from "../integrations/capabilities";

/* Devolada's payment methods in a business's WispHub
   (payment-method-per-channel D1, D4, D5, D15).

   Each channel records under a method the business creates once in its
   own WispHub, with Devolada's exact name, so it can filter and download
   in its system what came in through Devolada (US1, US2). The names are a
   fact about this provider's setup, so they live here and nowhere in the
   core (FR-011, constitution IX); the admin shows them through the
   integration's own contract (D8), never as literals of its own.

   Pure: no I/O. The list comes from `cache.ts` (D3), and the choice is
   made here, at the moment a payment is recorded (D9). */

export type MethodChannel = "spei" | "store";

/* D1 + D15: the name to create and the description to type beside it.
   The description is product copy for the business's own staff, given to
   copy and never checked — the provider's API returns none (R8). The SPEI
   one names the apps (the creator, 2026-10-02): every one of them is a
   SPEI participant or travels over SPEI, and Devolada confirms only what
   Banxico recorded. «No usar en mostrador» repeats FR-008 where the
   counter staff will read it. */
export const DEVOLADA_METHODS: Record<MethodChannel, { name: string; description: string }> = {
  spei: {
    name: "SPEI - LINK.DEVOLADAPAGO",
    description:
      "Pagos SPEI validados por link de Devolada (bancos, Spin, Mercado Pago, CoDi, DiMo). Los registra Devolada; no usar en mostrador.",
  },
  store: {
    name: "CASH - RED.DEVOLADAPAGO",
    description: "Pagos en efectivo en tiendas de la red Devolada. Los registra Devolada; no usar en mostrador.",
  },
};

/* D5: the tolerance is for the person typing the name by hand — the
   provider keeps a name exactly as typed (R8). Accents off, upper case,
   runs of spaces collapsed, no space around `-`, `.` or `·`, ends trimmed:
   `spei-link . devoladapago` is `SPEI - LINK.DEVOLADAPAGO`. Nothing
   fuzzier: a business's own "SPEI LINK" method must not be taken. */
export function normalizeMethodName(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toUpperCase()
    .replace(/\s+/g, " ")
    .replace(/ ?([-.·]) ?/g, "$1")
    .trim();
}

const NORMALIZED: Record<MethodChannel, string> = {
  spei: normalizeMethodName(DEVOLADA_METHODS.spei.name),
  store: normalizeMethodName(DEVOLADA_METHODS.store.name),
};

function matchesOf(methods: PaymentMethod[], channel: MethodChannel): PaymentMethod[] {
  return methods.filter((m) => normalizeMethodName(m.nombre) === NORMALIZED[channel]);
}

/* D4.1, FR-003: the channel's method. Several with the name → the lowest
   id, always, so two pages of one list never disagree. Null when the
   business has not created it. */
export function devoladaMethodFor(methods: PaymentMethod[], channel: MethodChannel): PaymentMethod | null {
  const found = matchesOf(methods, channel);
  return found.length ? found.reduce((a, b) => (b.id < a.id ? b : a)) : null;
}

/* US4: how many of the business's methods carry the channel's name — the
   setup block's found / missing / duplicate */
export function devoladaMatches(methods: PaymentMethod[], channel: MethodChannel): number {
  return matchesOf(methods, channel).length;
}

function isDevoladas(method: PaymentMethod): boolean {
  const name = normalizeMethodName(method.nombre);
  return name === NORMALIZED.spei || name === NORMALIZED.store;
}

/* D4.2, FR-012: the cash method — the fallback, and every payment while
   no Devolada method exists. Today's rule (charge-record D6: the first
   name, in the provider's order, that says "efect" or "cash"), skipping
   Devolada's two names. Measured 2026-10-02 (R11): the demo lists
   `CASH - RED.DEVOLADAPAGO` before "Cash", so today's rule would record
   every payment with Devolada's method. Only the two names are set
   aside: a business's own "Devoladapago" stays a candidate, so no
   business's cash method changes. None left → the first method that is
   not Devolada's; still none → the first method, today's answer for a
   business that has only Devolada's. An empty list is today's error. */
export function cashMethodOf(methods: PaymentMethod[]): PaymentMethod {
  if (!methods.length) throw new WispHubError("WISPHUB_UNAVAILABLE", "no payment methods");
  const others = methods.filter((m) => !isDevoladas(m));
  return others.find((m) => /efect|cash/i.test(m.nombre)) ?? others[0] ?? methods[0];
}

/* D8, US4: one line of the setup block — the name and description to
   copy, and whether the business already created it. Two with the name
   count as present: the payments use the oldest (FR-003). */
function lineOf(methods: PaymentMethod[], channel: MethodChannel): DevoladaMethodLine {
  const count = devoladaMatches(methods, channel);
  return {
    ...DEVOLADA_METHODS[channel],
    status: count === 0 ? "missing" : count === 1 ? "found" : "duplicate",
  };
}

/* D8: the block the screen, the connection test and the execution gate
   (D14) read. The network's line only with the store channel on (FR-008):
   a business without it has nothing to create there. */
export function setupBlockOf(methods: PaymentMethod[], storeChannelOn: boolean): DevoladaMethods {
  return {
    checked: true,
    link: lineOf(methods, "spei"),
    network: storeChannelOn ? lineOf(methods, "store") : null,
  };
}

/* D8: always fresh, never from the cache — a business that just created
   a method and comes back to check must see it. A provider that cannot
   answer (an outage, a refused key, an unreadable body) is
   `{ checked: false }`, never "missing" (FR-009). `methods` is the list
   itself when it was read, for the caller that keeps it (D16). */
export async function readDevoladaMethods(
  wisphub: WispHub,
  storeChannelOn: boolean,
): Promise<{ block: DevoladaMethods; methods: PaymentMethod[] | null }> {
  try {
    const methods = await wisphub.listPaymentMethods();
    return { block: setupBlockOf(methods, storeChannelOn), methods };
  } catch (e) {
    if (!(e instanceof WispHubError)) throw e;
    return { block: { checked: false }, methods: null };
  }
}

/* D7: WispHub's `referencia` holds at most 200 characters (R7), counted
   as characters, not bytes */
const REFERENCE_MAX = 200;
/* D7: measured 2026-10-02 (R10, R12) — the middle dot survives the API,
   the invoice view and its PDF; a `-` would blur into the provider's own
   "Forma de Pago: … - Referencia: …" line */
const SEPARATOR = " · ";

/* D7, FR-007: what ties a recording back to Devolada — `folio · clave`
   for SPEI, `folio · tienda` for a store, the folio alone when the clave
   is not known. Nothing about the payer. Only the store's name is ever
   shortened, ending in `…`: the folio finds the payment in Pagos and the
   clave finds the bank line, so neither is cut. Today a store's name is
   at most 80 characters and the folio 9, so the cut is a guard for a
   limit another feature owns. No folio (not expected on a confirmed
   row), no reference: the field is left out. */
export function referenceFor(reference: ActionAttemptInput["recordReference"]): string | undefined {
  const { folio, trackingKey, storeName } = reference;
  if (!folio) return undefined;
  if (trackingKey) return `${folio}${SEPARATOR}${trackingKey}`;
  if (!storeName) return folio;
  const room = REFERENCE_MAX - [...folio].length - SEPARATOR.length;
  const chars = [...storeName];
  const name = chars.length > room ? `${chars.slice(0, room - 1).join("")}…` : storeName;
  return `${folio}${SEPARATOR}${name}`;
}
