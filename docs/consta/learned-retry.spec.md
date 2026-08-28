---
status: proposed
stories: [US-V16]
domain: consta
updated: 2026-08-27
debt: []
---

# Spec: Learned retry — the log already knows when asking Banxico is waste

The revalidation schedule Consta's callers run today is a constant — +2,
+8, +20, +45 min, +2 h, +6 h (+12 h for `not_found`) in Devolada's case —
the same for every bank, derived from published evidence, not from
measured traffic (Devolada's TD-013). That rigidity charges twice:

1. **Wait we induce.** If a bank's CEPs appear at ~25 min, the +20 slot
   arrives early (fails, spends a credit) and the customer confirms at
   +45 — twenty minutes that are not Banxico's, they are the gap between
   the caller's own slots.
2. **Credits burned in vain.** Every attempt before the CEP can exist is
   $0.25 thrown away. Against a slow bank, +2 and +8 are near-guaranteed
   losses.

The insight that makes this cheap: **the calls integrators already make
are the measurement.** Every attempt lands in `validations` with a
verdict and a timestamp, and retries of one transfer link by tracking
key — so `first valid − last not_found` brackets the publication moment,
per transfer, with zero new instrumentation. Nobody has to measure
anything; someone has to read what is already written.

Consta is the only party that can read it across integrators, which is
why this feature lives here and not in any caller (the retirement note of
US-V12–V14 already named this system as the successor that pays TD-013).
This spec graduates the "learned `retryAfter`" open item of
[validation.spec.md](validation.spec.md) — discussed 2026-08-25, committed
2026-08-27 — and inherits its three gates unchanged (D7).

## Decisions

### D1 — Consta suggests, never schedules

D9's existing `retryAfter` field extends to `not_found` and `pending`
responses: **a single ISO timestamp** meaning "asking again before this is
spending in vain". It is omitted whenever the ladder (D2) has no cell with
enough samples — silence, never a guess. The caller's own static schedule
remains the floor; Consta holds no state about anyone's retries and makes
no promises.

**Rejected**: Consta scheduling retries itself with webhooks — already
rejected in validation.spec.md (a stateful scheduler is another product's
worth of complexity while integrators own a cron). **Deferred**: a
`/stats` endpoint exposing raw percentiles per cell — useful for
expectation copy (US-D12) and integrators building their own schedules,
but public surface is contract, and nobody has asked yet (open item).

### D2 — The ladder: pair → receiver → sender → global

Latency is aggregated in four cells at once, most specific first:

1. bank pair (sender → receiver)
2. receiver bank
3. sender bank
4. global

A suggestion uses the **first cell whose sample count reaches the
minimum**; if none does, the field is omitted. The traffic volume decides
which level operates — never a config, never a person. Today only the
global cell would fill; specific cells open themselves as volume grows.

Measured 2026-08-27: the validate request carries `beneficiary.bank`, but
the `validations` insert drops it — the receiver-side cells need a new
`beneficiary_bank` column, logged from phase 1 on. History written before
that column can only fill the sender and global cells, and the phase-0
report says so instead of pretending otherwise.

### D3 — Stateless stepping: two moments from one field

Consta knows how long a transfer has been waiting from its own log:
`elapsed = now − first attempt seen for this tracking key` (the caller's
inline attempt at submission makes first-seen ≈ payment birth). Each
response computes its suggestion from elapsed alone — no state, only
arithmetic over the cell:

| elapsed          | `retryAfter`        |
|------------------|---------------------|
| < p50            | first seen + p50    |
| ≥ p50 and < p90  | first seen + p90    |
| ≥ p90            | field omitted — past the learned range, the caller's tail owns it |

One stateless field hands the caller both moments hugging the
distribution. Worked example, bank publishing at ~25 min (p50 ≈ 26,
p90 ≈ 35): attempts at 0 and +2 answer `retryAfter = +26`; a failure at
+26 answers `+35`; a failure at +35 answers nothing and the caller's
static tail takes over.

### D4 — Interval-censored measurement, upper bound rules

The schedule quantizes its own measurement: a transfer only shows that
its CEP appeared **between two attempts** — with slots at 20 and 45,
"confirmed at 45" may mean 21 or 44. This spec admits the blur instead of
hiding it:

- Each transfer contributes the interval `(last not_found, first valid]`,
  linked by tracking key. A transfer valid on its **first** attempt
  contributes "≤ its elapsed at that attempt" — the fast majority counts,
  or the distribution loses its whole left mass.
- Percentiles are computed on the **upper bound**: a suggestion is never
  earlier than observed evidence. Conservative by construction.
- The feedback loop is named: moving suggestions moves the future grid
  (new data comes censored at the new moments). The damper is
  **hysteresis** — the aggregate recomputes periodically, but a new table
  applies only when it moves a cell's suggestion by more than a
  threshold, over a long rolling window.

The numeric parameters — minimum n per cell, window length, hysteresis
threshold, the exact percentile pair — are **proposed by the phase-0
report from stored data**, not invented here. Written hypothesis, to be
confirmed or corrected: n ≥ 30, 28-day window, 5-minute threshold,
p50/p90.

**Measured 2026-08-27 (phase-0 run on dev, 27 confirmed transfers): the
distribution is bimodal, and that changes what the stepping does.**
24 of 27 confirmed on the first attempt (p50 = 0); **zero** confirmed
between minute 1 and minute 46; the remaining 3 landed in (46, 121],
(120, 363] and (361, 1592] minutes. Two consequences:

- With p50 = 0, D3's stepping degenerates gracefully: elapsed is always
  past p50, so every suggestion is "p90" — one jump, which is exactly
  right for a bimodal shape. The two-step ladder stays for the day a
  bank with a genuine middle hump shows up.
- Tail censoring is enormous — (361, 1592] is a fact, not a typo: a
  resubmission re-attempted a key after the schedule was exhausted, and
  the join by tracking key correctly kept first-seen as the origin. With
  n = 3 in the tail, the p90 estimate (121 min) is a sketch, not a
  number to obey yet.

### D5 — Guards that do not move

1. **No upper bound is ever assumed.** Measured 2026-08-19: two real CEPs
   unpublished at T+62 and T+49 min. Past p90 the field is omitted and
   the caller's tail (+45/+2 h/+6 h/+12 h in Devolada's case) exists for
   exactly that transfer.
2. **Cold start is silence.** A cell below minimum n suggests nothing;
   the caller's constant schedule is what runs. No interpolation, no
   borrowed priors.
3. **Distribution, not average.** The fast mass is served by the caller's
   early attempts, which this feature never touches (D6) — a slow bank
   cannot erase them. And copy discipline (gate 3): a suggestion must
   never render as a promised confirmation time; no upper bound on
   publication has ever been measured.

### D6 — The consumer contract (hand-off, not silently adopted)

How Devolada's sweep pays TD-013, in its own PR, on
`direct-payment.spec.md` D7's turf:

- The early skeleton is fixed: the inline attempt at T+0 and the +2 slot
  always run — they serve the majority that confirms in seconds, and the
  suggestion rides their responses for free (the credit was being spent
  anyway).
- When a response carries `retryAfter`, the next attempt is scheduled
  **exactly there** — before or after the next static slot. Earlier is
  the whole latency win; later is the whole credit win.
- If the suggested attempt fails, the static ladder resumes where it was.
  The tail is never shortened by a suggestion.

Worked example: today 0, 2, 8, 20, 45 (5 credits, confirmed at 45 min)
becomes 0, 2, 26 (3 credits, confirmed at 26) — same Banxico, less waste
on top. A bad suggestion costs at most one attempt that the static table
would have spent anyway.

### D7 — Phase 0 is the gate, not a formality

The three gates inherited from the validation.spec.md open item, now this
spec's build order:

1. **Per-cell signal on real volume.** The offline report
   (`scripts/cep-latency-report.mjs`): read-only queries against both
   D1s (`wrangler d1 execute … --remote`, reading is not deploying),
   joined by tracking key, printing intervals, cell counts and candidate
   percentiles. Its verdict may be "not enough volume yet" — that is a
   result, and this spec waits as `proposed` instead of inventing data.
2. **Do `pending` re-checks bill?** One real unsettled transfer,
   re-checks watching `quota_remaining` before and after. The answer
   changes what precision is worth: free re-checks make probes between
   slots free, and the measurement densifies itself (open item). The
   report also mines **passive evidence**: consecutive log rows of one
   transfer already carry `quota_remaining` deltas — suggestive, not
   conclusive, since other traffic shares the quota.
3. **Copy discipline** — D5.3, enforced at every consumer.

Phase 1 (the `beneficiary_bank` migration, the periodic aggregation —
Consta has no cron trigger today, one is added — and `retryAfter` on
`not_found`/`pending`) builds only after the report's verdict on gates
1–2.

**The gates, answered 2026-08-27 (first run against dev):**

1. **Gate 1 — close, and the shape is the real finding.** The global
   cell holds 27 (hypothesis asks 30). One receiver in the whole
   dataset (KLAR — the pilot ISP's bank), so the receiver cells are the
   global cell wearing a name; senders split NUBANK (23) / BBVA (3),
   both instant-dominated. The signal is not "bank X publishes at ~25
   min" — no such bank appears. The signal is the **dead middle**: the
   +8, +20 and +45 slots caught *nothing* in this data (everything
   confirms instantly or takes hours), so each slow transfer burns 3
   credits there for free. The learned suggestion's value on this
   distribution is credit-shaped, not latency-shaped. Caveat, stated
   not hidden: dev traffic includes lab rehearsals; the verdict firms
   up as pilot volume replaces it.
2. **Gate 2 — pending re-checks bill.** Passive evidence, 30
   consecutive re-check pairs, `quota_remaining` delta never 0, delta
   exactly 1 on 2–6 min gaps where no other traffic fits. Recorded in
   `docs/integrations/apicep.md`'s open items. Probes between slots are
   therefore **not free** — that branch closes (see Open items).
3. **Gate 3** — unchanged; enforced at every consumer.

## Build

- [x] Phase 0 — report: run `scripts/cep-latency-report.mjs` against dev;
      record the verdict and the proposed parameters in D4 *(run
      2026-08-27: bimodal shape, dead middle slots, tail p90 a sketch at
      n = 3 — findings in D4 and D7; global cell at 27 of the 30 the
      hypothesis asks, so phase 1 waits for the last few confirmations
      of pilot volume, not for a redesign)*
- [x] Phase 0 — gate 2: the `quota_remaining` experiment; record the
      answer in `docs/integrations/apicep.md`'s gap list *(answered
      2026-08-27 by passive evidence — re-checks bill; the isolated live
      re-check remains optional belt-and-braces)*
- [ ] Phase 1 (gated on phase 0): migration for `beneficiary_bank` +
      logged at both insert sites; rolling aggregation behind a cron
      trigger; `retryAfter` on `not_found`/`pending` per D3; scenario
      tests citing US-V16
- [ ] Phase 2 (own PR, `apps/api`): the sweep consumes `retryAfter` per
      D6; TD-013 closed; `direct-payment.spec.md` D7 updated as consumer

## Open items

- **`/stats` per cell** (percentiles, sample sizes): deferred until
  US-D12's expectation copy or an integrator asks. The aggregate table
  phase 1 builds is the same data; only the public surface is deferred.
- ~~**Probes between slots**: only if gate 2 answers that `pending`
  re-checks are free.~~ **Closed 2026-08-27**: gate 2 answered — re-checks
  bill (D7). Densifying the measurement costs real credits, so the
  interval censoring of D4 is permanent and the upper-bound rule is not
  a stopgap, it is the design.
