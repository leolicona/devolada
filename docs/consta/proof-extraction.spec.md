---
status: proposed
stories: [US-V09, US-V10]
domain: consta
updated: 2026-08-19
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

llama's failure is the load-bearing result, not mistral's success: a
deterministic misread that a length check catches for free. **That is the
property this spec buys — not a reader that cannot be wrong, but a reading we
can inspect, gate and correct.**

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

  llama's measured 27-character misread is the load-bearing result of the
  benchmark, not mistral's 30/30: **a deterministic error that a length check
  catches for free.** That is the property being bought — not a reader that
  cannot be wrong, but a reading that can be gated and corrected. A gate needs
  the reading in hand, which is the whole reason the reader moves inside.
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
  fails the gate, a bank that does not map, an image that cannot be read: each
  writes a `validations` row with no provider call and no charge. This is the
  same principle as `validation.spec.md` D15 read from the other side — that
  one records calls apiCEP billed us for, this one records calls we refused to
  make. **Rejected**: silently dropping them, which would hide exactly the
  rate this feature exists to drive down.

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
      trackingKey: "NU3AGI…" | null,
      senderBank: "NUBANK" | null,          // mapped to the vocabulary, or null
      amountCents, date,                    // reported, never authoritative (D3)
      gate: { trackingKey: "ok" | "malformed" | "missing",
              senderBank:  "ok" | "unknown" | "missing" } } }
```

`gate` is the field a caller acts on: anything but `ok` means asking the
customer, not spending a credit. `POST /validate` with `receiptUrl` is
unchanged on the wire and gains `source` in its response.

## Scenarios

1. A JPEG receipt is read at the edge and validated through direct mode; one
   apiCEP call, `source: "reader"` (US-V09, D1, D2)
2. A PDF receipt goes to apiCEP's OCR mode untouched, `source:
   "provider-ocr"`, and Consta never fetches its bytes onward (US-V09, D2)
3. Routing follows magic bytes, not the caller's claim: a PDF served as
   `image/png` still takes the PDF route (US-V09, D7)
4. A reading whose clave is 27 characters — llama's measured misread — is
   gated before any paid call, and the row records the rejection (US-V10, D4, D9)
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

- [ ] Scenarios 1–12 automated, each citing its story
- [ ] `AI` binding on the Consta worker; the model named in config (D5)
- [ ] The mock serves both routes and the gate failures (`validation.spec.md`
      already requires it to grow)
- [ ] Migration: the extraction record of D8
- [ ] Measured on real receipts before `status: accepted` — at minimum one
      PDF comprobante, one deliberately unreadable image, and one receipt
      captured before the bank accepted it
- [ ] **The two open measurements run before `status: accepted`**: capture a
      faceless receipt-door response body in full (does `extracted` come
      back?), and run both doors on one receipt inside the same minute. Both
      are cheap, both change what this spec is allowed to claim, and neither
      has been done
- [ ] `docs/integrations/apicep.md` updated with whatever the build measures

## Open questions

- **Does `extracted` come back on a faceless receipt-door `invalid`?** Never
  captured, and it is now the **cheapest unanswered question in this spec**:
  if apiCEP reports what it read even when it fails, then how often its OCR is
  actually wrong becomes measurable for the first time — the number D2's
  withdrawn cost argument needed and never had. One captured response body
  answers it.
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
- **`potentialBeneficiaries` is OCR-mode only**, so on the image route it has
  nowhere to go. Decide whether it survives as a PDF-route feature or leaves
  the contract.
