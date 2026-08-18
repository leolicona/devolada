# apiCEP — verified contract

**Status: verified live (2026-08-17 direct mode, 2026-08-18 receipt mode).** Provider of the Banxico CEP behind Consta (`docs/consta/validation.spec.md`). This file records the contract **as measured**; where it disagrees with apiCEP's own documentation or its blog, the measurement wins — the same rule `agnostic-auth.md` follows.

## Who calls it

**Only `apps/consta`.** `apps/api` has no apiCEP credential and never talks to it: Devolada calls Consta (`src/consta/client.ts`), Consta calls apiCEP (`src/provider/apicep.ts`). Wiring apiCEP into `apps/api` would put a provider key in the wrong Worker and duplicate the verdict mapping that Consta owns.

The environment variable is **`APICEP_TOKEN`**, a Consta worker secret. Public guides call it `APICEP_API_KEY`; this repo does not.

## Auth, and the credential trap

`Authorization: Bearer <token>`, two accepted kinds:

- **`sk_live_…`** — permanent API key. The only kind fit for a deployed Worker.
- **`apicep_…`** — user token. **Dies within the hour** (observed four times: 2026-08-17 twice, 2026-08-18 twice). Usable for a manual test fired immediately; never for anything deployed.

Until an `sk_live_` key is bought, every deployed validation decays inside the hour and the SPEI channel silently stops working — `PROVIDER_ERROR`, which Consta maps to retryable, so payments sit in `validating` rather than failing loudly.

## Request

`POST https://api.apicep.cloud/validate-transfer`

Two modes; send one. Consta's two doors map 1:1 onto them.

```jsonc
// OCR mode  (Consta's receiptUrl door)
{ "system": "SPEI",
  "imageUrl": "https://…",            // public HTTPS; see the fetch note
  "beneficiary": { "bank": "…", "clabe": "…", "name": "…" } }

// Direct mode  (Consta's transfer door)
{ "system": "SPEI",
  "beneficiary": { "bank": "…", "clabe": "…", "name": "…" },
  "sender": { "date": "YYYY-MM-DD", "amount": 2.00,   // decimal pesos, not cents
              "bank": "NUBANK", "trackingKey": "…", "referenceNumber": null } }
```

- **The image travels by URL only** — no multipart, no base64 (docs, 2026-08-18).
- **apiCEP's fetcher reads short-lived signed URLs fine.** Verified against our own HMAC-signed R2 proxy (`GET /direct-payments/proofs/:linkId/:file`, 15-minute expiry). This was the open unknown before the receipt door ever ran.
- Accepted: **JPEG, PNG, PDF, GIF, WebP, BMP, TIFF, HEIC**, **1 MB max**. PDF matters — several Mexican banks issue the comprobante as one.
- `beneficiary` is required in OCR mode, and it is **not read from the image**: receipts mask the destination CLABE (Nu prints `••••8274`), so apiCEP matches the beneficiary the caller sends against Banxico's record. No OCR can recover it.
- The claimed `date` in direct mode is a **hint, not a filter**: a validation claiming `2026-08-15` returned a CEP dated `2026-08-17`. Compare the returned date yourself (direct-payment D11 does).

## Response

Verified fields — these are the ones Consta reads and the ones behaviour has been proven on:

```jsonc
{ "validationId": "…",
  "status": "valid" | "invalid" | "pending" | "error",
  "validation": {
    "cepStatus": "LIQUIDADO" | "EN PROCESO" | …,
    "cepPreviouslyValidated": true | false | null,
    "cepDetails": { "trackingKey", "amount", "operationDate", "senderBank",
                    "senderName", "receiverBank", "beneficiaryName",
                    "digitalSignature" } },
  "downloads": { "cepXml": "https://storage.apicep.cloud/…",
                 "cepPdf":  "…" } }              // expire after 15 days
```

Documented by apiCEP but **never yet observed in a response we captured**: a top-level `confidence` (OCR score 0.0–1.0), `validation.banxicoConfirmed`, an `extracted` object, and `downloads.originalImage`. Consta's adapter does not model them, so nothing has ever printed them. `confidence` is worth capturing deliberately — see the open items.

### The field that decides money

**`cepDetails` is Banxico's record. `extracted` is what the image claimed.** Public guides tell integrators to compare `extracted.amount` against what is owed. **Do not.** `extracted` is attacker-controlled — it is a reading of a picture the payer supplied — and trusting it is exactly the `$1-receipt` hole that direct-payment D11 exists to close.

Proven, 2026-08-18: a comprobante was forged by changing one character of the clave de rastreo (`…CDB`**`F`**`MU…` → `…CDB`**`E`**`MU…`), leaving folio, reference, date, amount and banks untouched. apiCEP answered with **Banxico's real key** — the `F` — the true amount, and `cepStatus: LIQUIDADO`. The edit never reached the verdict. That is the whole security property: **the answer comes from the record, not the pixels.**

So: decide money on `cepDetails.amount` and `cepDetails.operationDate`, never on the receipt and never on `extracted`.

## HTTP 200 is not a valid payment

Correct, and worth restating in this repo's terms. `status` is the verdict and it arrives inside a 200. Consta's mapping (`validation.spec.md` D3):

| provider | Consta | why |
|---|---|---|
| `status: "valid"` | `valid` | still necessary-not-sufficient — D11 re-checks amount and date |
| `status: "pending"`, or `invalid` with `cepStatus: "EN PROCESO"` | `pending` | a CEP can take up to ~30 min; "not published yet" must never read as "fake" |
| `status: "invalid"` | `invalid` | genuinely contradicts the claim |
| `status: "error"`, or HTTP 4xx/5xx | **not a verdict** → `PROVIDER_ERROR` (502) | nothing was validated; no `validations` row is written |

A garbage tracking key answers **HTTP 200 with `status: "invalid"`** (5 measured) — a made-up transfer is a verdict, not an error.

## Measured behaviour

- **Latency 12.5–19 s** per validation, receipt and transfer door alike. Their marketing says "less than 10 seconds"; it is not. Anything calling this synchronously must budget for ~15 s, and Consta's client carries a 30 s deadline for it.
- **The OCR produces false negatives, silently.** Of three real Nubank transfers, the receipt door read two and failed the third outright — `invalid` with **no `cepDetails` at all**, twice, deterministically. The same transfer validated through the **direct mode in 12.5 s** using the key read off the image by hand. The CEP existed the whole time. On the wire, an unreadable receipt is indistinguishable from a transfer that never happened.
- **The direct mode has not missed one** (3 for 3). It is the reliable door; OCR is the convenient one (direct-payment D2).
- **An image with no receipt in it errors — it does not answer `invalid`.** A dark UI screenshot produced `PROVIDER_ERROR`, i.e. retryable, so a payment carrying it retries on the full schedule instead of failing once. Open question in direct-payment's DoD.
- **`cepPreviouslyValidated` is per CEP and permanent.** Once a CEP is validated it stays flagged, so a receipt is effectively single-use for testing: a second submission cannot re-test the first outcome. Consta reports the flag and refuses to act on it (its D4); the replay policy is the integrator's (direct-payment D8).

## Environment

No sandbox, no test keys, no free credits (docs checked 2026-08-17). A **free Welcome plan** exists — 50 requests / 30 days on signup at `app.apicep.cloud` — enough for smoke checks. Dev therefore carries its own mock: `pnpm sandbox` in `apps/consta` serves `/validate-transfer` on port 8789, with scenarios keyed off the tracking key (`PEND`, `DUP`, `BAD`, `ERR`). Pointing `APICEP_BASE_URL` at it is a one-line switch, which is what Consta's adapter boundary (its D2) buys.

Cost is roughly **$0.25 MXN per call**, which sets the budgets in direct-payment D13.

## Open items

- Capture one raw response and record whether `confidence`, `validation.banxicoConfirmed`, `extracted.*` and `downloads.originalImage` are really returned. `confidence` in particular would let the receipt door tell "I could not read this" from "this transfer does not exist" — the distinction the false-negative case turns on.
- Buy an `sk_live_` key. Everything deployed decays within the hour without it.
- Whether pending re-checks consume credits is still unanswered by apiCEP (asked 2026-08-17); direct-payment D7's cadence is priced as if they do.
