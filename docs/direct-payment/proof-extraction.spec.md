---
status: proposed
stories: [US-D09, US-D10]
domain: direct-payment
updated: 2026-08-19
debt: []
---

# Spec: Reading the proof before we pay to have it read

A reading layer at our own edge, between the customer's screenshot and
apiCEP. It answers three questions the provider cannot answer for us —
*is this a receipt at all?*, *does it carry a clave de rastreo yet?*,
*what is that clave?* — and only then spends a paid validation, through
the transfer door, which has never failed on a correct key.

Scoping from the live investigation of 2026-08-18/19 (`docs/BUGS.md`
BUG-003, BUG-006) and the model benchmark of 2026-08-19. Nothing here is
built; this is the proposal and its evidence.

## Why: what the investigation actually found

Six live submissions on dev, three distinct real Nubank receipts, two
customers. The finding that reframes the feature: **`invalid` with no
`cepDetails` has two distinct causes and they are indistinguishable on
the wire** — no tracking key, no amount, no `cepStatus`, and today both
are terminal (BUG-003).

- **(a) The receipt has no clave to read.** Nu does not print the clave
  de rastreo while the transfer is *"En proceso"*. The capture a customer
  takes right after paying — the natural thing to do — physically lacks
  the field the whole validation depends on. **Proven**: transfer folio
  `QUTHH45WF` returned `invalid` from an *"En proceso"* capture (two
  attempts, 22:25 and 22:28) and **confirmed** at 22:28:44 from a
  re-capture of the *same transfer* showing *"Aceptada"* and its clave.
- **(b) apiCEP's OCR misreads a readable receipt.** **Proven**: receipt
  `IMG_4931` (folio `QUTHR5TKX`) returned `invalid` through the receipt
  door at 19 and at 30 minutes of transfer age; the clave printed on that
  same image, read by eye, **confirmed through the transfer door in
  11.1 s**.

**CEP age is not the variable.** A 16-minute-old receipt confirmed while
that 30-minute-old one failed. The earlier suspicion that Banxico
publication timing explained the failures does not survive.

Scoreboard for the receipt door on receipts that do carry the clave:
**2 of 3 distinct receipts read**. That matches what `direct-payment.spec.md`
D2 measured independently and had already concluded.

A third failure mode is already documented in `docs/integrations/apicep.md`
and this layer also closes it: an image with no receipt in it is a
provider **error**, not a verdict, so it becomes `PROVIDER_ERROR` →
retryable → six hours of retries on a picture that can never be read.

## Evidence: the model benchmark (2026-08-19)

Harness: a throwaway Worker with an `ai` binding driven by `wrangler dev`
against real Workers AI. Four fixtures — a receipt known good, receipt
**B** (the one apiCEP failed twice), the *"En proceso"* capture with no
clave, and a non-receipt image. Every clave scored against **what Banxico
returned**, not against a human reading.

**`@cf/mistralai/mistral-small-3.1-24b-instruct`**

| fixture | hits | latency |
|---|---|---|
| valid receipt | **10/10** | 2.7 s |
| **receipt B** (apiCEP 0/2) | **10/10** | 2.9 s |
| no clave (*"En proceso"*) | **5/5** — `claveDeRastreo: null`, `estatus: "En proceso"` | 2.0 s |
| non-receipt image | **5/5** — `esComprobante: false` | 2.2 s |

**`@cf/meta/llama-3.2-11b-vision-instruct`**: valid 9/10 (7.8 s);
receipt B **0/10**.

`@cf/moondream/moondream3.1-9B-A2B` returns `{}` and is unusable.

**The most useful result is llama's failure.** It misreads B the same way
all ten times — deterministically, never randomly:

```
truth:  NU3AGKMP3ASP8QQQ4U8J8F0K1E4K   (28)
llama:  NU3AGKMP3ASP8QQ4U8J8F0K1E4K    (27)   ← one Q lost from QQQ
```

Two things follow. Retrying the same model on the same image is useless —
the error is a property of the pair, not a dice roll. And **a length check
catches it for free**, which is the whole asymmetry this feature is built
on: apiCEP's reading is a black box we cannot inspect, verify or second-
guess; ours is none of those things.

The tall aspect ratio (1125×4449) was expected to be a problem and
**measured not to be** — no cropping or tiling was needed.

## Decisions

- **D1 — The reader runs at our edge, before any paid call.** Extraction
  costs a Workers AI invocation and ~2.7 s; a provider validation costs
  ~$0.25 and 12–20 s, and today three of its four outcomes are failures
  we could have predicted from the image. **Rejected**: keeping apiCEP's
  OCR as the primary reader — measured 2 of 3, unverifiable, and its
  failures cost money before they inform us.
- **D2 — What the reader produces is a search key, never a verdict.** The
  extracted clave chooses *which Banxico record we look up*; it never
  decides *whether that record pays the debt*. The amount stays
  server-supplied and the truth stays `cepDetails`, compared by
  direct-payment D11. This is the same line `docs/integrations/apicep.md`
  draws around `extracted`: it is a reading of a picture the payer
  supplied, and it is attacker-controlled. Written as a decision because
  the temptation to "optimise" by trusting an extracted amount is exactly
  the `$1-receipt` hole D11 exists to close.
- **D3 — `mistral-small-3.1-24b-instruct` is the reader; llama is the
  second opinion.** 30/30 including the receipt that beat the provider,
  at 2.7 s. llama earns its place only as a disagreeing voice: when the
  two disagree, neither is trusted and the flow falls to D5's manual
  branch. **Rejected**: llama as primary (0/10 on B), moondream (unusable).
- **D4 — The 28-character format check is the gate, and it is not
  AI-specific.** A clave de rastreo is `^[A-Z0-9]{28}$`. Every candidate
  passes it — one a model produced, one a customer typed, one pasted from
  a phone's text recognition. It is free, it catches llama's 27-character
  misread, and it catches the space + Cyrillic `З` a human OCR tool
  produced during this very investigation. Landing it on the manual door
  is BUG-006 and is a **prerequisite**, not part of this feature.
- **D5 — Four branches, and three of them never touch the provider.**
  ```
  image → reader
    ├─ not a receipt          → reject now, 0 provider calls
    ├─ estatus "En proceso"   → "wait for your bank to accept it,
    │                            then capture the receipt again", 0 calls
    ├─ clave fails D4 / models disagree
    │                         → manual door, prefilled with the candidate, 0 calls
    └─ clave passes           → apiCEP transfer door
  ```
  **Rejected**: sending the image to apiCEP whenever we are unsure — that
  is today's behaviour and it is what spends money to learn nothing.
- **D6 — A customer is never asked to type 28 characters blind.** When
  the reader is not trusted, the manual door opens **prefilled** with what
  was read, for the customer to correct against their own screenshot.
  Confirming beats transcribing: during this investigation a 28-character
  clave transcribed by hand arrived carrying a space and a Cyrillic `З`
  (BUG-006). A customer on a phone will do no better.
- **D7 — apiCEP's OCR mode is retired once this ships.** With extraction
  at our edge every validation goes through the transfer door — the one
  that has not failed on a correct key. Consta keeps its `receiptUrl`
  door (its D1 contract, other integrators may want it); Devolada stops
  using it. **Rejected**: keeping OCR mode as a fallback — a fallback whose
  measured hit rate is 2 of 3 and that costs $0.25 to consult is not a
  fallback, it is a second chance to fail expensively.
- **D8 — A rejection at the edge is logged but never billed.** The
  branches that answer without calling the provider still write a
  `direct_payments` row, so the ISP can see in the feed that a customer
  tried and what they were told. They create no charge and consume no
  provider budget. **Rejected**: writing nothing — a customer who tried
  four times and gave up would be invisible to the ISP, which is exactly
  the support call nobody can answer.

## Dependencies

- **BUG-006** (`trackingKey` format validation) — prerequisite: D4 is the
  same check, and this feature produces candidates that must pass it.
- **BUG-003** (`invalid` with no `cepDetails` is terminal) — this feature
  removes most of the paths that reach it, but not all: a correctly
  extracted clave whose CEP is not yet published must still ride the D7
  schedule of `direct-payment.spec.md` rather than dying.
- Workers AI has **no precedent in this monorepo**; this adds the first
  `ai` binding, in `apps/api`.

## Scenarios

1. A readable receipt with a clave → extracted, passes D4, validated
   through the transfer door, confirmed (US-D09, D1, D5)
2. A receipt whose transfer is still *"En proceso"* → the customer is told
   to re-capture once the bank accepts; no provider call, no charge
   (US-D09, D5, D8)
3. An image that is not a receipt → rejected at the edge; no provider
   call, and no six-hour retry cycle (US-D09, D5)
4. The reader returns a candidate that fails `^[A-Z0-9]{28}$` → the manual
   door opens prefilled; no provider call (US-D10, D4, D6)
5. The two models disagree on the clave → same as scenario 4 (US-D10, D3)
6. Extraction succeeds but the CEP is not published yet → `pending`, rides
   the existing re-validation schedule, never a false rejection (US-D04)
7. A forged receipt with an edited amount → the extracted amount is never
   read; the verdict comes from `cepDetails`, and D11 rejects on mismatch
   (D2)
8. Workers AI is unavailable → the submission falls back to the manual
   door rather than failing; extraction is an optimisation, not a
   dependency of getting paid (D1)

## Definition of Done

- [ ] BUG-006 landed (the D4 check exists on the manual door)
- [ ] Scenarios automated in `apps/api/test/`, citing their stories, with
      the reader mocked
- [ ] The four benchmark fixtures kept as regression fixtures, scored
      against Banxico's own values
- [ ] Measured on deployed dev against real receipts: hit rate and
      latency recorded here, replacing the numbers above if they move
- [ ] `docs/integrations/apicep.md` notes that Devolada no longer uses
      OCR mode (D7)

## Open questions

- **The second *"En proceso"* case is still missing.** Cause (a) rests on
  one observation — a clean one, the same transfer failing and then
  confirming, but one. Before the *"wait for your bank"* branch is coded,
  a second capture taken before acceptance should reproduce it.
- **What does the reader cost at volume?** Workers AI is billed in
  neurons and the benchmark was ~50 invocations. The per-payment cost
  needs to be real before D1's economics are stated as fact.
- **Should the reader also read the amount and date, purely to warn?**
  Under D2 they can never decide anything, but telling a customer *"this
  receipt is for $150 and you owe $200"* before spending a call is worth
  something. It is also one refactor away from someone trusting it.
