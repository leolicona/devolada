# apiCEP — verified contract

**Status: verified live (2026-08-17 direct mode, 2026-08-18 receipt mode).** Provider of the Banxico CEP behind Consta (`docs/consta/validation.spec.md`). This file records the contract **as measured**; where it disagrees with apiCEP's own documentation or its blog, the measurement wins — the same rule `agnostic-auth.md` follows.

## Who calls it

**Only `apps/consta`.** `apps/api` has no apiCEP credential and never talks to it: Devolada calls Consta (`src/consta/client.ts`), Consta calls apiCEP (`src/provider/apicep.ts`). Wiring apiCEP into `apps/api` would put a provider key in the wrong Worker and duplicate the verdict mapping that Consta owns.

The environment variable is **`APICEP_TOKEN`**, a Consta worker secret. Public guides call it `APICEP_API_KEY`; this repo does not.

## Auth, and the credential trap

`Authorization: Bearer <token>`, two accepted kinds. They are apiCEP's own, stated in its 401 body — worth quoting, because `sk_live_` is also Stripe's convention and reads like a copy-paste error otherwise:

```json
{"error": "Missing or invalid Authorization header",
 "hint": "Use Bearer sk_live_... for API keys or Bearer apicep_... for user tokens"}
```

- **`sk_live_…`** — API key.
- **`apicep_…`** — user token, what the dashboard's "Generar Token" issues.

### Generating a token revokes the previous one

Confirmed by apiCEP support, 2026-08-18, and it is the single most expensive fact on this page:

> Nuestros API tokens no tienen fecha de caducidad… El token continuará funcionando con normalidad hasta que usted decida revocarlo **o generar uno nuevo**.

So **generating a token is a destructive act**, not a safe precaution. The instinct when something looks broken — "let me make a fresh one" — is what breaks it, because it kills the credential the deployed Worker is holding. Tokens have no expiry; a token that stops working was superseded by one you generated later.

Rule: hold exactly one token, put that same value in the GitHub environment secret *and* on the Worker, and do not open the generator again.

### They also do not expire on their own — CI was overwriting them

Recorded because we believed the opposite for two days, and the wrong belief was expensive.

The symptom: a token set by hand works, then every validation answers `PROVIDER_ERROR` an hour or so later, and setting it again fixes it. That reads exactly like a short-lived credential, and it was written up as one (twice on 2026-08-17, again on 2026-08-18).

It is not — and the two facts compound. A token generated later had already killed the one the GitHub secret held, and then: **Every dev deploy runs `wrangler secret put APICEP_TOKEN --env dev` from the GitHub Actions environment secret** (`deploy-dev.yml`, "Sync Consta worker secrets"). A hand-set token therefore survives only until the next merge to `main`, and on a busy day that is about an hour. Traced 2026-08-18: validations succeeded at 18:20–18:27, a deploy landed at 18:39, the next attempt failed; set by hand again, worked 20:09–20:13; a deploy landed at 20:53, and everything after 21:04 failed. Every failure follows a deploy; every recovery follows a manual `secret put`. Meanwhile the provider's dashboard listed six tokens — two of them a day old — all still `Activo`.

So: **the GitHub environment secret is the source of truth.** `wrangler secret put` buys working software until the next merge and no longer. Changing the token means changing it there.

An `sk_live_` API key is still the better credential for anything deployed — it is the kind meant for machines — but it would not have prevented any of this. The clobber is ours.

**How to tell in ten seconds**, because our own logs will not say: `wrangler tail devolada-consta-dev --format json` and look for `provider error: apiCEP responded 401`. Devolada's API logs only `CONSTA_UNAVAILABLE`, dropping the provider's status code, so a bad credential and a provider outage are indistinguishable from the Devolada side. Worth fixing; until it is, Consta's tail is the diagnosis.

However the credential is lost — superseded by a new one, or clobbered by a deploy — the failure is quiet. Consta answers `PROVIDER_ERROR`, which is retryable, so payments sit in `validating` and the SPEI channel looks slow rather than broken. Nothing alerts; the first symptom is a customer still waiting.

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

Captured whole from a live direct-mode call, 2026-08-18. Consta reads a subset; the rest is real and simply unused:

```jsonc
{ "validationId": "…",
  "status": "valid" | "invalid" | "pending" | "error",
  "confidence": 1,                          // OCR score; 1 in direct mode, where nothing is read
  "extracted": {                            // the CLAIM — echoes the request in direct mode,
    "senderBank", "receiverBank",           // the OCR's reading in receipt mode
    "trackingKey", "amount", "date", "beneficiaryName" },
  "validation": {
    "banxicoConfirmed": true,
    "cepStatus": "LIQUIDADO" | "EN PROCESO" | …,
    "cepPreviouslyValidated": true | false | null,
    "cepDetails": {                         // the RECORD — Banxico's, far richer than we model
      "trackingKey", "amount", "iva", "operationDate", "processingTime",
      "speiKey", "paymentConcept", "certificateNumber", "digitalSignature",
      "cdaChain",                           // the full signed CEP string
      "senderBank", "senderName", "senderAccount", "senderAccountType", "senderRfc",
      "receiverBank", "beneficiaryName", "beneficiaryAccount",
      "beneficiaryAccountType", "beneficiaryRfc" } },
  "downloads": { "cepXml": "https://storage.apicep.cloud/…",
                 "cepPdf":  "…" },          // expire after 15 days
  "processingTime": { "ocr": "0ms", "validation": "7.99s", "total": "9.34s" } }
```

`confidence`, `extracted` and `validation.banxicoConfirmed` **do exist** — this file said otherwise until a raw response was captured. `downloads.originalImage` is documented and still unobserved; it plausibly only appears in receipt mode.

**This response is full of personal data.** `senderRfc`, `beneficiaryRfc`, both complete 18-digit accounts and the whole `cdaChain` (which repeats all of it) travel in every verdict. Consta's `validations` log deliberately stores a handful of mapped fields, not the body — keep it that way, and never log the response wholesale.

### The field that decides money

**`cepDetails` is Banxico's record. `extracted` is the claim.** Public guides tell integrators to compare `extracted.amount` against what is owed. **Do not.** In receipt mode `extracted` is the OCR's reading of a picture the payer supplied; in direct mode it is an echo of the caller's own request. Either way it is the input, not the truth, and trusting it is exactly the `$1-receipt` hole that direct-payment D11 exists to close.

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

- **Surface `confidence` through Consta.** Now that the field is known to exist, it is the answer to the receipt door's worst failure: an unreadable screenshot and a transfer that never happened both come back `invalid`, and the customer is told the same wrong thing. A low `confidence` on an `invalid` distinguishes them, which would let the page say "no pudimos leer tu captura, intenta con los datos" instead of "no pudimos verificar tu transferencia". Needs one field on Consta's verdict shape and a reading on the false-negative receipt to learn what its score actually is.
- Capture a **receipt-mode** raw response too: `downloads.originalImage` is documented and still unobserved, and the direct-mode capture shows `ocr: 0ms`, so nothing is yet known about what the OCR reports when it fails.
- Find out whether an `sk_live_` key is obtainable at all. It appears only in apiCEP's 401 hint; the dashboard issues `apicep_` tokens and nothing else, so it may be an enterprise tier — or, as the owner reads it, a leftover from a Stripe copy-paste. Worth one support question, and worth little more: the outage was ours, not the credential's.
- Whether pending re-checks consume credits is still unanswered by apiCEP (asked 2026-08-17); direct-payment D7's cadence is priced as if they do.
