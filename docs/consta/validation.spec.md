---
status: in-development
stories: [US-V01, US-V02, US-V03, US-V04, US-V05, US-V06, US-V07, US-V08]
domain: consta
updated: 2026-08-26
debt: []
---

# Spec: Consta v1 — transfer validation API

Consta's first slice: one endpoint that answers "did this SPEI transfer really
happen?", backed by the Banxico CEP through a provider (apiCEP). Fixed fee per
transaction; the money never touches us — pure validation, no custody. Own
Worker + own D1 in this monorepo (SPEC.md, "Adjacent product": own product,
shared house). Scoping from the 2026-08-16/17 owner decisions and the CEP
spike.

## Decisions

- **D1 — One endpoint, two doors.** `POST /validate` accepts either the
  transfer's data (`transfer`: date, amount, banks, tracking key or reference
  number — US-V01) or a receipt image URL (`receiptUrl` — US-V02). Both doors
  return the same verdict shape, so integrators write one consumer. This maps
  1:1 onto apiCEP's Direct Mode and OCR mode. **Rejected**: separate endpoints
  per mode — two contracts to version for one answer.
- **D2 — The provider hides behind an adapter.** The handler talks to a
  `ValidationProvider` interface; `apicep.ts` is its only implementation
  today. Base URL and token come from env (`APICEP_BASE_URL`,
  `APICEP_TOKEN`), so tests intercept fetch and a future provider (or a
  direct Banxico adapter, spike F7) is a new file, not a rewrite.
- **D3 — Three verdicts: `valid` | `pending` | `invalid`.** The trap found in
  the spike: a CEP can take hours to exist, and a "not found yet" must never
  read as "the transfer is fake". Anything the provider reports as pending —
  its own `pending` status or `cepStatus: "EN PROCESO"` — maps to `pending`
  (retryable, US-V03). `invalid` is reserved for a CEP that genuinely
  contradicts the claim. Provider `error` statuses surface as our
  `PROVIDER_ERROR`, never as a verdict.
- **D4 — Replay is the integrator's flag, not our block.** The response
  carries `alreadyValidated` (from apiCEP's `cepPreviouslyValidated`;
  `null` → `false`). Consta doesn't reject replays: whether a reused proof is
  fraud depends on the integrator's domain (two charges can share one
  transfer legitimately). We report, they decide (US-V04).
- **D5 — API keys: manual, hashed, revocable.** Keys look like
  `ck_<32 hex>`; only their SHA-256 lands in the DB. The operator issues and
  revokes them through `/admin/keys`, guarded by a `CONSTA_ADMIN_TOKEN`
  worker secret — no self-serve signup, no dashboard in v1 (owner decision
  2026-08-17: customers are the owner's apps and known third parties). A
  revoked key 401s immediately.
- **D6 — The validations log is append-only; billing is derived.** Every call
  that reaches the provider writes one `validations` row (key, mode, verdict,
  tracking data, timestamps) and no row is ever updated or deleted — the
  same law as Devolada's ledger. The fixed fee per transaction is a SUM over
  this log, computed later; which verdicts are billable waits on apiCEP's
  answer about whether pending-invalids consume credits.
- **D7 — Money in integer cents at our edge.** `amountCents` in, converted to
  the provider's decimal pesos inside the adapter. Same invariant as
  Devolada; the boundary lives in one line of the adapter.
- **D8 — Same envelope, no CORS, dev only.** Responses use
  `{ success, data } | { success, error: { code } }`. v1 is server-to-server:
  no browser origin gets CORS. The Worker ships to `consta.dev.devoladapago.com`
  only; the prod env block and domain wait for the first external consumer.

### Honest failures (added 2026-08-19)

The 2026-08-19 probe of apiCEP (`docs/integrations/apicep.md`) found that
D1–D8 answer nine distinguishable provider situations with four outcomes, and
that the collapse falls on exactly the failures a customer feels. D9–D16 fix
that. The driving measurement: **Banxico publishes a CEP in at most ~30
minutes**, so any wait longer than that is not patience, it is a failure we
could not name.

- **D9 — A failure says whether waiting can help.** *(built 2026-08-25.)* The
  error envelope grows
  two fields the consumer cannot derive: `retryable: boolean` and, when it is
  knowable, `retryAfter` (ISO 8601). Five codes replace the single
  `PROVIDER_ERROR`:

  | code | provider condition | HTTP | `retryable` |
  |---|---|---|---|
  | `PROVIDER_UNAVAILABLE` | 500, network failure, our own deadline | 502 | `true` |
  | `PROVIDER_RATE_LIMITED` | 429 | 503 + `Retry-After` | `true`, with `retryAfter` from `X-RateLimit-Reset` |
  | `PROVIDER_AUTH_FAILED` | 401 saying the token is revoked, not found, or malformed | 502 | **`false`** — an operator must act |
  | `PROVIDER_UNAVAILABLE` | 401 saying `Missing or invalid Authorization header` | 502 | `true` — Consta always sends the header, so this is apiCEP's fault, and it cleared on retry when measured |
  | `REQUEST_REJECTED` | 400, 405, 422 | 422 | **`false`** — the request must change |
  | `RECEIPT_UNREADABLE` | 200 + `status: "error"` on the receipt door | 422 | **`false`**, carries `missingFields` |

  The 422 (a reference number duplicated in Banxico; published, unverified)
  additionally carries `hint: "provide_tracking_key"` — the one remedy apiCEP
  documents. This extends D11's hint pattern (`verify_inputs`) to the error
  envelope: the code says what happened, the hint says what to do, and the
  hint vocabulary is closed and documented here. Devolada cannot hit this
  row (its client requires the tracking key); an integrator searching by
  reference alone can. **Rejected**: a dedicated `REFERENCE_AMBIGUOUS` code —
  the category ("your request must change", not retryable, 422) is the same,
  only the remedy differs, and a remedy is what hints are for.

  A 200 whose `status: "error"` arrives on the **transfer** door has never
  been observed (the measured business-rule rejections wear a 400), so it is
  an unknown and follows D10: `PROVIDER_UNAVAILABLE`, retryable — never a
  rejection invented from a shape nobody has seen.

  **A 401 is not one thing**: apiCEP returns five distinct bodies under that
  one code (`docs/integrations/apicep.md`, Auth), and one of them cleared on a
  retry against a token that was never revoked. Branching on the status alone
  would call an outage a revocation, which is the mistake the first version of
  the deploy probe made. Consta is the only party that saw apiCEP's answer, so
  retryability is its knowledge to state, not the caller's to infer from an HTTP code. Today all
  seven apiCEP failure codes arrive as one retryable 502 and the consumer
  guesses — which is why a revoked token and a duplicate reference number both
  became six-hour silences. **Rejected**: letting callers branch on a `detail`
  string (unstable, untestable); a fourth verdict `unknown` (a failure is not a
  verdict — D3 stands).
- **D10 — An unrecognised provider status is never a verdict.** *(built
  2026-08-19.)* `mapStatus`
  maps only the exact string `"invalid"` to `invalid`; anything unrecognised
  becomes `PROVIDER_UNAVAILABLE`. The current fallback is `invalid` — the
  harshest reading available — so a status apiCEP adds tomorrow would tell a
  paying customer their transfer is fake. Fail toward "we do not know", never
  toward "you did not pay". **Rejected**: unknown → `pending` (an unknown is
  not a promise that waiting helps).
- **D11 — `invalid` says which kind, and admits when it cannot know.** *(built
  2026-08-19; BUG-003.)* The
  verdict carries `reason`: `contradicted` when a CEP came back and disagrees
  with the claim, `not_found` when apiCEP returned no `cepDetails` and no
  `cepStatus`. `not_found` is documented as **ambiguous by construction** — it
  covers a transfer that never happened, a misread tracking key, and a wrong
  sender bank, and nothing on the wire separates them — so it also carries
  `hint: "verify_inputs"`. This is the difference between telling a customer
  *"tu transferencia no existe"* and *"revisa tu clave de rastreo y tu banco"*.
  **Rejected**: inferring the cause from `providerMs` — the wrong-bank case
  came back in 1.3 s against 5.9–7.0 s for a real lookup, but n=3 is not a
  verdict; the field is recorded under D14 so the question can be settled with
  data.

### The contract hardened by review (added 2026-08-25)

A case-by-case walk of every answer Consta can give (the 12-case synthesis
of 2026-08-25) found three places where the contract knew less than the code
did. All three are additive.

- **D17 — The same institution on both sides is refused at the edge.**
  An intra-bank transfer never produces a SPEI CEP — the limit is Banxico's —
  and apiCEP charges a credit for rejecting the request (measured 2026-08-19,
  the envelope-shaped 400). A cross-field Zod refine now answers an instant
  `VALIDATION_ERROR` naming the real reason, which the provider's rejection
  never states in a stable form. Same argument as D12: our edge is the only
  thing standing between a caller and a paid, unnamed failure. **Accepted
  limit**: the OCR door cannot be pre-checked (the sender bank comes from
  apiCEP's own reading of the image), so that path can still reach the
  provider's billed 400 → `REQUEST_REJECTED`.
- **D18 — `contradicted` says which way, when Banxico said it.** The verdict
  now carries `cepStatus` (`"DEVUELTO"`, …) whenever the contradiction came
  with one, so a caller can tell its customer *"tu banco devolvió la
  transferencia"* instead of a generic mismatch. It is Banxico's word about
  the payer's own transfer — nothing foreign leaks. `not_found` never
  carries it: there is no word of Banxico's to relay, and inventing one
  would undo D11.
- **D19 — `retryable` is envelope law.** D9 gave provider failures a
  `retryable` field; every other error (`VALIDATION_ERROR`,
  `AUTHENTICATION_ERROR`, `NOT_FOUND`, `INTERNAL_SERVER_ERROR`) now carries
  it too. The rule a consumer programs is one line — retryable → wait and
  resend the same thing; not retryable → stop and change something — and a
  code Consta adds tomorrow is handled correctly by consumers that never
  heard of it. This is D9's own premise applied to ourselves: retryability
  is the server's knowledge to state, never the caller's to infer from a
  code table it must keep in sync. Every future endpoint carries the field;
  this paragraph is the law that makes forgetting it a spec violation.

### Refusing what cannot possibly validate (added 2026-08-19)

- **D12 — The bank vocabulary is enforced here, because the provider does not.**
  `sender.bank` and `beneficiary.bank` become a closed `z.enum` of apiCEP's 97
  published names, and `GET /banks` publishes the list so an integrator's
  picker is generated rather than transcribed (US-V07). Measured 2026-08-19
  against one real settled transfer, changing only `sender.bank`: `NUBANK`
  → `valid`; `Nu` → `valid` (aliased); **`HSBC` → `invalid` with no
  `cepDetails`.** apiCEP never answers 400 for a bank name — a wrong one comes
  back as the same faceless `invalid` a nonexistent transfer returns. Our Zod
  is therefore the only thing standing between a real payment and a silent
  false rejection. **The cost is accepted knowingly**: the enum will reject
  some free-text names apiCEP would have aliased, because that tolerance is
  undocumented, unmeasured beyond one case, and fails silently when it fails.
  An instant 400 listing the accepted values beats a coin flip.
  **Rejected**: passing bank names through and trusting the provider (measured
  to produce a silent false negative); warning instead of rejecting (a wrong
  bank cannot produce a correct verdict, so there is nothing to warn about).
- **D13 — A tracking key is shape-checked before it is spent.** `trackingKey`
  must match `^[A-Za-z0-9]{6,30}$`; `referenceNumber` digits within a bounded
  length. Banxico's clave de rastreo is alphanumeric and at most 30
  characters, and the range matters more than the number: apiCEP's own example
  carries a 10-character key (`HSBC712057`) while Nu's is 28, so a fixed
  length would be wrong for a product serving every bank. What the check
  actually catches is the real failure — whitespace, pasted newlines and
  line-wrap artifacts from receipts that print the key across two lines. Today
  `min(1)` sends `"NU3AGI FAMA9D"` to the provider, spends a credit and gets
  `invalid`. **Rejected**: a fixed 28 characters — correct for Nu and wrong
  here; that belongs in Devolada's own schema (BUG-006), not in the schema of
  a product that validates every Mexican bank.

### Seeing the cost before it bites (added 2026-08-19)

- **D14 — Every call records what it cost, how long it took, and what is left.**
  *(built 2026-08-25.)*
  Three columns on `validations`: `providerHttpStatus`, `providerMs` (from
  `X-Processing-Time`) and `quotaRemaining` (from `X-RateLimit-Remaining`).
  Measured: those headers ride 200s only, and the plan is **800 calls per
  period** — about 130 fully-retried payments a month against Devolada's
  six-attempt schedule. Today quota is invisible until a 429 arrives, and the
  "do pending re-checks bill?" question has been open with apiCEP since
  2026-08-17 for want of reading one header. **Rejected**: an external metrics
  sink — the append-only log is already the billing record (D6), and one place
  is enough.
- **D15 — The log records billed calls, not successful ones.** *(built
  2026-08-25.)* Measured
  2026-08-19: **apiCEP charges a credit for a request it rejects with 400.**
  Two valid calls drop `X-RateLimit-Remaining` by one each; slip a malformed
  one between them and it drops by two. D6's "billing is a SUM over this
  table" was therefore false for every failed call, and our own cost was
  invisible — which is how a revoked token burned quota unnoticed for a day. A
  `validations` row is now written whenever a request reached apiCEP and a
  response came back, non-2xx included, with `status` nullable and the
  provider's HTTP status recorded; verdict-bearing rows stay selectable with
  `status IS NOT NULL`. Whether 401, 422 and 429 also bill is unmeasured, and
  the row is what will tell us. **Rejected**: a second `provider_errors` table
  (two logs to reconcile for one invoice); leaving D6 alone (it hides what we
  are charged).
- **D16 — Consta owns a deadline, strictly under its caller's.** *(built
  2026-08-25.)* The adapter's
  `fetch` gets `AbortSignal.timeout`, set below the api's `CONSTA_TIMEOUT_MS`.
  Before this the adapter had none, so the caller timed out first, treated it
  as retryable and called again — while Consta's original call completed,
  wrote a row, billed a credit invisibly and set apiCEP's
  `cepPreviouslyValidated`. The number is **25 s**: under the caller's 30 s,
  above the ~19 s measured worst case for a healthy validation
  (`docs/integrations/apicep.md`). Overridable via `APICEP_DEADLINE_MS` only
  so tests can make a mock hang without waiting 25 s. A deadline or network
  failure got no response, so it writes **no** `validations` row — the one
  failure D15 cannot price is the one it must not invent a row for.
  That is precisely what told an honest payment `TRANSFER_ALREADY_USED` on
  2026-08-18 (direct-payment D8's carve-out). Whoever times out first must be
  the party able to report it. **Rejected**: no deadline (a Worker's own limit
  is not a contract); a deadline above the caller's (leaves the
  invisible-billing path open).

## The failure taxonomy, and what it does to the wait

Eleven distinguishable situations. Five are permanent, and **all five still
ride Devolada's full six-hour schedule** because Consta cannot name them
until D9 lands.

| what really happened | resolves by waiting? | who can fix it | Consta today | with D9–D16 |
|---|---|---|---|---|
| CEP not published yet, and apiCEP says so (`EN PROCESO`) | yes, bound unknown | nobody | `pending` ✓ | unchanged |
| CEP not published yet, and apiCEP says **nothing** | yes, bound unknown | nobody | `invalid`, terminal (BUG-003) | `invalid` + `not_found` (D11, built) |
| the transfer does not exist | no | the customer — pay | `invalid` ✓ | `invalid` + `not_found` |
| the tracking key was misread or mistyped | **never** | the customer — retype | `invalid` (reads as "never paid") | `invalid` + `not_found` + `verify_inputs` |
| the sender bank is wrong | **never** | the customer — fix the bank | `invalid` (reads as "never paid") | refused at the edge (D12) |
| the receipt is illegible / not a receipt | **never** | the customer — upload again | `PROVIDER_ERROR` → **6 h** | `RECEIPT_UNREADABLE`, not retryable |
| the token is revoked | **never** | the operator | `PROVIDER_ERROR` → **6 h** | `PROVIDER_AUTH_FAILED`, not retryable |
| quota is exhausted (429) | yes, at reset | the operator | `PROVIDER_ERROR` → **6 h** | `PROVIDER_RATE_LIMITED` + `retryAfter` |
| the reference number is duplicated (422) | not as sent | the caller — add a tracking key | `PROVIDER_ERROR` → **6 h** | `REQUEST_REJECTED`, not retryable |
| sender and beneficiary bank at one institution | **never** | nobody — no SPEI CEP exists | `PROVIDER_ERROR` → **6 h** | `REQUEST_REJECTED`, not retryable |
| apiCEP is down (500) | yes, minutes | nobody | `PROVIDER_ERROR` ✓ | `PROVIDER_UNAVAILABLE` |

**The six-hour wait is not this spec's to shorten, but it is this spec's
fault.** Devolada's schedule runs +2, +8, +20, +45 min, +2 h, +6 h from
submission, and everything after +45 min exists only because the code cannot
tell "still waiting for Banxico" from "permanently broken". Once Consta states
`retryable: false`, four of those five permanent failures end on the **first**
attempt with a message the customer can act on, and the fifth alerts the
operator instead of the customer. Shortening the pending budget itself and
consuming `retryable` belong to
`docs/direct-payment/direct-payment.spec.md` D7 — named here as the hand-off,
not silently adopted.

**Correction, 2026-08-19: "Banxico publishes within ~30 minutes" was wrong,
and it was written here the same day it was disproved.** Two real transfers
were watched from authorisation, with the money already delivered to the
receiving account: one polled 12 times through **T+62 min** and one 18 times
through **T+49 min**, and neither had a CEP at any of those 30 samples — no `EN PROCESO`, no record at
all, just the faceless `invalid` this taxonomy's second row now names. Banxico
itself was reachable on port 80 and refusing connections on 443 throughout, so
whether that latency is normal or was an outage is **unmeasured**; n=2 is not
a distribution either way. What follows for the design is not a new number but
the absence of one: **no attempt schedule may assume an upper bound on CEP
publication**, and shortening the pending budget must wait for data rather
than inherit a figure nobody measured. This is exactly why `not_found` rides
the schedule instead of ending it (D11) — the premise that made terminating
look safe does not hold.

## Local sandbox

apiCEP offers no sandbox, test keys or free credits (docs checked
2026-08-17), so dev carries its own: `pnpm sandbox` starts a zero-dependency
mock of `/validate-transfer` on port 8789 (`sandbox/apicep-mock.mjs`), and
`APICEP_BASE_URL=http://localhost:8789` in `.dev.vars` points the adapter at
it — D2 is what makes this a one-line switch. Scenarios ride the tracking
key: `PEND` → pending, `DUP` → replay flag, `BAD` → invalid contradicted,
`NF` → invalid not_found, `ERR` → 503, `E500` → 500, `R429` → 429 with
`X-RateLimit-Reset`, `A401` → fatal 401, `A401T` → apiCEP's transient 401,
`B400` → bare 400, `E400` → envelope-shaped 400 with a `validationId`,
`D422` → duplicated reference, `UNK` → unrecognised status, `HANG` → never
answers (D16); anything else validates with the measured 200 headers
(rate-limit trio + `X-Processing-Time`). An `imageUrl` containing
`unreadable` answers `status: "error"` with `missingFields`. Remove the
override to hit the real provider.

*(The paragraph that stood here — "the mock has to grow before D9–D16 are
testable" — was the to-do list for the scenario table above; the 2026-08-25
build closed it. A decision that cannot be provoked locally is a decision
nobody can regression-test, so every taxonomy scenario names the mock key
that serves its shape.)*

## Provider notes (measured live, 2026-08-17)

The full measured contract — request shapes, response fields, auth, limits
and the traps — lives in `docs/integrations/apicep.md`. What follows are the
findings this spec's decisions rest on.

- **The `apicep_…` token is the right credential and it is permanent.** It
  does not expire and rotation does not end one; the only way it dies is
  being revoked. `APICEP_TOKEN` needs no replacement — the `sk_live_` key
  this note once said it "must become" traces to a 401 hint, not to
  anything apiCEP offers us. The 2026-08-18 outage was a **revoked** token
  stored in the GitHub environment secret and reinstated by every deploy;
  the post-deploy probe (CICD D6) now catches that class of failure.
  Details and measurements in `docs/integrations/apicep.md`.
- **A free Welcome plan exists** (50 requests / 30 days on signup at
  app.apicep.cloud) — enough for smoke checks without paying.
- **Date tolerance.** The real validation claimed `2026-08-15`; the CEP came
  back `valid` with `operationDate: 2026-08-17`. apiCEP found the CEP despite
  the date mismatch, so the claimed date is apparently a hint, not a filter —
  integrators must compare the returned `cep.date` themselves if the date
  matters to their domain.
- **Garbage tracking keys answer HTTP 200 with `status: invalid`** (5
  measured) — a made-up transfer is a verdict, not an error.
- No pre-registration of beneficiary accounts exists; the beneficiary travels
  inline in every request (docs confirmed).
- **The receipt door works on real receipts** (measured 2026-08-18, the first
  time OCR mode ran against the real provider — scenario 4 had only ever been
  fetch-mocked). Two Nubank comprobantes (PNG, ~515 kB, 1125×4449) went through
  the whole chain on dev. apiCEP fetched the image from Devolada's own
  HMAC-signed URL without complaint — that fetcher reaching a short-lived
  signed URL was the open unknown — and read every field the domain needs: the
  amount to the cent, the sender bank (`NUBANK`), the operation date, and the
  28-character clave de rastreo **exactly**, including across the two-line wrap
  Nu's layout puts in the middle of it (`NU3AGIFAMA9D9CNQV487MGAVDE2C`,
  compared against the receipt by hand).
- **OCR latency: 13.5–14.6 s** for `/validate` (upload ~1.2 s on top). Their
  marketing says "less than 10 seconds"; it is not, but it fits a Worker's
  budget. Anything calling this synchronously must expect ~15 s.
- **Images can only be reached by URL** — no multipart, no base64 (docs
  2026-08-18). Accepted: JPEG, PNG, PDF, GIF, WebP, BMP, TIFF, HEIC, 1 MB max.
- **The OCR fails on real receipts, and it fails silently** (measured
  2026-08-18, second round). A genuine, unspent Nubank comprobante — same
  bank, same layout, same 1125×4449 export as the two the OCR read
  perfectly — came back `invalid` with **no `cepDetails` at all**: no
  tracking key, no amount, no `cepStatus`. Twice, deterministically. The
  same transfer then **`valid` through the transfer door in 12.5 s**,
  using the tracking key read off the image by hand. So the CEP existed
  and was liquidated the whole time; the OCR simply could not read that
  file. **One false negative in three real receipts.** A customer who
  really paid is told their transfer could not be verified — the failure
  is indistinguishable, on the wire, from a transfer that never happened.
  The transfer door has not produced a false negative yet (3 for 3).
- **Editing a receipt does not work, because the verdict is not in the
  image.** A comprobante was forged by changing one character of the
  clave de rastreo (`…CDB`**`F`**`MU…` → `…CDB`**`E`**`MU…`), leaving the
  folio, reference, date, amount and banks untouched. apiCEP answered
  with **Banxico's real key** — the `F` — plus the true amount and
  `cepStatus: LIQUIDADO`. It resolves the CEP from the record, not from
  the pixels, and returns what Banxico holds. Integrators should read the
  returned `cep` as the truth and ignore what the receipt claims; ours
  does (direct-payment D11).
- **An unreadable image is an error, not a verdict.** A screenshot with
  no receipt in it (a dark UI fragment) does not come back
  `invalid` — apiCEP *errors*, which maps to `PROVIDER_ERROR` per D3 and
  writes no `validations` row. Integrators that treat provider errors as
  retryable will retry an image that can never be read; see the open
  question in direct-payment's DoD.
- **The beneficiary never comes from the image.** Nu prints the destination
  CLABE masked (`••••8274`), so apiCEP matches the `beneficiary` the caller
  sends against Banxico's CEP record, not against the receipt. No amount of
  OCR — ours or anyone's — can recover a full beneficiary CLABE from these
  screenshots.

## Contract

`POST /validate` — `Authorization: Bearer ck_…`

Request (exactly one door):

```
{ transfer: { date: "YYYY-MM-DD", amountCents, senderBank, trackingKey? | referenceNumber?,
              beneficiary: { bank, clabe? | phoneNumber? | cardNumber?, name? } } }
{ receiptUrl: "https://…", beneficiary?: {…}, potentialBeneficiaries?: [{…}] }
```

Response:

```
{ success: true, data: {
    validationId, status: "valid" | "pending" | "invalid",
    reason?: "contradicted" | "not_found",   // on invalid only (D11)
    hint?: "verify_inputs",                  // on not_found only (D11)
    alreadyValidated: boolean,
    cep?: { trackingKey, amountCents, date, senderBank, senderName,
            receiverBank, beneficiaryName, digitalSignature? },
    reading?: { trackingKey?, amountCents?, date?, senderBank?,
                referenceNumber? },    // receipt door only: what the provider's
                                       // OCR read off the image — a READING,
                                       // never a verdict (proof-extraction D11,
                                       // 2026-08-26); money comes from `cep`
    missingFields?: ["clave de rastreo"],  // receipt door: fields the provider
                                           // says it could not read (D11)
    downloads?: { cepXml?, cepPdf? }   // provider URLs, expire in 15 days
} }
```

Failures (D9) — `retryable` is the field consumers branch on, never the HTTP
code:

```
{ success: false, error: {
    code: "PROVIDER_UNAVAILABLE" | "PROVIDER_RATE_LIMITED"
        | "PROVIDER_AUTH_FAILED" | "REQUEST_REJECTED" | "RECEIPT_UNREADABLE"
        | "AUTHENTICATION_ERROR" | "VALIDATION_ERROR",
    retryable: boolean,
    retryAfter?: "2026-09-16T17:59:12.203+00:00",   // rate limiting only
    missingFields?: ["fecha de la operación"],      // RECEIPT_UNREADABLE only
} }
```

- Missing/invalid/revoked key → 401 `AUTHENTICATION_ERROR`, `retryable: false`.
- Zod rejects → 400 `VALIDATION_ERROR`, `retryable: false`; both doors or
  neither → 400. A bank name off the vocabulary (D12) or a malformed tracking
  key (D13) is refused here, before a credit is spent.
- Provider failures map per the D9 table. Every call that reached apiCEP
  leaves a `validations` row, verdict or not (D15).

`GET /banks` — `Authorization: Bearer ck_…` → `{ success: true, data: { banks:
[…97 names…] } }`. The vocabulary apiCEP accepts, served so a payer-facing
picker is generated from one source (D12, US-V07).

`POST /admin/keys` `{ name }` → `{ id, name, key }` (plaintext shown once).
`DELETE /admin/keys/:id` → revokes. Both take
`Authorization: Bearer <CONSTA_ADMIN_TOKEN>`; without the secret configured,
the routes 404.

## Scenarios

1. Direct-mode validation of a settled transfer → `valid`, CEP data mapped,
   one `validations` row under the calling key (US-V01, US-V05)
2. Provider says invalid but the CEP is `EN PROCESO` → our `pending`, not
   `invalid` (US-V03, D3)
3. A previously validated CEP → `alreadyValidated: true`, still `valid` (US-V04, D4)
4. Receipt door: `receiptUrl` reaches the provider as OCR mode with the same
   verdict mapping (US-V02, D1)
5. Bad key and revoked key → 401; no provider call, no log row (D5)
6. Admin issues a key (plaintext once, hash stored) and revokes it; wrong
   admin token → 401 (US-V05, D5)
7. Provider error → 502 with `retryable: true`, and the billed call **is**
   logged with `status: null` (D6 as amended by D9/D15 — this scenario
   originally answered `PROVIDER_ERROR` and logged nothing)

### The failure taxonomy — one case per row of the D9 table (added 2026-08-19)

Each names the provider response the mock must serve. Together they are the
regression suite for "no permanent failure ever becomes a long silence".

8. apiCEP **500** → `PROVIDER_UNAVAILABLE`, `retryable: true`, no
   `retryAfter`, HTTP 502 (US-V06, D9)
9. apiCEP **429** with `X-RateLimit-Reset` → `PROVIDER_RATE_LIMITED`,
   `retryable: true`, `retryAfter` echoing the header verbatim, HTTP 503 with
   a `Retry-After` header (US-V06, D9)
10. apiCEP **401** → `PROVIDER_AUTH_FAILED`, **`retryable: false`** — the
    failure that cost six hours on 2026-08-18, and the one a caller must never
    retry (US-V06, D9)
11. apiCEP **bare 400** (`{"error":"system must be either 'SPEI' or 'SPID'"}`)
    → `REQUEST_REJECTED`, `retryable: false`, HTTP 422 (US-V06, D9)
12. apiCEP **envelope 400** (same institution both sides: a 400 whose body is
    a full response with `validationId` and `status: "error"`) → the same
    `REQUEST_REJECTED`, and the provider's `validationId` is recorded even
    though the call failed (US-V06, D9, D15)
13. apiCEP **200 with `status: "error"` and `missingFields`** on the receipt
    door → `RECEIPT_UNREADABLE`, `retryable: false`, `missingFields` passed
    through verbatim so the caller can tell the customer which field to fix
    (US-V06, D9)
14. apiCEP **200 with an unrecognised `status`** → `PROVIDER_UNAVAILABLE`,
    retryable — and **never `invalid`**. The regression that guards D10's
    whole point (US-V06, D10)
15. The provider **hangs past Consta's deadline** → `PROVIDER_UNAVAILABLE`
    reported by Consta, not by a caller timing out first (US-V06, D16)

### Refused at the edge, before a credit is spent (added 2026-08-19)

16. `senderBank: "Nu"` → 400 `VALIDATION_ERROR` listing the accepted names,
    **no provider call and no `validations` row**. The measured silent false
    negative, converted into an instant fixable error (US-V07, D12)
17. `beneficiary.bank` off the vocabulary → the same refusal on the other side
    of the request (US-V07, D12)
18. `GET /banks` returns the 97 names to a valid key and 401s without one
    (US-V07, D12)
19. `trackingKey` carrying a space or a newline — the line-wrap artifact a
    two-line receipt produces — → 400 `VALIDATION_ERROR`, no provider call
    (US-V07, D13)
20. `trackingKey: "HSBC712057"` (10 characters) is **accepted**: the check is a
    range and a character class, not Nu's 28 (US-V07, D13)

### What every call records (added 2026-08-19)

21. A `valid` verdict stores `providerHttpStatus`, `providerMs` from
    `X-Processing-Time` and `quotaRemaining` from `X-RateLimit-Remaining`
    (US-V08, D14)
22. A provider **400** writes a `validations` row with `status: null` and its
    HTTP status — the billed-but-failed call D6 used to lose (US-V08, D15)
23. A response with **no rate-limit headers** (measured: apiCEP omits them on
    every 400) leaves `quotaRemaining` null without failing the request
    (US-V08, D14)

### The verdict says which kind (added 2026-08-19)

24. `invalid` with `cepStatus: "DEVUELTO"` → `reason: "contradicted"`, no hint
    (US-V06, D11)
25. `invalid` with no `cepDetails` and no `cepStatus` → `reason: "not_found"`
    plus `hint: "verify_inputs"` — the response that must never be rendered to
    a customer as "your transfer does not exist" (US-V06, D11)

### Hardened by the 2026-08-25 review

26. `senderBank` equal to `beneficiary.bank` → 400 `VALIDATION_ERROR` naming
    the intra-bank reason, **no provider call and no `validations` row** —
    the billed, unnamed 400 converted into a free, named refusal (US-V07, D17)
27. `contradicted` with `cepStatus: "DEVUELTO"` carries `cepStatus` in the
    response; `not_found` never does (US-V06, D18)
28. Every error envelope carries `retryable` — asserted on
    `VALIDATION_ERROR` and `AUTHENTICATION_ERROR`, the two that D9 did not
    cover (US-V06, D19)

## Definition of Done

- [x] Scenarios automated in `apps/consta/test/` (workerd + local D1 +
      fetch-mocked provider), citing their stories (9 tests, PR #46)
- [x] Deployed to `consta.dev.devoladapago.com` by Actions with
      `APICEP_TOKEN` and `CONSTA_ADMIN_TOKEN` as worker secrets (PR #47
      deploy; both probed live: 401 without credentials, not 404)
- [x] Manual check on deployed dev: one real validation against apiCEP with a
      real transfer's data — 2026-08-17, a real SPEI (NUBANK → KLAR, $3,198.00)
      came back `valid` with Banxico's digital signature and the CEP XML/PDF
      links, and left exactly one `valid` row in the dev D1 (US-V01, US-V05)

### D12–D13 (built 2026-08-19)

- [x] The 97-name vocabulary lives in one constant, generated from
      `docs/integrations/apicep.md` so the two cannot drift, and `GET /banks`
      serves it (D12)
- [x] `senderBank` and `beneficiary.bank` are a closed enum; a refusal carries
      the vocabulary so no second round trip is needed (D12)
- [x] `trackingKey` is `^[A-Za-z0-9]{6,30}$` after trimming, `referenceNumber`
      digits — the edges trimmed, the middle enforced (D13)
- [x] Scenarios 16–20 automated (`test/validate.test.ts`, `test/banks.test.ts`)
- [x] **BUG-007 cleared before deploy.** Devolada's payer and the ISP's settings
      both typed their bank as free text, into fields whose placeholders
      offered names the vocabulary does not contain. Both now pick from the
      list (direct-payment D16), so Devolada no longer sends a name that would
      become a retryable 400. The underlying asymmetry remains until D9:
      `apps/api/src/consta/client.ts` still reads every non-2xx as retryable,
      so another integrator's 400 would ride a schedule it can never escape.

### D10–D11 (built 2026-08-19)

- [x] `mapVerdict` replaces `mapStatus`: `invalid` carries `reason`
      (`contradicted` | `not_found`), `not_found` carries `hint:
      "verify_inputs"`, and an unrecognised provider status raises a provider
      failure instead of falling through to `invalid` (D10, D11)
- [x] `validations.reason` records which kind, so "how often is `not_found` a
      real payment we could not see?" becomes a query rather than an opinion
      (migration `0001`)
- [x] Scenarios 24, 25 and 14 automated (`test/validate.test.ts`), and the
      local mock serves the `not_found` shape (`NF` in the tracking key)
- [x] **BUG-003 cleared on the consumer side in the same PR.** Consta naming
      the two halves is only half the fix: `apps/api` now rides its schedule
      on `not_found` and terminates only on `contradicted` (direct-payment
      D17). A verdict nobody consumes changes nothing.
- [x] Scenario 14 now answers D9's `PROVIDER_UNAVAILABLE`, `retryable: true`
      (closed by the D9 build, 2026-08-25)

### D9, D14–D16 (built 2026-08-25)

Built mock-first, deliberately: the 405/422/429/500 shapes stay
published-unverified (`docs/integrations/apicep.md`, open items), so the
adapter codes defensively against them and the live probes stay parked —
provoking a 429 costs the plan's remaining quota, and a 422 needs a
duplicated reference nobody can manufacture on demand.

- [x] Scenarios 8–13, 15 and 21–23 automated, each citing its story
      (`test/validate.test.ts`, "The failure taxonomy")
- [x] `sandbox/apicep-mock.mjs` serves every response shape those scenarios
      need — rate-limit headers, `X-Processing-Time`, both 400 shapes, 401
      (fatal and transient), 429, `status: "error"` with `missingFields`, an
      unrecognised status, a 422 with the hint, and a hang past the deadline
- [x] Migration for `validations` (`0003`): `status` nullable, plus
      `provider_http_status`, `provider_ms`, `quota_remaining` (D14, D15)
- [x] `docs/integrations/apicep.md` gap list updated: the contract is now
      honoured except where noted there (nothing new was measured — no live
      calls were spent on this build)
- [ ] **Hand-off recorded, not assumed**: `direct-payment.spec.md` D7 consumes
      `retryable` and re-argues its pending budget against Banxico's ~30
      minutes. Consta shipping D9 does not shorten anyone's wait by itself —
      it only makes shortening it possible. *(Deliberately left to the
      consumer's own PR: that spec is being edited in a parallel worktree,
      and two features touching one spec serialize — CICD.md rule 3.)*

### D17–D19 (built 2026-08-25)

- [x] Cross-field refine on the transfer door; scenario 26 automated (D17)
- [x] `cepStatus` rides `contradicted` and never `not_found`; scenario 27
      automated (D18)
- [x] `retryable` on every error envelope — validate, extract, auth
      middleware, admin keys, `onError`; scenario 28 automated (D19)

## Open items

- **A learned `retryAfter` on `not_found`/`pending` (discussed 2026-08-25,
  not committed).** Consta is the only party that can measure Banxico's real
  publication delay: its append-only log links a transfer's retries by
  tracking key, so `first valid − first not_found`, per bank pair, is a SQL
  query over data D14 already records — and every future integrator widens
  the dataset. The bounded version: infer the timing and **suggest** it by
  extending D9's existing `retryAfter` field to `not_found`/`pending`
  responses ("asking again before this is spending in vain"). Consta never
  schedules, never promises, and omits the field when a bank pair lacks
  samples; the caller's static schedule (direct-payment D7) remains the
  floor. Three gates before building anything: (1) the offline query must
  show per-cell signal on real volume — today the log holds a handful of
  rows; (2) the "do pending re-checks bill?" question must be answered
  first (`quota_remaining` is the instrument, one unsettled transfer the
  cost), because free re-checks change what timing precision is worth;
  (3) consumer copy discipline: a suggestion must never render as a
  promised confirmation time — no upper bound on publication has ever been
  measured. **Rejected now**: Consta scheduling retries itself with
  webhooks (a stateful scheduler is another product's worth of complexity
  for little gain while integrators own a cron).
