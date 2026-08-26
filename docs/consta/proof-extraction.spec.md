---
status: in development
stories: [US-V09, US-V10, US-V11]
domain: consta
updated: 2026-08-26
debt: []
---

# Spec: Consta reads the receipt before paying to have it read

Consta sells one answer — *did this SPEI transfer happen?* — behind two doors
(`validation.spec.md` D1). Today the image door is the only place where Consta
pays a third party to read a picture and then cannot see what it read. This
spec moves the reading to Consta's own edge, so that **what is spent, and what
is told to a customer, both follow from something we can inspect.**

The measurable prize is not a better reader. It is a **gate**: an image that
has no receipt in it, a clave of the wrong shape, a bank outside the
vocabulary — each is knowable *before* a credit is spent, and none of them is
knowable today.

It replaces the earlier draft that placed this feature in Devolada
(`US-D09`/`US-D10`, PR #71, closed). The receipt door is Consta's promise, so
its repair is Consta's; an integrator working around its own provider's
weakness would leave every future customer with the same broken door.

## What was measured

**The receipt door refused a real, unspent transfer twice**, deterministically,
on 2026-08-18 — `invalid` with no `cepDetails` and no `cepStatus`. The same
transfer came back `valid` through the transfer door in 12.5 s using the clave
read off the image by hand.

**An image with no receipt in it costs far more than one call.** A dark UI
screenshot made apiCEP answer `status: "error"` rather than `invalid`. That maps
to a retryable failure, so the payment rode Devolada's full D7 schedule: **up to
7 paid calls across 6 hours**, ending in `expired`, with the customer watching a
spinner throughout. Measured live, row `a5b6fe52`.

### A correction to this spec's own first draft

That draft said *"the CEP existed the whole time"* and *"the receipt door missed
one payer in three"*. **Neither was measured.** The transfer-door success
happened *later in time* than both receipt-door refusals, so a CEP that had not
been published yet fits the same evidence as a misread. On 2026-08-19 two real
transfers were polled from authorisation with the money already delivered:
**30 samples across T+62 min and T+49 min, and neither ever published a CEP.**
That makes latency the likelier reading of 2026-08-18, not the reader.

What survives is narrower and still enough: the receipt door **refused a real
transfer twice**, and on the wire that refusal is identical to the one a
nonexistent transfer gets (`validation.spec.md` D11 now names it `not_found`).
Consta cannot say which it saw, and neither can its caller.

**Four distinct causes converge on that one faceless response**, and nothing on
the wire separates them:

| cause | resolves by waiting? | who can fix it | does this spec help? |
|---|---|---|---|
| the transfer never happened | no | the customer — pay | no |
| the CEP is not published yet | yes, **no measured upper bound** | nobody | no |
| the receipt was captured before the bank accepted it | yes, on **re-capture**, not on waiting | the customer | partly — the reading shows no clave is present |
| the clave or the sender bank was misread | **never** | the customer — correct one field | **yes — this is the gate** |

The fourth is the only one a reader can address, and it is proven independently
of any OCR question: sending `HSBC` instead of `NUBANK` on a real settled
transfer produced the same faceless `invalid` in 1.3 s, against 7.0 s for a
lookup that reached Banxico. A misread field and a nonexistent transfer are the
same bytes.

A 30-attempt benchmark on 2026-08-19, scored against what Banxico returned:

| reader | correct claves | latency | note |
|---|---|---|---|
| `@cf/mistralai/mistral-small-3.1-24b-instruct` | **30/30** | ~2.7 s | 10/10 on the receipt apiCEP failed twice |
| `@cf/meta/llama-3.2-11b-vision-instruct` | 0/10 on that receipt | ~4 s | identical misread every time, **27 characters** |
| `@cf/moondream/moondream3.1-9B-A2B` | unusable | — | returned `{}` |

**Correction, 2026-08-19, found by writing the test for it.** The first draft
called llama's failure "a deterministic misread that a length check catches for
free". It does not. The true clave is `NU3AGKMP3ASP8QQQ4U8J8F0K1E4K`; llama
returned `NU3AGKMP3ASP8QQ4U8J8F0K1E4K` — one `Q` short, 27 characters, every
one of them alphanumeric. It passes `^[A-Za-z0-9]{6,30}$` cleanly, because that
check is a **range** on purpose: apiCEP's own example carries ten characters and
a fixed 28 would lock out every bank that is not Nu (BUG-006). Two of our own
decisions were quietly contradicting each other, and the claim was the wrong one.

So the division of labour is sharper than the draft made it sound: **the gate
checks shape, and only the choice of model checks content.** A malformed clave,
an unknown bank and a file that is not a receipt are caught for free; a
plausible misread is not caught at all, and survives into a paid call. What
bounds *that* failure is elsewhere — it returns `not_found`, which rides the
retry schedule and carries `verify_inputs` instead of telling the payer their
transfer does not exist (`validation.spec.md` D11, direct-payment D17). The
regression test asserts both halves, including the one we cannot catch.

## Decisions

- **D1 — The reader runs inside Consta, before any paid call, and the point is
  the gate rather than the reading.** Extraction happens at Consta's edge on
  the bytes it fetched, and only a clave that passes the gate (D4) is spent on
  apiCEP. **The justification is not that our reader beats apiCEP's** — that
  comparison is unmeasured and, after the CEP-latency finding above, harder to
  make than it looked. It is that a reading we hold can be *inspected* and a
  reading we buy cannot. Three things become knowable before money moves,
  none of which is knowable today:

  | before | after |
  |---|---|
  | a screenshot with no receipt → apiCEP `error` → **7 paid calls, 6 h, `expired`** | refused at the edge, one Workers AI call, no credit |
  | a clave of the wrong shape → paid call → faceless `invalid` | refused at the edge, and the payer is told which field |
  | a bank outside the vocabulary → paid call → faceless `invalid` | refused at the edge (`validation.spec.md` D12 already does this for the transfer door) |

  None of those three depends on the reader being better than apiCEP's. They
  depend only on the reading being **in our hands**, which is the whole reason
  the reader moves inside. What the gate does not buy is protection from a
  plausible misread — see the correction above — and that limit belongs in the
  decision rather than in a footnote: **shape is gated here, content is bought
  with the choice of model (D5), and the consequence of getting content wrong
  is bounded by `not_found` riding the schedule rather than ending it.**
  **Rejected**: each integrator building its own reader — every one re-solves
  this, and the verdict mapping Consta owns (`validation.spec.md` D3) would
  drift across them; leaving the receipt door as it is and telling integrators
  to use the transfer door, which is asking every customer to transcribe 28
  characters from a phone screenshot.
- **D2 — Routing is by what the file is, never by whether something failed.**

  ```
  image/*          → read here → apiCEP direct mode
  application/pdf  → apiCEP OCR mode, unchanged
  ```

  "Try OCR, fall back to AI when it fails" was evaluated and rejected. The
  reason that decides it is that **there is no detectable trigger**: apiCEP
  signals an unreadable image as `status: "error"` with `missingFields`, but
  the real refusal we measured did not take that path — it returned `invalid`,
  which is byte-identical to what a nonexistent transfer and an unpublished
  CEP return. Falling back on that means falling back on every fake transfer
  and every slow CEP too, which is not a fallback, it is a second call always.

  **The cost argument that used to sit here has been withdrawn.** It computed
  `1×⅔ + 2×⅓ = 1.33` apiCEP calls per receipt from a "2-in-3 OCR success rate"
  that assumed the 2026-08-18 refusals were misreads. If they were CEP
  latency, OCR-first costs ~1.00 calls too and the arithmetic proves nothing.
  It is removed rather than rewritten because the honest input — how often
  apiCEP's OCR is actually wrong — **has never been measured**, and D2 does
  not need it: routing by file type is what makes the gate possible at all.
  You cannot inspect a reading you never received.

  PDF keeps the OCR mode alive for a concrete reason rather than a vague
  hedge: several Mexican banks issue the comprobante as a PDF (direct-payment
  D12), and vision models take images. **Rejected**: retiring OCR mode
  outright — it would shut those banks out; AI as a fallback after OCR — see
  above.
- **D3 — What the reader produces is a search key, never a verdict.** The
  extraction chooses *which* Banxico record we ask about. It never decides
  whether that record pays a debt. `cepDetails` remains the only source of
  amount and date (`docs/integrations/apicep.md`, "the field that decides
  money"). This line is what keeps the feature out of business logic, and it
  is the one somebody will want to optimise away in six months. **Rejected**:
  comparing the extracted amount against the expected total to skip a call —
  it is a reading of a picture the payer supplied.
- **D4 — The gate is a range and a vocabulary, not a fixed length.**
  `^[A-Za-z0-9]{6,30}$` after trimming (`validation.spec.md` D13), plus the
  sender bank must map into the 97-name vocabulary (its D12). The earlier
  draft fixed the check at 28 characters; that is **Nu's** length, while
  apiCEP's own documented example carries ten (`HSBC712057`), and Consta
  validates every Mexican bank — a fixed 28 would have traded a false negative
  for a false rejection. The bank half is not decoration: a name outside the
  vocabulary is answered `invalid`, never an error, so a misread bank is
  indistinguishable from a transfer that never happened. **When the bank does
  not map, that is a question for the payer, not a guess.**
- **D5 — `mistral-small-3.1-24b-instruct` is the reader.** On the benchmark
  above. The model is named in config, not in code, so replacing it is a
  deploy rather than a release. **Rejected**: llama-3.2-11b-vision (0/10 where
  it mattered); moondream (unusable output).
- **D6 — Two entry points, one implementation.** `POST /extract` returns the
  reading and spends no apiCEP credit; `POST /validate`'s `receiptUrl` door
  calls the same internal reader and continues into the verdict. Integrators
  who want the fast path keep the contract they have; integrators who want to
  show a customer what was read before spending money now can. **Devolada
  should use the two-step**, and that is the whole UX argument: a misread
  becomes *"revisa este dato"* in about three seconds instead of six hours of
  *"Verificando tu pago"*. A single endpoint cannot hold a human. **Rejected**:
  only `/extract`, leaving every integrator to orchestrate two calls; only
  `/validate`, which forecloses the confirmation step.
- **D7 — Consta fetches the bytes, and that is new surface it must own.**
  Today Consta never touches the image — it hands apiCEP a URL and apiCEP
  fetches it. Reading here means fetching here: **HTTPS only, no private or
  link-local address ranges, 1 MB cap** (apiCEP's own limit, kept for parity
  so the two doors refuse the same files), a fetch deadline under the
  request's, and routing decided by **magic bytes**, not by a caller-declared
  content type — one fetch, sniffed, then routed. A PDF is recognised and its
  *URL* goes on to apiCEP; the bytes are dropped. **Rejected**: trusting a
  `mimeType` field from the caller (a lie would route wrong, and the guard
  belongs where the bytes are); a HEAD request first (a second round trip for
  something the fetch already answers).
- **D8 — Consta stores the reading, never the image.** Each extraction records
  the model and version, its raw output, the clave chosen, and a **SHA-256 of
  the bytes read**. The hash ties the audit record to whatever the integrator
  still holds without Consta accumulating other people's customers' bank
  receipts — names, partial CLABEs and amounts are the integrator's data and
  their retention policy, not ours. Devolada's R2 bucket, its 15-minute signed
  URLs and its 15-day lifecycle (direct-payment D12) are unchanged; the only
  difference is that the URL is now fetched by a service we run.
  **A privacy gain falls out of D2**: on the image route apiCEP never receives
  the receipt at all, only a tracking key — one fewer third party holding
  Mexican bank documents, and `downloads.originalImage` stops being a copy of
  our customers' proofs sitting on a provider's storage.
  **Rejected**: a Consta R2 bucket mirroring every proof (liability with no
  audit value the hash does not already give); storing nothing (a verdict that
  rests on a reading must be able to show the reading).
- **D9 — A rejection at the edge is logged but never billed.** A clave that
  fails the gate, a bank that does not map, an image that cannot be read, a URL
  we refuse to fetch: each writes an `extractions` row with no provider call
  and no charge. This is the same principle as `validation.spec.md` D15 read
  from the other side — that one records calls apiCEP billed us for, this one
  records calls we refused to make. **They live in different tables on
  purpose**: a `validations` row means a request reached a provider, and these
  never did; folding them together would make "how many calls did we pay for?"
  unanswerable from either table. The join runs through
  `extractions.validation_id`, set only when a reading went on to buy a call.
  **Rejected**: silently dropping them, which would hide exactly the rate this
  feature exists to drive down; a nullable-status `validations` row (that is
  D15's shape for a different fact — a call that was billed and failed).

- **D10 — What this buys for resilience, and what it cannot buy.** The reason
  this spec exists at all is that Consta has to survive as a product, and a
  product with one path fails whenever that path does. This layer removes
  **one** third party from the image door's critical path: today that door
  depends on apiCEP's reader *and* on Banxico, and afterwards it depends on
  Banxico alone. That is a real reduction in failure surface, and it is the
  whole of what is being claimed.

  **It is not a second source of truth about whether money moved, and it must
  never be sold as one.** A reading of a receipt is a second reading of the
  *same claim* by the *same claimant* — the payer supplied the picture. When
  Banxico is unreachable or the CEP is not published, a perfect reading
  establishes nothing: it is exactly the `$1-receipt` hole that direct-payment
  D11 exists to close, and re-opening it in the name of resilience would trade
  a verifiable product for a plausible one. Nothing that reads pixels survives
  Banxico being down. A genuine second source has to observe the money
  arriving — a bank notification, a statement line — and that is a different
  spec with a different threat model, not this one.

  So the honest statement of scope: **this layer makes the image door cheaper,
  faster to correct, and dependent on fewer parties. It does not make an
  unverifiable transfer verifiable.** Anyone extending it toward "accept on
  the reading when Banxico is silent" is changing the product, and owes a
  spec that says who eats the loss (`validation.spec.md` D3, D11).
  **Rejected**: an "AI-confirmed" verdict tier alongside `valid`/`pending`/
  `invalid` — a verdict must name what Banxico said, and this names what a
  model saw.

## Contract

`POST /extract` — `Authorization: Bearer ck_…`

```
{ receiptUrl: "https://…" }
→ { success: true, data: {
      extractionId,
      source: "reader" | "provider-ocr",   // D2 routing, so callers can see it
      isReceipt: true | false | null,       // null on the PDF route: nothing was read here
      trackingKey: "NU3AGI…" | null,
      senderBank: "NUBANK" | null,          // mapped to the vocabulary, or null
      amountCents, date,                    // reported, never authoritative (D3)
      receiptStatus: "Aceptada" | "En proceso" | null,
      gate: { trackingKey: "ok" | "malformed" | "missing",
              senderBank:  "ok" | "unknown" | "missing",
              amount:      "ok" | "malformed" | "missing" } } }
```

`gate` is the field a caller acts on: anything but `ok` means asking the
customer, not spending a credit.

**`amount` is in the gate because apiCEP's direct mode requires
`sender.amount`** — a reading without one cannot buy a lookup at all. The
amount that travels is the one *printed on the receipt*, not the one the
caller expects, and that choice is deliberate: a $1 receipt against a $514
debt then comes back as a real CEP for $1, which the caller refuses with
`AMOUNT_MISMATCH` (direct-payment D11). Sending the expected amount instead
would turn that case into a faceless `not_found` and a six-hour wait for an
answer we already had. D3 is untouched — the reading chooses which record to
ask about, `cepDetails` still decides what it is worth.

`POST /validate` with `receiptUrl` is unchanged on the wire and gains `source`
and `extractionId`. Its refusals are `RECEIPT_UNREADABLE` (the image is not a
receipt) and `RECEIPT_INCOMPLETE` (it is, but a field did not pass the gate),
both `422` with `retryable: false` and the whole reading attached so the caller
can say *which* field to fix. `URL_NOT_ALLOWED`, `PROOF_TOO_LARGE` and
`UNSUPPORTED_MEDIA_TYPE` are `422`; `PROOF_UNREACHABLE`, `READER_UNAVAILABLE`
and `READER_UNREADABLE` are `502` with `retryable: true`.

**When the `AI` binding is absent the image route falls back to the provider's
OCR** rather than failing. A door that still works beats a door that 502s
because a binding is missing, and it makes this whole feature reversible by
configuration if it ever misbehaves in production.

## Scenarios

1. A JPEG receipt is read at the edge and validated through direct mode; one
   apiCEP call, `source: "reader"` (US-V09, D1, D2)
2. A PDF receipt goes to apiCEP's OCR mode untouched, `source:
   "provider-ocr"`, and Consta never fetches its bytes onward (US-V09, D2)
3. Routing follows magic bytes, not the caller's claim: a PDF served as
   `image/png` still takes the PDF route (US-V09, D7)
4. The gate catches a clave's **shape** — BUG-006's live 29-character string
   with a space and a Cyrillic З — and **provably does not catch** llama's
   27-character misread, which is alphanumeric and inside the range. Both
   halves are asserted, so nobody re-acquires the belief that the range
   protects against content (US-V10, D4, D5, D9)
5. A reading whose bank does not map to the vocabulary returns `gate.senderBank:
   "unknown"`, spends nothing, and never guesses a bank (US-V10, D4)
6. **An image with no receipt in it → `RECEIPT_UNREADABLE`, not retryable,
   with no apiCEP call at all** (US-V10, D1, D9, `validation.spec.md` D9).
   This is the spec's lead case: measured live, that image today costs up to
   7 paid calls over 6 hours and ends in `expired`
7. `/extract` spends no apiCEP quota: `X-RateLimit-Remaining` is unchanged
   across a call (US-V10, D6, `validation.spec.md` D14)
8. `/validate` on the image route reaches apiCEP in **direct** mode — the
   image never leaves Consta (US-V09, D2, D8)
9. A `receiptUrl` pointing at a private address range, an `http://` URL, or a
   2 MB file is refused before the fetch completes (US-V10, D7)
10. The extraction row carries the model, its raw output and the SHA-256 of
    the bytes; it does not carry the image (US-V10, D8)
11. The clave the reader produced is used only to *find* the CEP: amount and
    date on the response still come from `cepDetails`, even when the reading
    disagrees (US-V09, D3)
12. A reading that is perfect and a Banxico lookup that finds nothing still
    produce `not_found`, never a verdict of our own — the reading is never
    promoted to evidence when the CEP is missing (US-V09, D3, D10,
    `validation.spec.md` D11)

## Definition of Done

- [x] Scenarios 1–12 automated in `apps/consta/test/validate.test.ts`, each
      citing its story. The reader is stubbed with the shapes the real model
      was measured producing (fenced JSON, `esComprobante: false` on a
      non-receipt 5/5); the bytes are fixtures carrying real magic numbers
- [x] `AI` binding on the Consta worker; `EXTRACTION_MODEL` in `vars`, so
      swapping the model is a deploy and not a release (D5)
- [x] Migration `0002`: the `extractions` table of D8/D9
- [ ] The mock serves both routes and the gate failures (`validation.spec.md`
      already requires it to grow)
- [ ] Measured on real receipts before `status: accepted` — at minimum one
      PDF comprobante, one deliberately unreadable image, and one receipt
      captured before the bank accepted it
- [ ] **The two open measurements run before `status: accepted`**: capture a
      faceless receipt-door response body in full (does `extracted` come
      back?), and run both doors on one receipt inside the same minute. Both
      are cheap, both change what this spec is allowed to claim, and neither
      has been done
- [ ] `docs/integrations/apicep.md` updated with whatever the build measures
- [ ] **Devolada consumes both halves** (direct-payment D18, US-D09):
      `/extract` gates the upload for free, one silent attempt runs through
      the **transfer door**, and the payer is asked only when `not_found`
      leaves a real question. D6's argument — that a misread becomes
      *"revisa este dato"* in three seconds rather than six hours of
      *"Verificando"* — is what the asking half buys; the silent half is
      what keeps the other payers from being asked at all
- [ ] **The DNS gap of D7 is closed or accepted in writing.** The address
      checks refuse a URL that *says* it is internal; a public hostname whose
      DNS answer is private is not caught, because a Worker never sees the
      address it connected to. Integrators pass short-lived signed URLs today,
      which is a mitigation and not a fix

## Decisions — the second reader (US-V11, 2026-08-26)

Live testing gave the reader its first real-world measurement, and it is worse
than the 30/30 of 2026-08-19: on four Nu receipts the model misread the clave
on three — a dropped `K` (reproduced identically on two captures of the same
receipt) and a transposed `PF`. All deterministic, all shape-valid, so the
gate passed them and each bought a `not_found` ride. The reader's content is
verified by nobody except the payer — and the provider has been holding a
second opinion all along.

- **D11 — The receipt door's response exposes the provider's reading.** apiCEP
  returns `extracted` — *what the picture said* — on every OCR-mode call, and
  the mapper has been discarding it. The validate response (receipt door only)
  gains a `reading` object: `{ trackingKey, amountCents, date, senderBank,
  referenceNumber }`, mapped from `extracted`, plus `missingFields` surfaced on
  the success envelope when the provider names unread fields. Labeled in the
  contract the way apicep.md demands: **a reading, never a verdict** —
  `extracted` is attacker-controlled (measured with a forged receipt), so it
  can inform a client's UX or a comparison, and can never decide money; the
  money still comes from `cep` (Banxico's record) alone. **Gated on one
  measurement, first**: whether `extracted` comes back on a *failed*
  receipt-door validation — the open question below, one captured call. If it
  only accompanies success, the field ships anyway (it is still the second
  opinion on every validated receipt, and the raw material of D12) but the
  first consumer's plan A collapses to its plan B
  (`direct-payment/reading-check.spec.md`). **The probe consumes receipts**:
  `cepPreviouslyValidated` is permanent, so the measurement uses an
  already-consumed comprobante or a fabricated one, never a virgin useful one.
  **Rejected**: keeping the mapper as-is (throwing away a reading the caller
  already paid for); exposing the full `extracted` verbatim (senderName,
  beneficiaryName and paymentConcept invite exactly the trust-the-pixels
  integrations apicep.md warns against — the five fields above are the ones a
  reading consumer legitimately compares).

- **D12 — The comparison stays client-side today, and its migration path is
  named: `expected`.** The first consumer (Devolada's reading-check) compares
  its own reading against D11's, on its side — Consta does not learn what the
  client believes, and no comparison semantics are frozen into this contract
  on a sample of one integrator. But the mission this is walking toward is
  reconciliation: the day that feature is specced, the validate request grows
  `expected: { trackingKey?, amountCents?, … }` — *"this is what my books
  say"* — and the response answers per field: `matched | disputed | unread`.
  That primitive *is* invoice/receipt reconciliation in the singular;
  reconciling a batch is running it N times against a ledger. D11 is its
  prerequisite either way, so nothing built now is thrown away. **Rejected**:
  building `expected` today (API semantics cannot be un-shipped, and one
  internal consumer is not evidence of the right shape).

## Open questions

- **Does `extracted` come back on a faceless receipt-door `invalid`?** Never
  captured, and it is now the **cheapest unanswered question in this spec**:
  if apiCEP reports what it read even when it fails, then how often its OCR is
  actually wrong becomes measurable for the first time — the number D2's
  withdrawn cost argument needed and never had. One captured response body
  answers it. *(2026-08-26: now the gate of D11 — and of
  reading-check plan A on the Devolada side.)*
- **Was 2026-08-18 a misread or an unpublished CEP?** Still unsettled, and it
  is settleable: run **both doors on the same receipt inside the same
  minute** — the image through the receipt door, the clave read off it by hand
  through the transfer door. A `valid` from one and a faceless `invalid` from
  the other in the same window is a misread with nothing left to argue. All
  the evidence so far compares calls made hours apart, which is why it cannot
  distinguish the two.
- **Cost per extraction at volume.** Fifty Workers AI invocations are not a
  pricing model, and Consta's fixed per-transaction fee has to absorb it.
- **Whether the reader should attempt the beneficiary.** It cannot: receipts
  mask the destination CLABE (`docs/integrations/apicep.md`). The beneficiary
  stays a caller-supplied field. Recorded so nobody re-opens it.
- ~~**`potentialBeneficiaries` is OCR-mode only**~~ — **decided**: a caller
  using it keeps the provider's OCR door, image or not. apiCEP matches the
  image against a list of candidate accounts and a direct-mode call takes
  exactly one beneficiary, so the field cannot cross to the reader route. It
  stays in the contract; it simply selects the other door.
- **Is `sender.amount` a hint or a filter in direct mode?** The claimed *date*
  is documented as a hint — a validation claiming `2026-08-15` returned a CEP
  dated `2026-08-17` — and nobody has tested whether the amount behaves the
  same. It decides how a misread amount fails: harmlessly if it is a hint,
  as a faceless `not_found` if it is a filter. One deliberate call with a
  wrong amount against a known-good transfer answers it.
