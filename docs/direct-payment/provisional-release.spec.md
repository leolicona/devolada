---
status: proposed
stories: [US-D15]
domain: direct-payment
updated: 2026-08-27
debt: []
---

# Spec: Provisional release — the service is not interrupted while a good-faith transfer validates

By minute two or three, a direct payment has already passed more scrutiny
than most payments ever get: the reader's gate refused everything that was
not a receipt, the classifier's cross-reading made two independent machines
agree on the clave and the amount (reading-check US-D14), or a human typed
the data off their own bank app. What is left is only Banxico's clock — a
publication window measured around an hour, against a customer sitting in
the dark with no internet.

This spec closes that gap: **when a claim carries evidence of good faith,
the service is not interrupted while Banxico confirms.** A suspended
customer is reconnected provisionally; a current customer whose due date is
racing the validation is protected from the cut. The ISP turns it on with
one switch and never touches a dial.

## The vote of confidence

The first design was a whitelist over payment history, and arithmetic
killed it (trust-layer spec, amendment of 2026-08-27): a monthly payer
needs ~5 payments before a decayed sample reaches a useful size, and a
brand-new ISP starts every customer at zero — for a feature whose reason
to exist is the experience *now*. So the model is inverted:

**Trust is the default. Evidence releases; history only revokes.**

Four facts make that rational for this vertical, and the spec leans on all
of them:

1. **The loss is bounded.** A false positive costs at most the ~6 hours of
   the validation schedule, and D8 below takes the service back.
2. **The identity is known.** The "fraudster" is the ISP's own subscriber —
   with a name, an address, and a debt that survives. This is not anonymous
   e-commerce.
3. **The per-transaction layers already carry the weight**: the reader's
   gate, the minute-two cross-reading, the ISP's own reconnection
   threshold, and Banxico — slow, but it answers.
4. **Abuse self-limits.** Every burned ride revokes the fast lane (D5), so
   the gaming loop dies in one round per quarter.

## Decisions

### D1 — Release fires on the first evidence, never on the upload

An upload releases nothing. The release happens the moment one of three
kinds of evidence exists, and the kind decides the minute:

| case | evidence | released at |
|---|---|---|
| verdict `pending` (any attempt) | the provider says the transfer **exists** in process | minute 0 |
| receipt door, `not_found` | the cross-reading agreed (`readingCheck = agreed`) | minute ~2–3 |
| manual door, `not_found` | the human typed their own data — they *are* the reader | attempt 1 |
| `disputed`, then corrected | the human's correction is human evidence | on confirm |
| `blind` | none automatic; when the escalation form is confirmed, that is human evidence | on confirm |

A payment is released at most once. `valid` needs no release (it confirms),
and `contradicted` never releases — a real DEVUELTO is not bridged by
optimism.

A misread never punishes the payer: it delays the release by the minutes
the correction takes, and a `superseded` row leaves no mark (D5). The
payer pays for our reading errors with minutes, never with the service.

### D2 — Eligibility, and the two faces of the same protection

The release evaluates only when: the ISP's toggle is on, the payment is
`validating`, the claimed amount satisfies the **same**
`reconnectionThresholdPercent` and `reconnectionFloorCents` the ISP already
configured (one reconnection policy, provisional or confirmed), and the
payer is not revoked (D5).

What the release *does* depends on the customer's state, and both faces are
the same primitive:

- **Suspended** → the service is provisionally reactivated.
- **Active with the due date racing the validation** → the service is
  protected from the automatic cut. Without this, the customer who pays at
  11 pm on cut-off day is suspended at midnight *with their payment already
  sent* — exactly the experience this feature exists to prevent.

For an active customer with no cut in sight, the release is a no-op and the
page simply tells the truth (D9).

### D3 — The mechanism is gated on a spike, and money truth is untouched

Today there is no way to give the service without registering money:
`attemptReconnection` registers the payment on the WispHub invoice and the
service revives through `auto_activar_servicio`. Registering a payment with
unconfirmed money would mark an invoice "Pagada" on faith — never.

Two candidate mechanisms, **gated on a spike against the WispHub demo/CHR
lab** (the apicep lesson: the verified contract wins):

- **Plan A — WispHub's native payment promise ("Promesa de pago")**, if the
  API exposes it: it reactivates the service until a date, *WispHub itself
  re-suspends* when the date passes unpaid, and it natively covers the
  protected-from-cut face for active customers. The promise date is the
  schedule's end plus a margin.
- **Plan B — direct service-state PATCH** plus Devolada's own re-suspension
  sweep. More surface, and it hands Devolada the most delicate action there
  is (cutting someone's internet), so it is the fallback, not the choice.

The spike must measure: promise creation via API, its auto-re-suspension,
and its behavior on an active customer. Whichever plan wins, **no `charge`
row, no ledger movement and no WispHub payment exist until `confirmed`** —
the confirmed flow then runs exactly as today (and finds the service
already up).

### D4 — The refs travel always; the release never depends on them

Every validation call to Consta carries `customerRef` — an HMAC of the
WispHub `usuario` with a Devolada-held secret (the id is recognisable, so
it never travels naked) — and `paymentRef`, the `direct_payments` id
(trust-layer D1). They travel **from day one, toggle off included**:
history only accumulates forward, and the month it is not collected is
evidence lost. The v1 release rule reads none of it (D5 reads local rows);
the block is the instrument for tightening later, if D10's measurements
demand it.

### D5 — Revocation: only what burned a ride or proved bad faith

Computed from Devolada's own rows — an expired payment is client state
Consta can only infer, and the edge rejections of D6 never even reach it.

| signal | meaning | weight |
|---|---|---|
| a provisional release that ended `expired` **and was never resolved** | the ride was taken and never proven | revokes 90 days |
| a reused clave owned by **another** customer's payment | the shape of double-spending | revokes 12 months |
| DEVUELTO / CANCELADA | a real transfer, returned — serious, though the money came back | revokes 12 months |
| a gate-refused image | clumsiness; it cost nothing and released nothing | never |
| an expiry **without** release | includes the honest late-CEP payer whose money the ISP registered by hand; no ride was taken | never |
| a reused clave owned by the **same** customer | confusion, seen live; the D8 index knows the owner | never |
| a `superseded` row | the reading error was ours | never |

"Never resolved" is what the manual retry (D7) decides: a chain that later
confirms lifts the revocation retroactively — the vote of confidence was
vindicated, the history stays clean. The 90-day penalty is reserved for the
ride that was never proven, and even then it costs the fast lane, never the
normal flow.

### D6 — The edge rejection gets a memory

A reused clave dies today at the unique index
(`direct_payments_isp_tracking_idx`) with a 409 — instantly, free, before
any Consta call — **and leaves no row anywhere**. A revocation signal needs
memory, so the rejected attempt is persisted minimally: which payment link
tried, which payment owned the clave, when. That record is also what makes
the own-vs-other distinction of D5 a query instead of a guess. (Consta's
`alreadyValidated` flag covers the complementary slice — claves consumed
outside Devolada's universe — and already lands on the payment row as
`TRANSFER_ALREADY_USED`.)

### D7 — The manual retry after expiry: the claim itself is information

The expired page gains one manual retry, for **every** expired payment,
released or not. It is a self-selection mechanism:

- The payer who really paid claims it — their money is at stake, and six
  more hours have passed, so the late CEP has almost certainly published by
  now. The retry validates, the payment confirms through the normal flow,
  the reconnection runs, and the revocation never sticks (D5).
- The fabricator has no reason to claim a transfer that does not exist —
  and if they do, Banxico says no again, with more time behind the answer,
  not less.

One retry per payment; it reuses the existing correction door (same data →
revalidate; edited data → supersede); **it never re-releases the service**
— the revocation is already standing, so the button buys the fraudster
nothing but one bounded call. After a failed retry, the copy goes back to
"contacta a tu proveedor con tu comprobante" — the ISP checking their own
bank app and registering by hand stays the final fallback.

### D8 — Expiry after release: re-check, then take the service back

When a released payment expires, Devolada re-checks the debt in WispHub
before acting — the `unapplied` lesson: never punish on stale state.

- The invoice is still pending → the service is re-suspended (natively
  under plan A; by Devolada's sweep under plan B) and the payer sees the
  honest copy (D9).
- The debt was settled elsewhere meanwhile → nothing is touched.

Each expiry-after-release also sends **one email to the ISP** (the Resend
pipe of `email/sender.ts`, one new template): it is the rare exception the
ISP signed up to know about, and their bank app is the last arbiter.

### D9 — The copy never speaks in conditionals

The page knows the customer's state and whether the release happened, so
every state gets exactly one message that states facts. The evidence
sentence and its consequence are one sentence, never two stacked alerts:

| state | copy (es-MX) |
|---|---|
| verifying, first seconds | "Verificando tu pago…" (unchanged) |
| `pending` + released | "Tu transferencia está en camino y tu internet ya volvió. Solo esperamos la confirmación de Banxico — no necesitas hacer nada." |
| `agreed` + released | "Revisamos tu comprobante dos veces y los datos coinciden. Tu internet ya volvió mientras esperamos la respuesta de Banxico — no necesitas hacer nada." |
| corrected + released | "Gracias por confirmar tus datos. Tu internet ya volvió mientras Banxico responde." |
| current customer, protected | "Tu pago se está verificando. Tu servicio sigue activo — no necesitas hacer nada." |
| not released (revoked / toggle off) | today's copy, untouched — no promise that was not kept |
| `confirmed` | today's green check |
| expired after release | "Banxico no publicó tu transferencia y tu servicio volvió a pausa. Si ya pagaste, reintenta ahora — o contacta a tu proveedor con tu comprobante." |
| expired, retry spent | "…contacta a tu proveedor con tu comprobante — puede registrar tu pago a mano." (diagnosed copy, unchanged) |

### D10 — One toggle, and outcomes measured instead of simulated

Settings gains one switch next to the reconnection threshold and floor —
**"Proteger el servicio mientras Banxico confirma"** — covering both faces
of D2 without lying. No profiles, no dials: the ISP who cannot be asked to
reason about sample sizes gets a rule Devolada reasoned for them.

There is no shadow rule to simulate, because v1 starts open: the
measurement is the **real outcomes** — every release ends `confirmed` or
`expired`, which is one SQL over `provisionalReleaseAt` and `status`. If
the expiry-after-release rate turns out bad, the tightening rule is built
from the trust block (US-V15), with the measured rate written into it. The
profile selector considered during design lives behind that measurement:
it is built when the data justifies it, or never.

### D11 — Data

`direct_payments` gains `provisionalReleaseAt` (timestamp, null) and
`releaseEvidence` (`pending` | `agreed` | `human`, null) — which evidence
bought the release, recorded at the moment it happened because it is
point-in-time. The rejected-attempt record of D6 is a new small table. The
feed is untouched: the `charge` arrives at `confirmed`, as always.

## Scenarios

1. **The suspended regular** — receipt at minute 0, `not_found`, cross
   agrees at minute 2 → released (`agreed`), internet back; `valid` at
   minute 8 → confirmed, charge, feed; the reconnection flow finds the
   service already up and verifies.
2. **The cut-off race** — current customer pays at 11 pm on due date →
   protected from the midnight cut; confirms in minutes; never notices the
   danger.
3. **The fabricated receipt** — plausible image, both machines read it the
   same → released; 6 h, no CEP → expired → debt re-checked, service
   re-suspended, ISP emailed, revoked 90 days; no retry claimed → the
   revocation stands; next month their real payment rides the normal flow.
4. **The late CEP** — released, expired, re-suspended; the payer hits
   "reintenta ahora" next morning → `valid` → confirmed, reconnected,
   revocation lifted, history clean.
5. **The misread** — `disputed` at minute 2, the payer corrects at minute
   3 → released on human evidence. Our error cost them minutes.
6. **The blind image** — no cross evidence; the escalation form confirms
   the data at minute ~45 → released on human evidence.
7. **The double-spender** — a clave owned by another customer's payment →
   409 at the edge, attempt recorded (D6), revoked 12 months, Consta never
   called.
8. **Toggle off** — everything behaves exactly as today; the refs still
   travel (D4).
9. **The revoked payer** — pays again within the window: normal flow, no
   release, service returns at `confirmed`. The fast lane is closed, the
   road is not.
10. **Settled elsewhere** — released payment expires but the debt re-check
    finds nothing pending → nothing is touched, no email panic.

## Definition of Done

- [ ] Spike recorded in `docs/integrations/wisphub.md`: payment-promise API
      (create, auto-re-suspend, active-customer behavior) → plan A or B
      chosen, this spec amended with the verified contract.
- [ ] Migration: `provisionalReleaseAt`, `releaseEvidence`, and the
      rejected-attempt table (D6).
- [ ] Release evaluation wired into the validation flow (D1/D2), once per
      payment, with the revocation query of D5.
- [ ] `customerRef` (HMAC) and `paymentRef` sent to Consta on every
      validation, toggle state irrespective (D4).
- [ ] Expiry-after-release path: debt re-check, take-back, payer copy, one
      ISP email (D8).
- [ ] Manual retry on the expired page, one per payment, never re-releasing
      (D7).
- [ ] Settings toggle in admin next to threshold/floor (D10).
- [ ] The copy table of D9 in the payment page, one message per state,
      no conditionals.
- [ ] Tests cite US-D15: the ten scenarios and the revocation taxonomy.

## Open items

- **Tightening with evidence** — if D10's measured expiry-after-release
  rate is bad, the harder rule is built from the US-V15 trust block, and
  the profile selector question reopens with real rates in the copy.
- **Admin visibility of in-flight releases** — parked for the future
  direct-payments admin view; v1's email covers the only case that needs
  the ISP's eyes.
- **Promise-date margin** — plan A needs a concrete promise expiry
  (schedule end + margin); decided at the spike with the API's granularity
  in front.
