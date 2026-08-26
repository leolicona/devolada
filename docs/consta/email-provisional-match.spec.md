---
status: proposed
stories: [US-V12, US-V13, US-V14]
domain: consta
updated: 2026-08-26
debt: []
---

# Spec: bank-email provisional match

A second source of evidence for the window Banxico leaves dark. Measured
reality (validation.spec.md, correction of 2026-08-19): two real transfers
had **no CEP at T+49 and T+62 minutes** with the money already delivered —
and during that window apiCEP answers `invalid` + `not_found`, not
`pending`. Meanwhile the beneficiary's own bank emails "Transferencia
recibida" within seconds of settlement. This feature intercepts that email,
matches it against the claimed transfer, and reports the match as
**evidence riding next to the verdict — never as the verdict**. The
integrator (Devolada first) decides whether that evidence is enough to
grant service while Banxico catches up.

Scoped 2026-08-26 with the owner (grill session). This spec covers the
Consta half only; the Devolada half (settings toggles, provisional
reconnection, feed alerts) is a recorded hand-off, not built here.

## Decisions

- **D1 — A parallel field, never a fourth verdict.** The `/validate`
  response keeps its three verdicts (validation.spec.md D3 stands). When a
  stored bank email matches, the response gains a parallel object:

  ```
  provisionalMatch?: {
    matchedAt,                       // ISO 8601
    source: "bank_email",
    strength: "strong",              // v1 has only strong (D4)
    matchedOn: "tracking_key" | "reference_number",
    emailId, fromDomain,
    dkimVerified: true               // always true — D3 gates on it
  }
  ```

  It rides `pending` and `invalid` + `not_found` — the two answers the
  dark window actually produces. It never rides `valid` (Banxico already
  answered; nothing is provisional) and never `contradicted` (Banxico
  disagreed; an email does not outrank a CEP). A consumer that never heard
  of this feature sees plain `pending`/`not_found` and behaves correctly —
  the same additive philosophy as D19. **Rejected**: a `provisional_match`
  status in the enum (breaks D3, forces every consumer to re-version, and
  erases what Banxico actually said — during the real window it would have
  to replace *two* different verdicts).

- **D2 — Intake is auto-forward → Cloudflare Email Routing → Email Worker.**
  The bank notifies the ISP owner's own mailbox; that destination cannot be
  changed. The owner sets a one-time auto-forward rule (Gmail and Outlook
  both have it) toward a secret per-mailbox address
  `in-<token>@devoladapago.com`. Email Routing on the zone delivers those
  addresses to a Consta Email Worker — same stack, no new provider, no
  HTTP webhook hop, the Worker gets the raw MIME. Known gotcha, owned by
  onboarding: Gmail confirms a new forwarding destination with a code sent
  *to* that destination, so the integrator must be able to read the first
  emails that arrive (D6 gives the endpoint). **Rejected**: Gmail API +
  Pub/Sub (OAuth custody of the ISP's whole mailbox, a Google Cloud
  project outside the stack, watch renewals, Gmail-only); Apps Script (a
  script each ISP installs and maintains, Gmail-only, no central control —
  fine as a measuring spike, not as the product); Resend inbound (one more
  provider and a fee for what Email Routing does free); IMAP polling
  (custody of mailbox passwords).

- **D3 — Four locks before an email may match.** Anything short of all
  four is stored as evidence (D7) but can never produce a
  `provisionalMatch`:

  1. it arrived at a valid, unrevoked secret address;
  2. its `From` domain is on a **closed list of bank sender domains**
     (same pattern as the 97-bank vocabulary, validation D12);
  3. the **originating bank's DKIM signature verifies** — auto-forward
     breaks SPF but usually carries the original DKIM intact, and the
     Email Worker checks it (DNS-over-HTTPS for the public key,
     WebCrypto for the verify);
  4. the original recipient (`To`/`Delivered-To` of the forwarded
     message) equals the **registered source mailbox** of that address
     (D6).

  A forged approval therefore requires knowing a secret address *and*
  forging a bank's cryptographic signature. The provisional is already
  "not definitive" by design, but granting service on a spoofable email
  would be a known hole, not a residual risk. **Rejected**: domain list
  alone (a `From` is forged in one SMTP line); the secret address alone
  (it travels in every forwarded header and can leak).

- **D4 — Strong match only.** An email matches a validation when its
  tracking key equals the claimed `trackingKey`, or its bank reference
  equals the claimed `referenceNumber` — exact, after the same trimming
  as validation D13. Amount-plus-date matching is **refused by design**:
  customers of one ISP pay the same monthly fee to the same CLABE on the
  same day — partial-payment already documents that collision pool — so
  amount alone collides by construction. **Measured 2026-08-26,
  Klar, n=1** (a real $50.00 BBVA → Klar transfer): the "Recibiste una
  transferencia" email carries **both** keys — the clave de rastreo
  (`MBAN…`, 24 chars, inside D13's 6–30 range) and Klar's own
  `Referencia` — plus amount, sender bank, account tail and timestamp.
  From `contacto@klar.mx`; the `d=klar.mx` DKIM signature (selector
  `s1`, rsa-sha256) **verified cryptographically** against live DNS
  (dkimpy, offline spike). BBVA's receive notification is still
  unmeasured, and so is DKIM survival through a real Gmail
  auto-forward — the spike in the DoD settles both before the parser
  is built. **Rejected for v1, recorded as open**: a `weak` strength
  for amount-unique-in-window matches.

- **D5 — The match is computed at `/validate` time; no outbound webhook.**
  The Email Worker only verifies and stores. When the integrator
  (re-)validates, Consta checks the stored emails of the key's addresses
  and attaches `provisionalMatch` if one qualifies. This covers both
  orders for free: the bank usually emails *before* the customer finishes
  uploading their receipt, so the common case shows the provisional on
  **attempt #1**; when the email arrives later, Devolada's existing
  schedule (+2, +8 min…) picks it up within minutes — and the consumer
  can densify its own early slots if minutes matter. Consta stays free of
  a stateful delivery subsystem, consistent with rejecting a retry
  scheduler (validation Open items). **Rejected for v1, recorded as
  open**: signed outbound webhooks per key (real immediacy, at the cost
  of the subsystem — build it when data shows the minutes hurt).

- **D6 — Addresses are per source mailbox, created by the integrator.**
  One Consta key serves many ISPs (Devolada's case), each with its own
  bank and mailbox. The key creates as many addresses as it needs:
  `POST /inbound-addresses { label, sourceMailbox }` → the secret
  address; list and revoke likewise. `GET /inbound-addresses/:id/emails`
  returns recent inbound metadata — this is also how the Gmail
  forwarding-confirmation code reaches the ISP during onboarding.
  `/validate` gains an optional `inboundAddressId` to scope matching;
  without it the match runs across all the key's addresses, which is safe
  under D4 (a SPEI tracking key is unique per transfer — a cross-ISP
  false positive would need two ISPs claiming the same real transfer,
  which is the replay case D4/direct-payment D8 already own). **Rejected**:
  one address per key (a leak burns every ISP at once, and lock (d) needs
  the per-mailbox registry anyway); one Consta key per ISP (multiplies
  secret management in apps/api and changes every existing call path).

- **D7 — Store the reading and a 15-day raw window.** Parsed fields,
  `rawSha256`, sender, subject and the lock results land in an
  **append-only** `inbound_emails` table (same law as `validations`).
  The raw MIME goes to a private R2 bucket with a **15-day lifecycle** —
  the same horizon proofs already use (direct-payment D12). This bends
  extractions D8 ("the reading, never the artifact") knowingly and
  narrowly: a bank-email parser will fail on formats nobody has seen, and
  without the raw there is no way to learn why; 15 days is a debugging
  window, not an archive of other people's mail. **Rejected**: raw
  forever in D1 (Consta becomes a permanent mailbox of third-party
  banking mail); no raw at all (the first format change blinds the
  feature entirely).

- **D8 — The reader is the AI binding Consta already has.** The Email
  Worker parses with the same Workers AI model as proof-extraction
  (`EXTRACTION_MODEL` var), recording `rawOutput` like `extractions`
  does. A per-bank regex fast path can come later, measured against the
  spike's sample set — the model is the general reader, the regex is an
  optimisation. **Rejected**: regex-first (one layout change per bank
  breaks it silently; that fragility is why the AI reader exists).

## What the Devolada half will do (hand-off, not built here)

Recorded so the consumer's spec starts from decisions already made with
the owner, not from scratch — same pattern as validation D9's hand-off:

- `/settings` gains **"Reconexión con aprobación provisional"**: a policy
  toggle (on → a `provisionalMatch` triggers the same reconnection queue
  as a confirmed payment, flagged provisional until Banxico confirms) and
  a **manual grant button** in the feed for case-by-case approval while
  the toggle is off.
- When Banxico later says `contradicted` — or the payment expires
  unconfirmed — the default is a **feed alert** ("aprobación provisional
  revertida / sin confirmar — resolver con el cliente", the `unapplied`
  pattern) with manual action; a second settings option enables automatic
  re-suspension for ISPs that want the autopilot. Cutting internet
  automatically on a provider mismatch is the BUG-003 harm again, so it
  is opt-in, never default.
- The onboarding card shows the secret address, the registered mailbox,
  and surfaces the Gmail confirmation code via D6's endpoint.

## Contract

`POST /validate` — unchanged request plus optional `inboundAddressId`;
response may carry `provisionalMatch` per D1.

`POST /inbound-addresses` `{ label, sourceMailbox }` →
`{ id, address, label, sourceMailbox }`
`GET /inbound-addresses` → the list, with per-address counts
`DELETE /inbound-addresses/:id` → revokes (mail to it is dropped and
logged, never matched)
`GET /inbound-addresses/:id/emails?limit` → recent inbound metadata
(from, subject, receivedAt, locks passed, parsed fields) — the onboarding
window and the debugging window

All under `Authorization: Bearer ck_…`; errors carry `retryable`
(validation D19 is envelope law).

## Schema (new tables, own migration)

- `inbound_addresses`: id, apiKeyId → api_keys, label, sourceMailbox,
  localToken (unique), createdAt, revokedAt
- `inbound_emails` (append-only): id, inboundAddressId, fromDomain,
  dkimVerified, originalRecipient, subject, rawSha256, r2Key (15-day
  lifecycle), parsed trackingKey / referenceNumber / amountCents /
  transferDate / senderName, rawOutput, locksPassed, receivedAt
- `validations` gains nullable `provisional_email_id` — a match is
  recorded on the validation row it rode out on (the table is
  append-only; each call already writes its own row)

## Scenarios

1. A qualifying email arrives, then `/validate` claims its tracking key →
   verdict `invalid`+`not_found` **with** `provisionalMatch`
   (`matchedOn: "tracking_key"`), and the validation row records the
   email id (US-V13, D1, D5)
2. Same, but the claim comes first and the email second → the *next*
   `/validate` of the same claim carries the match (US-V13, D5)
3. The CEP finally publishes → `valid` with **no** `provisionalMatch`
   (US-V13, D1)
4. Banxico contradicts (`DEVUELTO`) → `contradicted` with **no**
   `provisionalMatch` — the email never outranks the CEP (US-V13, D1)
5. An email from a domain off the closed list → stored, `locksPassed`
   says which lock failed, never matches (US-V12, D3)
6. An email whose bank DKIM does not verify → stored, never matches
   (US-V12, D3)
7. An email whose original recipient is not the address's registered
   `sourceMailbox` → stored, never matches (US-V12, D3)
8. Amount and date equal but tracking key absent/different → **no
   match** — the collision pool stays closed (US-V13, D4)
9. Integrator creates an address, lists it, reads its recent emails
   (the Gmail confirmation code path), revokes it; mail to a revoked
   address is dropped and logged (US-V14, D6)
10. `/validate` with `inboundAddressId` matches only that address's
    emails; without it, any of the key's addresses (US-V14, D6)
11. Raw MIME lands in R2 under the 15-day lifecycle; the D1 row keeps
    the sha and survives the raw's expiry (US-V12, D7)

## Definition of Done

- [ ] **Spike first, blocking**: 3–5 real "Transferencia recibida"
      emails **per bank, from BBVA (the pilot ISP's bank) and Klar (the
      owner's own account — the NUBANK → KLAR transfer already measured
      in validation.spec.md landed there)**, measured for: does the body
      carry the clave de rastreo? a bank reference? does each bank's
      DKIM survive a Gmail auto-forward intact? Two banks from day one
      keeps the parser honest — one layout cannot pass as "the" format.
      The parser and D4's `matchedOn` set are designed from that
      evidence, per bank, and this spec is updated with what was
      measured. **Progress 2026-08-26**: Klar measured (n=1) — both
      keys present, `d=klar.mx` DKIM verified against live DNS; see D4.
      Still owed: more Klar samples, BBVA's receive notification (the
      pilot's bank — a Klar → BBVA transfer produces one), and the
      auto-forwarded copy (Gmail's *automatic* forwarding, not the
      Reenviar button — a manual forward rewrites the message and
      proves nothing about lock (c))
- [ ] Email Routing verified on the `devoladapago.com` zone: catch-all
      (or address rules) delivering `in-*` to the Consta Email Worker
- [ ] Scenarios automated in `apps/consta/test/` citing their stories;
      the local sandbox grows a way to inject a raw email so every lock
      is provokable offline
- [ ] Migration for the two tables + the `validations` column
- [ ] Deployed to dev; one real end-to-end: a real transfer to a
      measured account (the pilot's BBVA, or Klar as the rehearsal), the
      real forwarded email, `provisionalMatch` on a live `/validate`
      before the CEP exists
- [ ] Hand-off recorded: the Devolada half starts its own spec/worktree
      from the section above (CICD rule 3 — it touches settings and
      direct-payment specs being edited in parallel today)

## Open items

- **Weak matches** (amount unique in window, `strength: "weak"`) — only
  if the spike shows BBVA emails carry no usable key, and then behind
  its own decision here.
- **Outbound webhooks per key** — v2 immediacy, only when data shows the
  poll-time minutes hurt (D5).
- **Per-bank regex fast path** over the AI reader, measured against the
  spike's sample set (D8).
- **More bank domains** — the closed list starts with BBVA (the pilot)
  and Klar (the rehearsal account); each new bank adds its domains and
  a sample-email measurement.
