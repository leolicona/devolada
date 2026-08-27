---
status: proposed
stories: [US-V15]
domain: consta
updated: 2026-08-27
debt: []
---

# Spec: The trust layer — Consta measures the past, the client decides

A `pending` or `not_found` verdict leaves the integrator with one question
Consta has never helped with: *do I make my customer wait, or do I give the
service now and let Banxico confirm behind me?* Today the integrator decides
that blind. This spec gives the decision its missing input: **the measured
history of this payer's past validations, reported next to the verdict —
never instead of it** (a doctrine first written for the email provisional
match — that feature was discarded in PR #101, and the doctrine outlived it).

**Amended 2026-08-27 (owner critique, while designing the first consumer):**
the original prize paragraph here described Devolada gating early release on
this history — and the arithmetic killed it: a monthly payer needs ~5
payments to reach a useful sample, and a brand-new ISP starts every customer
at zero, for a feature whose reason to exist is the experience *now*.
Devolada's real design (US-D15) releases on per-transaction evidence from
day one — a vote of confidence — and uses history only to **revoke** it,
from its own rows (an expired payment is client state this layer can only
infer as `abandoned`). The trust block is not in that v1 rule, and this spec
did not change one line because of it: the measurement layer has no opinion
about thresholds, which is the point.

What Devolada takes from this layer on day one is the cheap half — the refs
and the collection, because history only accumulates forward. The computed
block serves the consumers whose loss function does demand history: the
tightening rule Devolada builds *if* measured release outcomes turn out bad,
and the tenant that ships goods (irrecoverable loss) and needs the whitelist
reading an ISP never did.

## The one law of this layer

**Consta measures and reports. It never recommends, never scores, never
decides.** There is no `recommended: true`, no 0–100 number, no threshold
inside Consta. The reason is not taste but arithmetic: the sample size that
justifies early release depends on the client's loss function — an ISP risks
a few days of service on a debt that survives (recoverable, small), a shop
shipping goods risks the full merchandise (irrecoverable). The right
threshold is economic, the economics are the client's, so the threshold
cannot live here. Consta hands over the naked sample with its size visible;
the integration guide hands over the honesty table (D9) so each client sets
its own bar with open eyes.

## Decisions

### D1 — Identity is an opaque reference the client chooses

The client names the payer with an optional `customerRef` (string, ≤128
chars) on any validation request. Consta treats it as an opaque key: never
interpreted, never joined against anything but itself. Sending it is the
opt-in — no `customerRef`, no history collected, no trust block, nothing
else changes.

An optional `paymentRef` (string, ≤128 chars) rides along to say "these
validations are attempts of one payment". Without it, Consta falls back to
grouping by tracking key — imperfect on misread claves (one payment splits
into two chains, one abandoned and one valid), which is exactly why
`paymentRef` exists.

The integration guide tells clients to send an identifier that means nothing
outside their own database — an internal numeric id as-is, or an HMAC with a
client-held secret when the natural id is recognisable (an email, a phone).
Consta never stores names, accounts or images against a ref; the identity
behind it is the client's data under the client's retention policy, the same
line D8 of proof-extraction drew for receipts.

### D2 — History is strictly per tenant

All aggregation happens inside (`apiKeyId`, `customerRef`). Nothing crosses
tenants, and because each ref is opaque per client, nothing *can* cross.

**Out of scope, deliberately and permanently in this form** — cross-tenant
reputation keyed by a real-world identifier (a phone number was considered):

1. Hashing a low-entropy identifier is not anonymisation. A Mexican mobile
   number is ~10^10 candidates; whoever holds the hash table or the HMAC key
   can enumerate them all. It is a reversible pseudonym, still personal data
   under the LFPDPPP.
2. Cross-tenant matchability and "we hold no data" contradict each other by
   construction: matching requires a deterministic shared mapping, and that
   mapping is what makes the data re-linkable.
3. The only honest future door is **payer-consented reputation
   portability** — the payer opts in to carrying their history. That is a
   different product with a legal gate that must be resolved first: whether
   it falls under the Ley para Regular las Sociedades de Información
   Crediticia. Counsel before code on that branch; no counsel needed for
   this per-tenant layer, which processes the tenant's own operational data
   as its processor.

### D3 — A payment is a chain, and a chain has four states

Validations sharing (`apiKeyId`, `customerRef`, `paymentRef`) — or the
tracking-key fallback — form a **chain**. A chain is:

- **resolved_valid** — some validation in it reached `valid`;
- **contradicted** — a validation returned `invalid`/`contradicted`
  (a DEVUELTO or CANCELADA is a real answer about a real transfer);
- **open** — no valid yet, last validation less than 24 h ago;
- **abandoned** — no valid, and 24 h of silence. Consta never learns that a
  client gave up (expiry is client state), so it infers: the longest known
  schedule (Devolada's) dies at 6 h, so 24 h cuts nobody. A chain that
  revives after that simply reopens.

Open chains are excluded from every rate. **The chain currently being
validated is excluded from its own evidence** — a payment must not vouch for
itself.

### D4 — Evidence decays by recency, and says so

Every closed chain carries a weight of `0.5^(ageDays / 90)` — half-life 90
days, fixed in v1 and reported inside the block, matched to a monthly ISP
cycle (the last ~3 receipts dominate without erasing the year). What is
reported:

- `eventualValidRate` — weighted share of closed chains that resolved valid;
- `sample.effectiveN` — the sum of weights (the n the rate really rests on)
  next to `sample.chains`, the raw lifetime count;
- `raw` — undecayed lifetime counts per outcome, plus `alreadyUsedAttempts`
  (validations that came back `alreadyValidated` — an attempt-level event,
  not a chain outcome, and the strongest fraud signal this data holds);
- `lastIncidentAt` — the most recent contradicted chain or already-used
  attempt, or null;
- `medianMinutesToValid` — plain median, first attempt to valid, over
  resolved_valid chains.

Nothing is suppressed and nothing forgives: an incident stays visible
forever in `raw` and decays only in the rate, so the client can be harsher
than the decay if it wants. Explainable in one sentence: *recent chains
weigh more; the n you see already discounts for age.*

### D5 — The block travels on `pending` and `not_found`, from n = 0

The `trust` block is attached to the verdict exactly when the client is
deciding whether to wait: verdicts `pending` and `invalid`/`not_found`, and
only when the request carried a `customerRef`. Never on `valid` (redundant)
and never on `contradicted` (a real DEVUELTO is not bridged by history —
the "never instead of the verdict" rule applies with no exception).

There is no emission floor. A payer with one closed chain shows n = 1; a
payer with none shows zeros — and still gets a useful answer, because the
baseline (D6) always travels. Suppressing small samples would be Consta
deciding what sample is "enough", which is the exact judgment D-zero
renounces. The client that thresholds at 5 simply ignores smaller numbers.

### D6 — The tenant baseline travels with it, always

`tenantBaseline` carries the same aggregates (`eventualValidRate`, `chains`,
`effectiveN`, same decay) computed over **all** of this tenant's groupable
chains. It is the same SQL with one `WHERE` less, and it is half the signal:
a payer's 100% means one thing against a 92% baseline and nothing against a
99% one. Without it, integrators read individual rates as absolute safety —
the base-rate fallacy — when the absolute risk is mostly set by the system
(Banxico latency, bank mix), not the individual.

Two consequences worth naming. For a healthy tenant the baseline will be
high, so good history adds little and **incidents are the information** —
in practice the layer works less as a whitelist and more as a blacklist with
evidence. And a brand-new payer gets day-one value: *about you I know
nothing; your peers resolve at 96%.*

Consta reports both numbers raw and never combines them. The empirical-Bayes
shrinkage formula (pulling a small-n rate toward the baseline) goes in the
integration guide for clients who want it; a combined number from Consta
would be a black box, and the doctrine is legible evidence.

### D7 — History is derived, never stored

No aggregate tables, no counters, no materialised scores. Two nullable
columns land on `validations` — `customer_ref`, `payment_ref` — plus an
index on (`api_key_id`, `customer_ref`), and every number in the block is a
SUM over the append-only log at request time, the same law that derives a
store's balance from `ledger_entries`. A bug in the aggregation is fixed by
fixing a query, not by migrating corrupted counters.

**Implementation splits on purpose (amended 2026-08-27):** the columns and
the collection ship first — history only accumulates forward, and every
month without the refs is a month of evidence lost. The computed block
ships when its first consumer calls for it; nothing downstream waits on it.

### D8 — The wire contract

Request (both doors, all optional):

```jsonc
{
  "customerRef": "a41f…",   // opaque, ≤128 chars; sending it is the opt-in
  "paymentRef": "pay_812…"  // opaque, ≤128 chars; chains attempts of one payment
}
```

Response, on `pending` / `not_found` verdicts when `customerRef` traveled:

```jsonc
"trust": {
  "customerRef": "a41f…",
  "sample": { "chains": 14, "effectiveN": 11.2, "halfLifeDays": 90 },
  "eventualValidRate": 1.0,
  "raw": {
    "resolvedValid": 14,
    "abandoned": 0,
    "contradicted": 0,
    "alreadyUsedAttempts": 0
  },
  "lastIncidentAt": null,
  "medianMinutesToValid": 4,
  "tenantBaseline": { "eventualValidRate": 0.96, "chains": 410, "effectiveN": 236.5 }
}
```

### D9 — The honesty table is part of the product

The integration guide carries the rule of three: with zero failures in n
chains, the true failure rate can still be up to ~3/n at 95% confidence —
n = 5 → 60%, n = 10 → 30%, n = 30 → 10%, n = 60 → 5%. "Five payments, five
good" proves much less than it feels like. The guide pairs the table with
the loss-function framing (bounded recoverable loss → low n is rational;
irrecoverable loss → wait for 30–60) so every client sets its threshold
knowing what the sample does and does not prove.

## Scenarios

1. **The regular** — 14 chains, all resolved valid, receipt uploaded, CEP
   not published yet. Verdict `pending` arrives with the block above. The
   client's own rule (Devolada future: toggle on + threshold met +
   `readingCheck` agreed) releases the service in minute two.
2. **The stranger** — first payment ever, `customerRef` sent. Block travels
   with zeros and the baseline. The client learns the system resolves 96% —
   its rule decides, day one.
3. **The incident** — one chain last month ended DEVUELTO. `raw.contradicted
   = 1`, `lastIncidentAt` set, rate dented by decay. Nothing is suppressed;
   the client that treats any incident as disqualifying reads it right there.
4. **The reused proof** — a validation comes back `alreadyValidated`.
   `raw.alreadyUsedAttempts` increments and sets `lastIncidentAt`, even
   though no chain outcome changed.
5. **The misread clave, no paymentRef** — attempts split into two chains by
   tracking key; one abandons, one resolves valid. The rate takes an unfair
   dent. Documented, accepted, and the reason `paymentRef` is in the
   contract.
6. **The real DEVUELTO in flight** — verdict `contradicted`. No trust block.
   History does not argue with Banxico.
7. **No ref** — request without `customerRef`. Nothing is collected, nothing
   is attached, behavior is byte-identical to today.

## Definition of Done

- [x] Migration: `customer_ref`, `payment_ref` on `validations` + index on
      (`api_key_id`, `customer_ref`); the log stays append-only.
      *(2026-08-27, migration 0005)*
- [x] Both doors accept and store the two refs; Zod caps at 128 opaque
      chars. *(2026-08-27, tested under US-V15 — failed rows keep their
      refs too)*
- [ ] Chain derivation (paymentRef, tracking-key fallback, four states, 24 h
      abandonment, self-exclusion) implemented as queries, no state tables.
- [ ] `trust` block on `pending`/`not_found` with decay, raw counts,
      incidents, median and `tenantBaseline`; absent everywhere else.
- [ ] Tests cite US-V15: the seven scenarios, decay arithmetic, and the
      self-exclusion of the in-flight chain.
- [ ] Integration guide page: what Consta stores and does not, the HMAC
      guidance, the rule-of-three table, the shrinkage formula.

## Open items

- **Devolada as first consumer** — its own spec (US-D15, designed
  2026-08-27): a settings toggle ("Reconectar provisionalmente mientras
  Banxico confirma") that releases on per-transaction evidence (`pending`,
  or `not_found` with an agreed cross-reading / human-typed data), and
  revokes from Devolada's **own** payment rows — an expired payment is
  client state this layer can only infer as `abandoned`, so the client's
  local truth wins for revocation. The trust block enters that story only
  as the instrument for tightening with evidence, if measured release
  outcomes demand it. The hard branch (a provisionally reconnected service
  whose payment later expires) is decided there, not here.
- **Configurable half-life** per API key (v2, if a real tenant's cycle
  demands it; the block already reports the value so the contract is ready).
- **Payer-consented portability** — parked behind the legal gate named in
  D2; revisit only as a business decision, with counsel first.
