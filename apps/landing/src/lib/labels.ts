import type { BillingSystem } from "@devolada/api/landing-schema";

/* es-MX labels for the contract's billing-system values (landing-page D7,
   D23) — the same arrangement the bank list and the role matrix use: the
   API decides with the value, the page and the admin speak the label. The
   supported system appears on the page only here, as an answer (FR-007). */
export const BILLING_SYSTEM_LABELS: Record<BillingSystem, string> = {
  wisphub: "WispHub",
  own_software: "Mi propio sistema",
  other: "Otro",
  none: "Todavía ninguno",
};

/* HTML's `pattern` attribute anchors the expression itself, so the schema's
   `^` and `$` come off (D7). */
export const htmlPattern = (re: RegExp) => re.source.replace(/^\^/, "").replace(/\$$/, "");
