# apiCEP — verified contract

**Status: verified live (2026-08-17 direct mode, 2026-08-18 receipt mode).** Provider of the Banxico CEP behind Consta (`docs/consta/validation.spec.md`). This file records the contract **as measured**; where it disagrees with apiCEP's own documentation or its blog, the measurement wins — the same rule `agnostic-auth.md` follows.

## Who calls it

**Only `apps/consta`.** `apps/api` has no apiCEP credential and never talks to it: Devolada calls Consta (`src/consta/client.ts`), Consta calls apiCEP (`src/provider/apicep.ts`). Wiring apiCEP into `apps/api` would put a provider key in the wrong Worker and duplicate the verdict mapping that Consta owns.

The environment variable is **`APICEP_TOKEN`**, a Consta worker secret. Public guides call it `APICEP_API_KEY`; this repo does not.

## Auth, and the credential trap

`Authorization: Bearer <token>`, two accepted kinds. **The trap is not the token's lifetime — it is the deploy.** See below.

- **`sk_live_…`** — **this repo never had evidence such a key is issued to us, and it is not needed.** The claim traces to apiCEP's own 401 `hint`, not to their documentation: an unauthenticated call answers `{"error":"Missing or invalid Authorization header","hint":"Use Bearer sk_live_... for API keys or Bearer apicep_... for user tokens"}`. That said, it is **not** a dead copy-paste string — apiCEP branches on the prefix, measured 2026-08-19: a made-up `sk_live_…` answers `API key not found` while a made-up `apicep_…` answers `Invalid or revoked API token`, so a separate API-key lookup path exists. Whether it is reachable by a customer is unknown and moot; do not chase one.
- **`apicep_…`** — user token. **It does not expire, and minting a new one does not invalidate the old ones.** Settled by two independent measurements on 2026-08-18: a token two hours old still authenticated, and after issuing a fresh one **both** earlier tokens kept working — which rules out time-based expiry and supersession alike. This is the credential dev runs on and it is treated as **definitive**. This file previously claimed the opposite ("dies within the hour", four observations across 2026-08-17/18). That claim was **wrong**, and it cost a debugging session that chased expiry while the real cause sat in the deploy pipeline. What those four observations actually were is unknown — the values are gone and cannot be retested; the honest record is that they were never re-verified against a token that had simply been left alone.

**The real trap: every deploy overwrites the worker secret with whatever the GitHub environment holds** (CICD D5). A wrong value there reinstates itself on the next merge with nobody touching anything, and the sync step only checks that the secret is non-empty — so a wrong-but-present token deploys under a green tick. Measured 2026-08-18 on dev: apiCEP answered **401**, Consta mapped it to `PROVIDER_ERROR`, the api mapped that to retryable, and direct payments sat in `validating` showing the customer *"Verificando tu pago"* for the full six-hour schedule instead of failing loudly (BUG-002). `deploy-dev` now probes the credential right after planting it (CICD D6), which turns that silence into a red deploy.

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

- ~~Capture one raw response~~ **done, 2026-08-18.** A direct-mode response carried a top-level `confidence: 1`, `validation.banxicoConfirmed: true`, and a full `extracted` object (`senderBank`, `receiverBank`, `trackingKey`, `amount`, `date`, `beneficiaryName`) — all three previously documented but never observed here. It also carried a `processingTime` breakdown (`ocr`, `validation`, `total`) and a far richer `cepDetails` than this file models: `speiKey`, `cdaChain`, `certificateNumber`, sender/beneficiary account numbers, account types and **RFCs**, `paymentConcept`, `iva`. Consta reads eight fields and drops the rest, which is the right default — `cdaChain` alone carries both parties' RFCs and full CLABEs. `downloads.originalImage` was still not returned. Note `downloads.cepPdf` is not always present on the first call: one validation returned only `cepXml`, and the same transfer returned both minutes later, so the PDF appears to be generated asynchronously.
- ~~Buy an `sk_live_` key~~ **closed, not a real dependency.** The expiry that justified it was measured away, and the key type itself traces to a 401 hint rather than to anything apiCEP offers us (see Auth). The `apicep_` token is permanent and definitive. Revisit only if a paid plan is bought for volume reasons.
- Whether pending re-checks consume credits is still unanswered by apiCEP (asked 2026-08-17); direct-payment D7's cadence is priced as if they do.
