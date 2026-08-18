---
status: in-development
stories: [US-V01, US-V02, US-V03, US-V04, US-V05]
domain: consta
updated: 2026-08-17
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

## Local sandbox

apiCEP offers no sandbox, test keys or free credits (docs checked
2026-08-17), so dev carries its own: `pnpm sandbox` starts a zero-dependency
mock of `/validate-transfer` on port 8789 (`sandbox/apicep-mock.mjs`), and
`APICEP_BASE_URL=http://localhost:8789` in `.dev.vars` points the adapter at
it — D2 is what makes this a one-line switch. Scenarios ride the tracking
key: `PEND` → pending, `DUP` → replay flag, `BAD` → invalid, `ERR` →
provider error; anything else validates. Remove the override to hit the real
provider.

## Provider notes (measured live, 2026-08-17)

The full measured contract — request shapes, response fields, auth, limits
and the traps — lives in `docs/integrations/apicep.md`. What follows are the
findings this spec's decisions rest on.

- **Two credential types.** apiCEP takes `Bearer sk_live_…` (API keys) or
  `Bearer apicep_…` (user tokens, what the dashboard issues).
  **Correction, 2026-08-18: user tokens are not short-lived.** This note
  previously said ours "died within the hour, twice"; they did not. Every
  dev deploy overwrites `APICEP_TOKEN` from the GitHub Actions environment
  secret (`deploy-dev.yml`), so a token set by hand lasts until the next
  merge — which on a busy day is about an hour, and reads exactly like
  expiry. Traced against the deploy log, and the provider's dashboard shows
  day-old tokens still `Activo`. The source of truth is the environment
  secret; `wrangler secret put` is a stopgap. Full contract and the
  ten-second diagnosis in `docs/integrations/apicep.md`.
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
    alreadyValidated: boolean,
    cep?: { trackingKey, amountCents, date, senderBank, senderName,
            receiverBank, beneficiaryName, digitalSignature? },
    downloads?: { cepXml?, cepPdf? }   // provider URLs, expire in 15 days
} }
```

- Missing/invalid/revoked key → 401 `AUTHENTICATION_ERROR`.
- Zod rejects → 400 `VALIDATION_ERROR`; both doors or neither → 400.
- Provider 4xx/5xx or `status: "error"` → 502 `PROVIDER_ERROR` (no
  `validations` row — nothing was validated).

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
7. Provider error → 502 `PROVIDER_ERROR`, no `validations` row (D6)

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
