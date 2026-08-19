---
status: proposed
stories: [US-V09, US-V10]
domain: consta
updated: 2026-08-19
debt: []
---

# Spec: Consta reads the receipt before paying to have it read

Consta sells one answer — *did this SPEI transfer happen?* — behind two doors
(`validation.spec.md` D1). The transfer door has not missed once in four real
validations. **The receipt door missed one payer in three**, and did it
silently. This spec fixes the broken half by reading the image at Consta's own
edge and validating through the door that works.

It replaces the earlier draft that placed this feature in Devolada
(`US-D09`/`US-D10`, PR #71, closed). The receipt door is Consta's promise, so
its repair is Consta's; an integrator working around its own provider's
weakness would leave every future customer with the same broken door.

## What was measured

Three real Nubank transfers went through the receipt door on 2026-08-18. It
read two and failed the third outright — `invalid` with **no `cepDetails` and
no `cepStatus`**, twice, deterministically. The same transfer came back
`valid` through the transfer door in 12.5 s using the clave read off the image
by hand. The CEP existed the whole time.

**Three distinct causes converge on that one faceless response**, and nothing
on the wire separates them:

| cause | resolves by waiting? | who can fix it |
|---|---|---|
| the transfer never happened | no | the customer — pay |
| the receipt was captured before the bank accepted it | **yes, ≤30 min** | nobody |
| the reader misread the clave — or the sender bank | **never** | the customer — correct one field |

The third was proven twice over: apiCEP's OCR failed the same file identically
on two attempts, and (2026-08-19) sending `HSBC` instead of `NUBANK` on a real
settled transfer produced the same `invalid` with no `cepDetails`, in 1.3 s
against 7.0 s for a lookup that reached Banxico.

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

- **D1 — The reader runs inside Consta, before any paid call.** Extraction
  happens at Consta's edge on the bytes it fetched, and only a clave that
  passes the gate (D4) is spent on apiCEP. **Rejected**: each integrator
  building its own reader — every one of them re-solves this, and the verdict
  mapping Consta owns (`validation.spec.md` D3) would drift across them;
  leaving the receipt door as it is and telling integrators to use the
  transfer door, which is asking every customer to transcribe 28 characters
  from a phone screenshot.
- **D2 — Routing is by what the file is, never by whether something failed.**

  ```
  image/*          → read here → apiCEP direct mode
  application/pdf  → apiCEP OCR mode, unchanged
  ```

  "Try OCR, fall back to AI when it fails" was evaluated and rejected, for two
  measured reasons. **There is no detectable trigger**: apiCEP signals an
  unreadable image as `status: "error"` with `missingFields`, but our real
  false negative did not take that path — it returned `invalid`, which is also
  what a nonexistent transfer returns, so falling back on it means retrying
  every fake transfer too. **And it costs more**: at the measured 2-in-3
  success rate, OCR-first spends `1×⅔ + 2×⅓ = 1.33` apiCEP calls per receipt
  against `1.00` for reading first, and is slower on both paths (13.5–14.6 s
  happy, ~24 s on failure, against ~10 s either way). Against a measured quota
  of 800 calls per period that is ~264 receipts instead of ~800. PDF keeps the
  OCR mode alive for a concrete reason rather than a vague hedge: several
  Mexican banks issue the comprobante as a PDF (direct-payment D12), and
  vision models take images. **Rejected**: retiring OCR mode outright — it
  would shut those banks out; AI as a fallback after OCR — see above.
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
6. An image with no receipt in it → `RECEIPT_UNREADABLE`, not retryable, with
   no apiCEP call at all (US-V10, D9, `validation.spec.md` D9)
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

## Definition of Done

- [ ] Scenarios 1–11 automated, each citing its story
- [ ] `AI` binding on the Consta worker; the model named in config (D5)
- [ ] The mock serves both routes and the gate failures (`validation.spec.md`
      already requires it to grow)
- [ ] Migration: the extraction record of D8
- [ ] Measured on real receipts before `status: accepted` — at minimum one
      PDF comprobante, one deliberately unreadable image, and one receipt
      captured before the bank accepted it
- [ ] `docs/integrations/apicep.md` updated with whatever the build measures

## Open questions

- **Does `extracted` come back on a faceless receipt-door `invalid`?** Never
  captured. If apiCEP does report what it read even when it fails, part of
  D2's argument weakens and the routing deserves a second look.
- **Cost per extraction at volume.** Fifty Workers AI invocations are not a
  pricing model, and Consta's fixed per-transaction fee has to absorb it.
- **Whether the reader should attempt the beneficiary.** It cannot: receipts
  mask the destination CLABE (`docs/integrations/apicep.md`). The beneficiary
  stays a caller-supplied field. Recorded so nobody re-opens it.
- **`potentialBeneficiaries` is OCR-mode only**, so on the image route it has
  nowhere to go. Decide whether it survives as a PDF-route feature or leaves
  the contract.
