# apiCEP — verified contract

**Status: verified live (2026-08-17 direct mode, 2026-08-18 receipt mode); apiCEP's published reference merged and probed on 2026-08-19.** Provider of the Banxico CEP behind Consta (`docs/consta/validation.spec.md`).

This file records the contract **as measured**; where it disagrees with apiCEP's own documentation or its blog, the measurement wins — the same rule `agnostic-auth.md` follows. Two provenances now live here and they are never blurred:

- **Measured** — we sent it and read the answer. Load-bearing; safe to build on.
- **Published** — from apiCEP's reference, marked *(published, unverified)*. Good enough to code defensively against, not good enough to build on. The 2026-08-19 probe run tested nine published claims and **three were wrong**, one of them in the direction that would have cost us money.

## Who calls it

**Only `apps/consta`.** `apps/api` has no apiCEP credential and never talks to it: Devolada calls Consta (`src/consta/client.ts`), Consta calls apiCEP (`src/provider/apicep.ts`). Wiring apiCEP into `apps/api` would put a provider key in the wrong Worker and duplicate the verdict mapping that Consta owns.

The environment variable is **`APICEP_TOKEN`**, a Consta worker secret. Public guides call it `APICEP_API_KEY`; this repo does not.

## Auth

`Authorization: Bearer <token>`. Working configuration as of 2026-08-19; the
history that got us here is at the bottom of this section.

**`APICEP_TOKEN` is an `apicep_…` token, and that is the right credential.**
It does not expire: measured at two hours of age with no change, and minting
a replacement leaves earlier tokens working, so neither time nor rotation
ends one. Treat it as permanent.

**It can still be revoked**, which is the one way it dies — apiCEP answers
`{"error":"Invalid or revoked API token"}`. That message is one of
**five different 401s**, and the HTTP code alone cannot tell them apart —
measured 2026-08-19, after a hand-run `curl` failed once and succeeded on
retry with a token that was never revoked:

| body | what actually happened | fatal? |
|---|---|---|
| `Missing or invalid Authorization header` | no header, an empty one, or no `Bearer ` prefix | **not necessarily** — seen once against a good token, gone on retry |
| `Invalid API key format. Must start with sk_live_…` | the value has **leading** whitespace | yes — fix the value |
| `Invalid or revoked API token` | right shape (`apicep_`), token not recognised | yes — genuinely revoked |
| `API key not found` | right shape (`sk_live_`), not recognised | yes — wrong kind of credential |
| *(none — HTTP 400)* | **trailing** whitespace | no, apiCEP trims it |

Leading whitespace breaks it and trailing whitespace does not; a newline
inside the value produces a 500 rather than a 401. Anything reading these
must read the body, not the status. "Permanent" means unbounded in
time, not indestructible: deleting or revoking the token in the apiCEP
dashboard breaks the channel exactly as a wrong value would.

**There is no second key to obtain.** A 401 hint advertises
`Bearer sk_live_...` for "API keys", and this repo once carried that as an
architecture requirement — a spec decision, a provider note and a
Definition-of-Done item all waited on buying one. Nothing supports that: the
`sk_live_` prefix appears in apiCEP's error text, not in anything they offer
us. (It is not a dead copy-paste string either — apiCEP branches on the
prefix: a made-up `sk_live_…` answers `API key not found` while a made-up
`apicep_…` answers `Invalid or revoked API token`. Whether a customer can
obtain one is unknown, unmeasurable from outside, and moot.) apiCEP's own
reference agrees: it documents exactly one credential, sent one way.

### What broke on 2026-08-18, and why the probe exists

**A revoked token was stored in the GitHub environment secret.** Since every
deploy overwrites the worker secret from that environment (CICD D5), each
deploy reinstated it — the channel broke again on merges nobody connected to
it. The sync step only checks that the secret is non-empty, so a
wrong-but-present token shipped under a green tick.

The failure was silent all the way down: apiCEP answered **401**, Consta
mapped it to `PROVIDER_ERROR`, the api mapped that to retryable, and direct
payments sat in `validating` showing the customer *"Verificando tu pago"*
for the full six-hour schedule instead of failing loudly (BUG-002).

`deploy-dev` now probes the credential right after planting it (CICD D6),
which turns that silence into a red deploy.

For a while this file blamed expiry instead — "dies within the hour", four
observations. That was wrong, and it cost a debugging session that chased a
lifetime while a revoked token sat in the pipeline. Those four readings are
consistent with revoked tokens, not with expiry: rotation provably does not
invalidate an older token. **The lesson worth keeping: a 401 from this
provider means the value is wrong or revoked — never that it aged out.**

## Request

`POST https://api.apicep.cloud/validate-transfer` — the only endpoint. Any
other method answers **405** *(published, unverified)*.

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

| field | required | notes |
|---|---|---|
| `imageUrl` | when `sender` is absent | public HTTPS, ≤ 1 MB |
| `sender` | when `imageUrl` is absent | direct mode; `imageUrl` then unnecessary |
| `beneficiary` | when `potentialBeneficiaries` is absent | **exactly one** of `clabe` (18) / `phoneNumber` (10) / `cardNumber` (16), plus `bank`; `name` optional |
| `potentialBeneficiaries` | — | array of `{bank, clabe|phoneNumber|cardNumber}`; **OCR mode only**; no match → `status: "error"` *(published, unverified)* |
| `system` | no | `SPEI` or `SPID`, default `SPEI`. Consta hardcodes `SPEI`; SPID (dollar transfers) is unreachable today and nobody has asked. |

`sender` needs **at least one** of `trackingKey` or `referenceNumber`, plus
`date`, `amount` and `bank`. `referenceNumber` has an undocumented maximum
length — apiCEP 400s past it without publishing the number, and Consta's Zod
sets no bound.

- **The image travels by URL only** — no multipart, no base64 (docs, 2026-08-18).
- **apiCEP's fetcher reads short-lived signed URLs fine.** Verified against our own HMAC-signed R2 proxy (`GET /direct-payments/proofs/:linkId/:file`, 15-minute expiry). This was the open unknown before the receipt door ever ran.
- Accepted: **JPEG, PNG, PDF, GIF, WebP, BMP, TIFF, HEIC**, **1 MB max**. PDF matters — several Mexican banks issue the comprobante as one.
- `beneficiary` is required in OCR mode, and it is **not read from the image**: receipts mask the destination CLABE (Nu prints `••••8274`), so apiCEP matches the beneficiary the caller sends against Banxico's record. No OCR can recover it.
- The claimed `date` in direct mode is a **hint, not a filter**: a validation claiming `2026-08-15` returned a CEP dated `2026-08-17`. Compare the returned date yourself (direct-payment D11 does).
- **Sender and beneficiary bank may not be the same institution** — measured 2026-08-19: HTTP 400 in 432 ms with *"El banco emisor y el banco receptor no pueden ser la misma institución. Las transferencias SPEI y SPID deben realizarse entre instituciones distintas."* This is a coverage hole, not an error: a payer who banks where the ISP banks cannot be validated through apiCEP at all. Intra-bank transfers never produce a SPEI CEP, so the limit is Banxico's, not the provider's.

### `bank`: never rejected, and still decides the verdict

apiCEP publishes `bank` as a closed vocabulary of 97 names. **It does not enforce
it** — measured 2026-08-19 — and that is worse than enforcing it. The
vocabulary:

`ACTINVER` `AFIRME` `albo` `ARCUS FI` `ASP INTEGRA OPC` `AZTECA` `BaBien` `BAJIO` `BANAMEX` `BANCO COVALTO` `BANCOMEXT` `BANCOPPEL` `BANCO S3` `BANCREA` `BANJERCITO` `BANKAOOL` `BANK OF AMERICA` `BANK OF CHINA` `BANOBRAS` `BANORTE` `BANREGIO` `BANSI` `BANXICO` `BARCLAYS` `BBASE` `BBVA MEXICO` `BMONEX` `CAJA POP MEXICA` `CAJA TELEFONIST` `CASHI CUENTA` `CB INTERCAM` `CI BOLSA` `CITI MEXICO` `CLS` `CoDi Valida` `COMPARTAMOS` `CONSUBANCO` `COOPDESARROLLO` `CREDICAPITAL` `CREDICLUB` `CRISTOBAL COLON` `Cuenca` `Dep y Pag Dig` `DONDE` `FINAMEX` `FINCOMUN` `FINCO PAY` `FONDEADORA` `FONDO (FIRA)` `GBM` `HEY BANCO` `HIPOTECARIA FED` `HSBC` `ICBC` `INBURSA` `INDEVAL` `INMOBILIARIO` `INTERCAM BANCO` `INVEX` `JP MORGAN` `KAPITAL` `KLAR` `KUSPIT` `LIBERTAD` `MASARI` `Mercado Pago W` `MexPago` `MIFEL` `MIZUHO BANK` `MONEXCB` `MUFG` `MULTIVA BANCO` `NAFIN` `NUBANK` `NVIO` `PAGATODO` `Peibo` `PROFUTURO` `REVOLUT` `SABADELL` `SANTANDER` `SCOTIABANK` `SHINHAN` `SPIN BY OXXO` `STP` `TESORED` `TRANSFER` `UALA` `UBER PRO CARD` `UNAGRA` `VALMEX` `VALUE` `VECTOR` `VE POR MAS` `VOLKSWAGEN` `TRF` `CLIP`

The names are not the ones a customer would type: it is `NUBANK`, not "Nu";
`BBVA MEXICO`, not "BBVA"; `AZTECA`, not "Banco Azteca". Casing is inconsistent
(8 of the 97 are not fully uppercase: `albo`, `BaBien`, `CoDi Valida`, `Cuenca`, `Dep y Pag Dig`, `Mercado Pago W`, `MexPago`, `Peibo`).

**Measured against one real, settled transfer** (NUBANK → KLAR, $2.00,
2026-08-18, a CEP already confirmed `LIQUIDADO`), changing only `sender.bank`:

| `sender.bank` sent | HTTP | verdict | provider time |
|---|---|---|---|
| `NUBANK` (correct) | 200 | `valid`, `cepDetails.senderBank: NUBANK` | 7.0 s |
| `Nu` (off the vocabulary) | 200 | **`valid`** — resolved to NUBANK anyway | 5.9 s |
| `HSBC` (a different real bank) | 200 | **`invalid`, no `cepDetails`, no `cepStatus`** | 1.3 s |

Three things follow, and the third is the dangerous one:

1. **A name off the vocabulary is not a 400.** Free text is tolerated and
   aliased — `Nu` found the CEP. The published list is a courtesy, not a
   contract, so no status code will ever tell a caller its picker is wrong.
2. **`sender.bank` is load-bearing.** It is not a label travelling alongside
   the tracking key; it participates in resolving the CEP.
3. **Getting it wrong returns `invalid`.** Not an error, not a 400 — the same
   `invalid` with an absent `cepDetails` that a transfer which never happened
   returns. A payer who really paid is told their transfer could not be
   verified, and nothing on the wire says why.

The one tell is latency: the wrong bank came back in **1.3 s against 5.9–7.0 s**
for a real lookup. `X-Processing-Time` distinguishes "we asked Banxico" from
"we gave up early" for free.

So the vocabulary must be enforced **at our edge, to protect the verdict** —
not to anticipate a 400 that never comes. Any bank picker the payer sees has
to emit these literals.

## Response

### Body

```jsonc
{ "validationId": "…",
  "status": "valid" | "invalid" | "pending" | "error",
  "confidence": 0.97,                  // OCR score 0.0–1.0
  "extracted": {                       // what the picture said — see the warning below
    "senderBank", "receiverBank", "trackingKey", "referenceNumber",
    "amount", "date", "senderName", "beneficiaryName", "paymentConcept" },
  "validation": {
    "banxicoConfirmed": true,
    "cepStatus": "LIQUIDADO" | "EN PROCESO" | …,
    "cepPreviouslyValidated": true | false | null,
    "cepDetails": { "trackingKey", "amount", "operationDate", "senderBank",
                    "senderName", "receiverBank", "beneficiaryName",
                    "digitalSignature", … } },
  "downloads": { "cepXml": "https://storage.apicep.cloud/…",
                 "cepPdf": "…", "originalImage": "…" },   // expire after 15 days
  "processingTime": { "ocr": "1.20s", "validation": "3.45s", "total": "4.68s" } }
```

Everything above is confirmed live except **`downloads.originalImage`**, which
apiCEP documents and we have never seen returned.

**`confidence` is not the OCR quality signal it looks like.** It came back
`1` on every direct-mode call measured on 2026-08-19 — including ones with no
image at all and `processingTime.ocr: "0ms"`, and including a request apiCEP
rejected with a 400. Whatever it scores, it is not "how well I read your
receipt" in direct mode, and its behaviour in OCR mode is untested. It was
listed here as the field that would separate *illegible* from *nonexistent*;
that hope now needs a receipt-door measurement before anything is built on it.

`downloads` is `{}` — present but empty — on an `invalid` verdict, not absent.

The real `cepDetails` is far richer than the eight fields Consta maps: a
captured response also carried `speiKey`, `cdaChain`, `certificateNumber`,
both parties' account numbers and account types, both parties' **RFCs**,
`paymentConcept` and `iva`. Consta drops them deliberately — `cdaChain` alone
carries two RFCs and two full CLABEs, and none of it decides anything.

**`downloads.cepPdf` is not always present on the first call.** One validation
returned only `cepXml`; the same transfer returned both minutes later. The PDF
appears to be generated asynchronously, so a consumer must tolerate its
absence rather than treat it as a failure.

### Headers

apiCEP says these ride "every response". **They do not** — measured
2026-08-19:

| header | on `200` | on `400` | meaning |
|---|---|---|---|
| `X-RateLimit-Limit` | yes | **no** | requests per period — **800** on our plan |
| `X-RateLimit-Remaining` | yes | **no** | requests left — 767 at 2026-08-19 |
| `X-RateLimit-Reset` | yes | **no** | ISO 8601 reset — `2026-09-16T17:59:12.203+00:00` |
| `X-Processing-Time` | yes | sometimes | provider-side total, e.g. `2550ms` |

Consta reads none of them, so no log has ever shown one. The quota figures
above came from a `curl`, not from our own telemetry.

**Quota is not what the plan page implies.** 800 per period, resetting
monthly, with 767 left after roughly a month of spikes and a dozen probe
calls. Devolada's D7 re-validation schedule fires up to six calls per
unsettled payment; 800 is about 130 fully-retried payments a month. That
ceiling deserves a number in a spec before the channel carries volume.

`X-RateLimit-Remaining` is also the instrument that closes the credits
question open with apiCEP since 2026-08-17: read it either side of a pending
re-check and the answer costs one call.

### The field that decides money

**`cepDetails` is Banxico's record. `extracted` is what the image claimed.** Public guides tell integrators to compare `extracted.amount` against what is owed. **Do not.** `extracted` is attacker-controlled — it is a reading of a picture the payer supplied — and trusting it is exactly the `$1-receipt` hole that direct-payment D11 exists to close.

Proven, 2026-08-18: a comprobante was forged by changing one character of the clave de rastreo (`…CDB`**`F`**`MU…` → `…CDB`**`E`**`MU…`), leaving folio, reference, date, amount and banks untouched. apiCEP answered with **Banxico's real key** — the `F` — the true amount, and `cepStatus: LIQUIDADO`. The edit never reached the verdict. That is the whole security property: **the answer comes from the record, not the pixels.**

So: decide money on `cepDetails.amount` and `cepDetails.operationDate`, never on the receipt and never on `extracted`.

## HTTP 200 is not a valid payment

`status` is the verdict and it arrives inside a 200. Consta's mapping (`validation.spec.md` D3):

| provider | Consta | why |
|---|---|---|
| `status: "valid"` | `valid` | still necessary-not-sufficient — D11 re-checks amount and date |
| `status: "pending"`, or `invalid` with `cepStatus: "EN PROCESO"` | `pending` | a CEP can take up to ~30 min; "not published yet" must never read as "fake" |
| `status: "invalid"` | `invalid` | genuinely contradicts the claim |
| `status: "error"`, or HTTP 4xx/5xx | **not a verdict** → `PROVIDER_ERROR` (502) | nothing was validated; no `validations` row is written |

A garbage tracking key answers **HTTP 200 with `status: "invalid"`** (5 measured) — a made-up transfer is a verdict, not an error.

### The four faces of `status: "error"`

All arrive inside a 200 *(published; only the first has been seen here)*:

1. **The image could not be fetched** from `imageUrl`.
2. **The image is unreadable** — OCR confidence 0.
3. **The OCR read the image but missed a mandatory field**, and says which:
   ```jsonc
   { "status": "error",
     "error": "El OCR no pudo extraer los siguientes datos obligatorios…",
     "missingFields": ["fecha de la operación", "clave de rastreo o número de referencia"] }
   ```
4. **No `potentialBeneficiaries` candidate matched** the extracted data.

**This changes how our OCR false negative reads.** apiCEP *has* a channel for
"I could not read this" — case 3, with the field names spelled out — and our
false negative did not use it. That receipt came back `status: "invalid"`
with no `cepDetails`, meaning the OCR extracted enough to satisfy the
mandatory-field check, got a character wrong, and looked up a CEP that does
not exist. So the provider distinguishes *illegible* from *absent*, but not
*misread* from *absent*: a confident wrong reading is reported with the same
face as a transfer that never happened. That is the exact gap
`docs/direct-payment/proof-extraction.spec.md` is built to close, and it is
why `missingFields` is worth surfacing — it is the one OCR failure apiCEP
will name out loud.

**There is a third way to reach that same faceless `invalid`, and it is ours,
not theirs:** sending the wrong `sender.bank` produces `invalid` with no
`cepDetails` and no `cepStatus` (measured above). In OCR mode the sender bank
comes from apiCEP's own reading of the image, so a misread bank name lands
here too. Three distinct causes — receipt captured before the bank accepted
it, OCR misread, wrong sender bank — arrive at one indistinguishable
response. That is the whole case for reading the receipt ourselves
(`docs/direct-payment/proof-extraction.spec.md`).

### HTTP status codes, and what each one means for a retry

The retry decision is the whole point of this table. *(200, 400 and 401
measured live; 405, 422, 429 and **500** published, unverified — apiCEP has
never actually failed on us, so the one row we treat as retryable is the one
row we have never seen.)*

| code | apiCEP means | retryable? |
|---|---|---|
| `200` | processed — read `status` | per the verdict table above |
| `400` | malformed: bad `system`, missing fields, oversized/invalid image, same institution both sides, over-long `referenceNumber` | **never** — the request must change |
| `401` | token absent, wrong or revoked | **never by the caller** — an operator must fix the secret |
| `405` | not a POST | **never** — our bug |
| `422` | the reference number is duplicated in Banxico | **not as sent** — resend with `trackingKey` to disambiguate |
| `429` | plan quota exhausted | **yes, but only after `X-RateLimit-Reset`** — retrying before it deepens the outage |
| `500` | provider fault | **yes** |

Only `500` is genuinely transient. Consta collapses all seven into one
retryable `PROVIDER_ERROR`; see the gap list below.

**A 400 still bills a credit.** Measured twice on 2026-08-19: fire two valid
requests and `X-RateLimit-Remaining` falls by one each; slip a malformed one
between them and it falls by two. apiCEP charges for rejecting our own bad
request, which makes a retry loop on a permanently-malformed payload a paid
loop, not merely a slow one.

**And there are two different 400s.** One is a bare rejection, the other is a
full response envelope wearing a 400:

```jsonc
// request-shape 400 — no validationId, no headers
{ "error": "system must be either 'SPEI' or 'SPID'" }

// business-rule 400 — same envelope as a 200, with status "error"
{ "validationId": "07b2cefe-…", "status": "error", "confidence": 1,
  "extracted": { "senderBank": "KLAR", "receiverBank": "KLAR", … },
  "validation": { "banxicoConfirmed": false },
  "processingTime": { "ocr": "0ms", "total": "1.3s" } }
```

The same-institution rejection is the second kind. Consta throws on
`!res.ok` **before parsing the body**, so the `validationId` of a call it was
charged for is discarded unread.

## Measured behaviour

- **Latency 12.5–19 s** end to end per validation, receipt and transfer door alike. `X-Processing-Time` puts apiCEP's own share at **5.9–7.0 s** for a lookup that reaches Banxico and **1.3–2.6 s** for one that fails early, so most of the wall clock is not theirs. Their marketing says "less than 10 seconds"; it is not. Anything calling this synchronously must budget for ~15 s, and Consta's client carries a 30 s deadline for it (BUG-004: 38.5 s has been measured through the full chain).
- **The OCR produces false negatives, silently.** Of three real Nubank transfers, the receipt door read two and failed the third outright — `invalid` with **no `cepDetails` at all**, twice, deterministically. The same transfer validated through the **direct mode in 12.5 s** using the key read off the image by hand. On the wire, an unreadable receipt is indistinguishable from a transfer that never happened.
  - **Correction, 2026-08-19: "the CEP existed the whole time" was an assumption, not a measurement.** The direct-mode success happened *later in time* than both receipt-door refusals, so an unpublished CEP fits the same evidence as an OCR misread, and nothing distinguishes them after the fact. Treat this bullet as "the receipt door refused a real transfer twice" — which is certain — and not as proof of where the fault lay.
- **A CEP can be absent long after the money has arrived, with no `EN PROCESO` to say so.** Three real transfers now: two polled from authorisation on 2026-08-19 with the funds already delivered — one 12 times through **T+62 min**, one 18 times through **T+49 min** — and a third checked once at **T+49 min** against a control that validated in the same minute (see the control-probe note above), which is what turns "probably latency" into a measurement. All 30 samples returned `invalid` with no `cepDetails` and no `cepStatus` — the faceless shape, not a pending one. The second watcher's round trips settled at **1.1–3.8 s** after a 15 s first call, inside the 1.3–2.6 s band this page records for a lookup that fails early, so apiCEP was not reaching a record and waiting on it — there was nothing to reach. Banxico was answering on port 80 and refusing connections on 443 throughout, so whether this is normal latency or was an outage is **unmeasured**, and n=2 is not a distribution. What is safe to carry forward is only the negative: **there is no measured upper bound on CEP publication**, and the "~30 minutes" figure that circulated in our own specs was never measured by us. Consta D11 and direct-payment D17 are built on this.
- **`sender.amount` is a FILTER in direct mode, not a hint — measured 2026-08-19.** The claimed *date* is a hint (a request claiming `2026-08-15` returned a CEP dated `2026-08-17`), and the amount was assumed to behave the same. It does not. A clave that validated `LIQUIDADO` seconds earlier, re-sent with everything identical except `amount: 999999.00`, came back **`invalid` with no `cepDetails` and no `cepStatus`** in 916 ms — byte-identical to a transfer that never happened. **A wrong amount is therefore invisible**: it produces the same faceless answer as a wrong clave, a wrong bank and an unpublished CEP.
  - **The two doors differ, and this had never been written down.** On the receipt door the caller sends no amount at all — apiCEP reads it from the image — so a $1 receipt against a $514 debt comes back as a real CEP for $1 and the caller can refuse it (direct-payment D11, measured 2026-08-18). On the transfer door the caller's amount is a search criterion, so the same mistake returns nothing to refuse.
- **`extracted` is an echo of the request in direct mode, not a reading.** It comes back on faceless `invalid`s too — but probe C returned `"extracted": {"amount": 999999}`, which is what *we sent*. It carries information only in OCR mode. This closes an open question with the unhelpful answer: it cannot be used to tell why a direct-mode lookup failed.
- **A healthy pipeline can be proven in one window.** Sending a known-published clave alongside a failing one, seconds apart, separates "Banxico has not published it yet" from every other cause at once: credentials, bank vocabulary, beneficiary CLABE, request shape and the transcription method are all exonerated by the control coming back `valid`. Measured 2026-08-19: a transfer from the previous day returned `valid`/`LIQUIDADO` in 4.3 s while that day's, authorised 49 minutes earlier with the money already delivered, returned the faceless `invalid` in 2.0 s. **This is the cheapest diagnostic we have** and it costs one extra credit.
- **The direct mode has not missed one** (3 for 3). It is the reliable door; OCR is the convenient one (direct-payment D2).
- **An image with no receipt in it errors — it does not answer `invalid`.** A dark UI screenshot produced `PROVIDER_ERROR`, i.e. retryable, so a payment carrying it retries on the full schedule instead of failing once. This is published case 1 or 2 above; the response body that would say which was never captured.
- **`cepPreviouslyValidated` is per CEP and permanent.** Once a CEP is validated it stays flagged, so a receipt is effectively single-use for testing: a second submission cannot re-test the first outcome. Consta reports the flag and refuses to act on it (its D4); the replay policy is the integrator's (direct-payment D8).

## Environment, limits and cost

No sandbox, no test keys, no free credits (docs checked 2026-08-17). A **free Welcome plan** exists — 50 requests / 30 days on signup at `app.apicep.cloud` — enough for smoke checks. Dev therefore carries its own mock: `pnpm sandbox` in `apps/consta` serves `/validate-transfer` on port 8789, with scenarios keyed off the tracking key (`PEND`, `DUP`, `BAD`, `NF`, `ERR`). Pointing `APICEP_BASE_URL` at it is a one-line switch, which is what Consta's adapter boundary (its D2) buys.

Cost is roughly **$0.25 MXN per call**, which sets the budgets in direct-payment D13. apiCEP recommends **~1 s between calls** for bulk work; nothing here batches yet, but direct-payment D7's re-validation schedule is the first thing that could.

Document URLs (`cepXml`, `cepPdf`, `originalImage`) are **deleted after 15 days** — anything we need to keep must be copied, not linked.

## Where Consta does not yet honour this contract

Recorded here so the next reader does not mistake this file for a description
of the code. Detail and priority in the analysis that produced this update.

- **Every HTTP failure is one retryable code.** `apicep.ts` captures
  `res.status` into `ProviderError` and never reads it again; the route maps
  the lot to 502 `PROVIDER_ERROR`. 401, 422 and 429 each need different
  handling and get none (BUG-002).
- **An unrecognised `status` becomes `invalid`.** `mapStatus`'s fallback is
  the harshest verdict, so a value apiCEP adds tomorrow would read as "this
  transfer is fake" — against D3's entire premise.
- **The rate-limit headers are discarded**, so quota is invisible until a 429
  arrives, and the credits question stays open for want of reading one header.
- **`bank` is `z.string().min(1)`.** apiCEP will not reject a wrong name, it
  will answer `invalid` — so this is the one field where our Zod is the only
  thing standing between a real payment and a false negative.
- **The body of a non-2xx is never parsed**, so `missingFields`, the
  `validationId` of a billed 400, and the whole business-rule envelope are
  discarded unread.
- **`confidence`, `extracted` and `banxicoConfirmed` are not modelled** — the
  first two deliberately (`extracted` must never decide money), the third by
  omission.
- **The adapter's `fetch` carries no timeout**, so Consta can outlive its own
  caller's deadline.
- **The mock models none of this** — no 429, no 422, no `missingFields`, no
  headers, no envelope-shaped 400 — so nothing above is testable until it does.

## Open items

- **Read `X-RateLimit-Remaining` around a pending re-check** and close the credits question apiCEP has not answered since 2026-08-17. The instrument now exists; it needs one unsettled transfer to measure against. Until then direct-payment D7's cadence stays priced as if every re-check bills.
- **Decide what 800 calls a month buys.** That is the real ceiling, and D7's six-attempt schedule spends against it. Nothing in any spec names a budget.
- Capture a `status: "error"` body from the receipt door — one dark-screenshot reproduction would tell us whether we get `missingFields` or a bare confidence-0, and whether `confidence` means anything in OCR mode.
- Still unverified: **422** on a duplicated reference number, **429** and whether it carries `Retry-After`, **405**, and **500** — the provider has never failed on us, so the only condition Consta treats as retryable is one nobody here has observed. The 422 is cheap to provoke if a duplicate reference can be found; 429 costs 800 calls and will likely first be seen in production.
- `referenceNumber` has an undocumented maximum length; find it or bound it conservatively.
- `downloads.originalImage` is documented and has never appeared. Either it needs a flag we are not sending, or the docs are ahead of the service.

*Probe cost, 2026-08-19: ~12 calls (≈ $3 MXN), including two spent
deliberately to prove that a rejected request is billed.*
