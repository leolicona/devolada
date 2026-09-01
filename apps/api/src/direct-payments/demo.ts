import type { Bindings } from "../env";
import type { ConstaVerdict } from "../consta/client";
import type { payments, businesses, paymentLinks } from "../db/schema";

/* TD-015 — a simulated `valid` verdict for a demo, and nothing else.

   Why this exists: a CEP has no measured upper bound on publication.
   Measured 2026-08-19 (docs/integrations/apicep.md): two real transfers
   whose money had already been delivered were polled 30 times through
   T+62 min and never produced a CEP. A transfer made live in front of an
   audience therefore does not reach a green screen — with a *healthy*
   Banxico. The outage everyone worries about is the smaller problem.

   What this is NOT: it never turns a failure into a success. There is no
   "if the validation fails, confirm it anyway" branch here or anywhere
   else. The only payment that reaches this code is one on a link named,
   by hand, in this environment's `DEMO_LINK_TOKENS` — a decision taken
   minutes before a demo, never a reaction to a provider that said no. A
   real customer whose CEP is late still rides the D7 schedule exactly as
   it did before, and D17 still holds: we do not call a payer a liar.

   Three locks, all of which must open:
     1. `ENVIRONMENT === "dev"`. Prod carries no `DEMO_LINK_TOKENS` and
        never will — and this check means it would not matter if it did.
     2. The link token is on the allow-list. Not the ISP, not the
        customer, not a magic clave: one link at a time.
     3. Somebody edited `wrangler.jsonc` and deployed. The list is a var,
        not a secret and not a database row, so removing the demo is one
        deleted line and one deploy — and the diff says so out loud. */

type DirectPayment = typeof payments.$inferSelect;
type PaymentLink = typeof paymentLinks.$inferSelect;
type Isp = typeof businesses.$inferSelect;

function demoTokens(env: Bindings): string[] {
  return (env.DEMO_LINK_TOKENS ?? "")
    .split(",")
    .map((token) => token.trim())
    .filter(Boolean);
}

export function isDemoLink(env: Bindings, link: PaymentLink): boolean {
  if (env.ENVIRONMENT !== "dev") return false;
  return demoTokens(env).includes(link.token);
}

/* The verdict the provider would have returned had the CEP been
   published. It has to satisfy the checks `runValidation` runs *after* a
   `valid` — the amount equality (D11) and the staleness window (D11) —
   or the simulation would be refused by our own rules and the demo would
   show a red screen for a reason nobody in the room could guess. So the
   amount is the payment's own and the date is today.

   `senderName` is the one field a human reads afterwards, so it says
   what this row is. It lands in `cep_sender_name` and stays there. */
export function demoVerdict(payment: DirectPayment, business: Isp, now: Date): ConstaVerdict {
  /* The receipt door claims this key onto the row, so it has to survive
     the same shape check the payer's own input does: alphanumeric, 6–30 */
  const synthetic = `DEMO${payment.id.replace(/[^A-Za-z0-9]/g, "").slice(0, 24).toUpperCase()}`;
  return {
    validationId: `demo-${payment.id}`,
    status: "valid",
    /* Never the replay flag: D8 reads it as a CEP validated outside
       Devolada and refuses the payment. */
    alreadyValidated: false,
    cep: {
      trackingKey: payment.trackingKey ?? synthetic,
      amountCents: payment.amountCents,
      date: now.toISOString().slice(0, 10),
      senderBank: payment.senderBank ?? "DEMO",
      senderName: "PAGO SIMULADO (DEMO)",
      receiverBank: business.speiBank ?? "DEMO",
      beneficiaryName: business.speiBeneficiaryName ?? "DEMO",
    },
  };
}
