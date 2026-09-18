# Bug Assessment: an existing customer can be looked up as "not found", and the payment is then filed as if they owed nothing

- **Slug**: customer-lookup-misses
- **Created**: 2026-09-18
- **Source**: pasted text — no URL supplied, so nothing was fetched and the URL trust policy did not apply. The report is the gap named at the end of `specs/007-provider-address-per-isp/spec.md` ("Deferred", item 1); assessing it against the code widened it.
- **Verdict**: valid
- **Severity**: high

## Report (summarized)

Carried out of the 007 spec session. The reported symptom was narrow: *a
payment link whose customer no longer exists in the ISP's system keeps
resolving for a payer, takes their money, and the reconnection then fails.*

Reading the code to assess it found the narrow case is largely handled — and a
wider one is not. The condition that matters is not "the customer was
deleted". It is **`getCustomer` returning null**, which happens for existing
customers too.

## Symptom

When `getCustomer(usuario)` returns null, a confirmed payment is filed as
`unapplied` with class `over` — the state that means *money arrived against a
debt of zero*. Nothing is registered in the ISP's system and nobody is
reconnected. The ISP sees the payment in the feed with a reason that is not
true: the customer is not debt-free, Devolada simply did not find them.

Expected: Devolada distinguishes "this customer owes nothing" from "I could
not identify this customer", and never reports the second as the first.

## Reproduction

The lookup resolves the customer through a filter chosen by the *shape of the
string*, not by what the string is:

```
apps/api/src/wisphub/client.ts:95
  if (/^\d+$/.test(q)) return "telefono";
  if (q.includes("@"))  return "usuario";
  return "nombre";
```

`getCustomer` then asks for the match by exact usuario over whatever that
filter returned (`client.ts:241`). So:

1. Connect a business whose customers' usuarios are **all digits** (a contract
   or client number). Devolada queries `/clientes/?telefono=<usuario>`.
2. Create a payment link for one of them and confirm a payment against it.
3. The phone filter does not match the usuario, `searchCustomers` returns
   other people or nobody, `matches.find(c => c.usuario === usuario)` returns
   null.
4. The payment lands `unapplied` / `over`. Nothing reaches the ISP's system.

The same holds for a usuario that is a plain word (`juanperez`): the query
goes to `/clientes/?nombre=juanperez`, which filters on the customer's **name**,
not their username. The archive records these filters as exact-match and the
parameter choice as a guess (`integrations/wisphub.md`, the `listCustomersFull`
note — "WispHub's own filters are exact-match and the param was guessed").

Only a usuario containing `@` takes the correct branch. Every `getCustomer`
fixture in the suite is of that shape — `greyes@wifiplus`, `otro@wifiplus`,
`0011@wifiplus` — which is why the suite is green and why this has never been
seen. No test exercises the `nombre` or `telefono` branch of an identity
lookup.

[NEEDS CLARIFICATION: whether any real tenant uses non-`@` usuarios. The
provider's default convention appears to be `user@ispname`, which is why the
demo tenant is unaffected. The pilot ISP's convention is unknown and this
session could not call either host to check.]

## Suspected Code Paths

- `apps/api/src/wisphub/client.ts:95` — `queryParamFor`, a heuristic written
  for a human typing into a search box (cited as `D1`, "the query type is
  detected, not selected"), reused unchanged for identity resolution.
- `apps/api/src/wisphub/client.ts:241` — `getCustomer` builds an exact-identity
  answer on top of that heuristic search.
- `apps/api/src/direct-payments/validation.ts:652` — `wisphub.getCustomer(link.customerUsuario)`,
  the call whose null answer this is about.
- `apps/api/src/direct-payments/validation.ts:662,666` — `debt = customer ? debtOf(...) : NO_DEBT`
  and `provenSettled = pending.complete || customer?.billingStatus === "paid"`.
  A null customer contributes nothing, so a complete invoice list alone
  "proves" a settled debt. **This is where a lookup miss becomes a business
  verdict.**
- `apps/api/src/direct-payments/validation.ts:672-685` — the `unapplied` /
  `over` branch, which writes `customerName: customer?.name ?? link.customerUsuario`
  — the codebase already knows `customer` may be null here and degrades the
  *display*, without questioning the *verdict*.
- `apps/api/src/direct-payments/validation.ts:693` — the other exit:
  `ispDebtCents = debt.totalCents || (customer?.planPriceCents ?? payment.invoiceCents)`.
  Reached when the invoice list is truncated (`pending.complete === false`, a
  large tenant). A null customer then proceeds to dispatch against a usuario
  that was never resolved.
- `apps/api/src/wisphub/reconnection.ts:69-75` — that dispatch calls
  `findPendingInvoiceId` then `createInvoice` for the unresolved usuario. The
  provider rejects it; `client.ts` maps every non-2xx to
  `WISPHUB_UNAVAILABLE`, so a permanent condition is retried on the outage
  schedule until it is spent.

## Root Cause Hypothesis

**Confidence: high** on the defect, **medium** on how often it fires today.

Two defects, one call site.

The first is that `getCustomer` resolves an identity through a filter picked by
the string's shape. That heuristic is right for the search box it was written
for, where a human may type a phone, an email or a name. It is wrong for
`getCustomer`, whose input is always a usuario and never ambiguous. For any
usuario without `@`, Devolada asks the provider the wrong question and
believes the empty answer.

The second is that a null customer is read as *no debt* rather than as *no
answer*. `debtOf` is skipped, `NO_DEBT` stands in, and `pending.complete`
alone then satisfies `provenSettled`. The existing comment at that branch
defends the opposite case carefully — "a truncated list cannot prove 'owes
nothing', but `saldo` is never truncated and it said nothing either" — but
`saldo` says nothing here because there is no customer to read it from. The
guard reasons about a customer that was found.

The second defect is the one that turns a lookup miss into money filed wrong.
It would matter even if the first were fixed, because a genuinely deleted
customer reaches the same branch — which is the case originally reported.

## Proposed Remediation

**Preferred**: separate identity resolution from search, then make a null
customer a non-verdict.

1. Give the adapter an exact lookup that always asks by usuario
   (`/clientes/?usuario=<usuario>`) and does not consult `queryParamFor`.
   Leave `queryParamFor` and `searchCustomers` exactly as they are — the
   search box is not broken and its `D1` decision still stands.
2. At `validation.ts:662`, stop letting a null customer reach the settled
   branch. A customer that could not be read is an unresolved payment, not a
   zero debt: return `retryLater` with a distinct code, so the row keeps its
   proof and its schedule instead of being closed as `over`.
3. When the retries are spent, the payment must land in a state whose reason
   is true — the customer could not be identified — and not in one that tells
   the ISP the customer was debt-free.

This also settles the originally reported case. A deleted customer becomes an
unresolved payment the ISP can see and act on, rather than an `over` that
invites them to refund money the customer may genuinely owe.

**Alternatives**:

- *Fix only `queryParamFor`.* Smaller, and removes the common trigger, but
  leaves a deleted customer still filed as `over`. The reported bug survives.
- *Fix only the null handling.* Makes every verdict honest, but an ISP with
  numeric usuarios then has every payment sit unresolved instead of being
  mis-filed — visible, correct, and still unusable for them.

Both defects are one afternoon together and neither is complete alone.

**Files likely to change**:

- `apps/api/src/wisphub/client.ts`
- `apps/api/src/direct-payments/validation.ts`
- `apps/api/test/direct-payment.test.ts`
- `apps/api/test/payment-classes.test.ts`

**Tests to add or update**:

- `getCustomer` resolves a numeric usuario and a plain-word usuario, asserting
  the request goes to `usuario=` — the two branches no fixture covers today.
- A confirmed payment whose customer cannot be read does **not** land
  `unapplied`/`over`, with a complete invoice list present (the condition that
  currently satisfies `provenSettled`).
- The truncated-list path (`pending.complete === false`, customer null) does
  not dispatch to the provider.
- A genuinely deleted customer ends in a state whose reason names the
  identification failure.

## Risks & Considerations

- **Money law.** Both the current behaviour and the fix decide whether a
  payment is treated as settled. Changing `provenSettled` touches the branch
  that stops a second provider payment being registered (D14); the fix must
  not open that door while closing this one.
- **A verdict change is visible history.** Payments already filed `unapplied`/
  `over` by this path stay as they are — the fix must not rewrite settled
  rows, per the rule that a later policy change never rewrites a class.
- **Retry pressure.** Turning a null customer into `retryLater` adds rows to
  the schedule. The existing spend-then-fail ceiling bounds it; confirm it is
  reached rather than looping.
- **Latency.** Step 1 changes no call count — it changes one query parameter.
- **Dormant until it isn't.** If every tenant uses `@` usuarios this is
  invisible, which is also why it will arrive as a mystery rather than as a
  bug report. It is worth fixing before the pilot rather than after.

## Open Questions

- [NEEDS CLARIFICATION: does any connected or prospective tenant use usuarios
  without `@`? One roster read answers it and decides whether this is urgent
  or merely latent.]
- [NEEDS CLARIFICATION: does the provider's `usuario=` filter match exactly,
  or partially? The remediation assumes exact. The archive says the filters
  are exact-match but records the parameter choice as a guess.]
- [NEEDS CLARIFICATION: when a customer truly cannot be identified after the
  schedule is spent, should the ISP be offered a way to point the payment at
  the right customer by hand, or is a terminal state with an honest reason
  enough for now?]
