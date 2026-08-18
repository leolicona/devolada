---
status: in-development
stories: [US-D08]
domain: direct-payment
updated: 2026-08-17
debt: [TD-015]
---

# Spec: Getting back to the payment page

The link de pago is permanent; the customer's grip on it is not. The
direct-payment spec answers "how does the customer pay" and leaves "how does
the customer find their page next month" to a bookmark (D1, "the ISP shares
the link once and the customer bookmarks it") — but the link arrives in
WhatsApp, so the bookmark is made inside an in-app browser whose storage
often does not survive the month, and it never survives a new phone. When it
is gone the only recovery is asking the ISP to send it again, which turns a
self-service channel back into a support ticket, one customer at a time.

This spec makes the return trip work without the ISP, in two phases: the
device remembers the link it was handed (phase 1, buildable today), and later
a passkey recovers it from any device the customer owns (phase 2, deferred
behind TD-015). Both hold the same line — nothing here lets a stranger turn a
guessable identifier into somebody else's bill.

## Decisions

- **D1 — The first arrival is always a link the ISP sent.** Nothing in this spec introduces a public lookup that turns a phone or a customer number into a payment link; every flow here begins with a customer who already holds a valid token, delivered by the admin screen (US-D07). **Rejected**: a public "escribe tu número de cliente" page. It reads like CFE's or Telmex's portal and would remove the ISP from the loop entirely, which is genuinely attractive — but it turns the opaque token into a public directory keyed on a guessable identifier, reversing direct-payment D1 in passing. The token is not only a view of the debt: it is the credential that spends the per-link validation budget (direct-payment D13), so anyone who can derive a stranger's link can burn the five submissions per hour the real customer needs, and bulk enumeration leaks which of an ISP's customers are delinquent while costing us paid provider calls.
- **D2 — Phase 1: the device remembers the link, and the API never hears about it.** The page stores the tokens it has been given in `localStorage` under `devolada-pago-links`, and the bare origin (`pago.devoladapago.com/`) sends a returning visitor to the stored link instead of the "enlace no válido" message it shows today. No endpoint, no cookie, no server state: the token was already on that device the moment the customer opened the link, so remembering it grants nothing that was not already granted. Opening a saved link is a `history.replaceState` and a re-render rather than a page load — the address bar still ends on `/p/<token>` so a reload or a bookmark keeps working, and `replace` rather than `push` because the doorway is not a place to go Back to. **Rejected**: a server-issued "remember me" cookie (the API would mint and verify a secret it has no need to know, and the client already holds the only one involved); doing nothing until phase 2 (it leaves the common case — same phone, next month — solved by nothing at all, and that case is most of the traffic).
- **D3 — More than one account on one phone gets a chooser, not a surprise.** A household can hold two services, and one phone is often the only phone. Each entry stores `{ token, name }` — the customer's name when the API knows it, the ISP's name for a link whose channel is not configured yet (that link is still worth coming back to). One entry goes straight through, several render a list to pick from, and every entry carries a "Este no es mi servicio" action that forgets it. **Rejected**: keeping only the newest token — the second person to open a link would silently displace the first, who would then land on a relative's bill from their own home screen and have no way to get back to their own.
- **D4 — Phase 2: a passkey recovers the link; it does not create a session.** The assertion's only output is the payment link's token; the page then navigates to `/p/<token>` and every request after that is exactly the session-less public call it is today. This is what keeps direct-payment D9 (`apps/pago` has no auth and no sessions) true rather than quietly repealed. **Rejected**: giving the customer a real session and a third actor type — beyond reversing D9, it would turn every handler's `actor.type !== "store"` guard from a habit into a rule that has to hold for a population it was never written against. **Rejected**: enrolling customers as Better Auth users — `user.email` is `NOT NULL UNIQUE` (`db/auth-schema.ts`) and WispHub frequently holds no email for a customer, so each one would need a synthesized address in the very table that holds real operator logins, where verification, OTP and password recovery mean nothing.
- **D5 — The credential binds to the payment link, not to a person.** A row in `payment_link_credentials` hangs off `payment_links`, so a passkey proves "this device is the one that was given this link" — precisely what the flow needs, and nothing more. It unlocks one customer page of one ISP; there is no account behind it to escalate into. **Rejected**: Better Auth's passkey plugin, which is the right tool for `user` rows (auth spec D7) and the wrong shape here — adopting it would drag the user table in through the back door that D4 just closed.
- **D6 — No identifier field: the authenticator says who it is.** Phase 2 uses discoverable credentials (resident keys), so the returning page shows a single "Entrar con Face ID" button and learns the customer's identity from the credential the device presents. **Rejected**: "escribe tu teléfono, luego Face ID" — it costs the customer a step, and it hands back the enumeration D1 just refused, because the server would have to answer differently for a phone it knows and one it does not before it could issue a challenge.
- **D7 — Phase 2 gets its own rpID, `pago.<env domain>`.** Auth D7 set `rpID = devoladapago.com` (prod) and `dev.devoladapago.com` (dev) for the operator surfaces. Customer credentials deliberately do **not** share it: with a narrower rpID a customer's passkey can never be offered on the admin or store login, and an operator's can never be offered on the payment page. Both hosts already sit under the certificate and the domain move is done, so this costs one variable. **Rejected**: reusing the operator rpID — usernameless credentials are scoped by rpID alone, so sharing it would let a browser offer a customer's key on the admin's login prompt, which is confusing at best.
- **D8 — Enrollment is offered only where it can survive.** The bootstrap link arrives in WhatsApp, so the enrollment button would be tapped inside WhatsApp's in-app browser, where a created credential may never reach the platform authenticator — a known Android WebView failure in particular. Where the page detects an in-app browser it replaces the button with "Abre esta página en tu navegador para guardar tu acceso" and the link to do it. **Rejected**: offering enrollment everywhere and letting it fail silently — the customer would believe they had saved their access and would find out otherwise a month later, standing in front of a suspended service.
- **D9 — The ISP-sent link never stops working.** A lost phone, a cleared browser, a relative paying on someone else's behalf, a device with no biometrics: in every one of these the recovery is the one that exists today — the ISP sends the link again from US-D07's screen. Neither phase replaces that path, and no screen may imply it did.
- **D10 — Phase 2 waits for evidence, not for enthusiasm** (TD-015). Phase 1 ships now because it is a few lines and covers the common case. Passkeys are a genuine improvement — they sync through iCloud Keychain and Google Password Manager, so they survive the new phone that defeats every bookmark — but they are an auth subsystem for an action taken twelve times a year, and we do not yet know how often customers actually lose access. **Rejected**: building both now.

## Contract

**Phase 1 adds no endpoint.** It is entirely inside `apps/pago`: the root route reads `localStorage` and redirects. This is worth stating because it is the reason the phase is cheap — the API surface, its Zod schemas and its tests are untouched.

**Phase 2** (when TD-015 is paid) adds four public routes under `/direct-payments/`. Sketched here so the decisions above are checkable; the shapes are settled when it is built:

```
POST /links/:token/passkey/options    → registration challenge; the token IS
                                        the proof of identity (D1, D4)
POST /links/:token/passkey            → stores the credential (D5)
POST /passkey/options                 → assertion challenge, no identifier (D6)
POST /passkey                         → verifies, answers { token } (D4)
```

- Challenges are single-use and short-lived, stored server-side. A stateless signed challenge (the trick `direct-payments/proofs.ts` uses for proof URLs) is **not** enough here: a challenge must not be replayable, and a signature alone cannot express "already spent".
- The per-link attempt budget (direct-payment D13) covers these routes too — a public endpoint that verifies signatures is a public endpoint.
- `POST /passkey` answering `{ token }` is the whole point of D4: the response is a link, not a session.

## Schema

Phase 1: none.

Phase 2, when it lands:

### New table: `payment_link_credentials`

| Column            | Type    | Notes                                             |
|-------------------|---------|---------------------------------------------------|
| `id`              | TEXT PK | UUID                                              |
| `payment_link_id` | TEXT FK | → `payment_links.id`, NOT NULL (D5)               |
| `credential_id`   | TEXT    | NOT NULL, UNIQUE — the authenticator's id         |
| `public_key`      | TEXT    | NOT NULL                                          |
| `counter`         | INTEGER | NOT NULL DEFAULT 0 — signature counter            |
| `transports`      | TEXT    | what the authenticator reported                   |
| `last_used_at`    | INTEGER | ms epoch                                          |
| `created_at`      | INTEGER | NOT NULL, ms epoch                                |

One link may carry several credentials (the customer's phone and their laptop). Deleting a link's credentials is how "olvidar este dispositivo" works from the customer's side.

## UI Contract

`apps/pago`, es-MX, "pago" not "cobro" (direct-payment D10), tokens only.

### Root route (`/`)

1. **Nothing stored** — "Aún no tienes un link de pago guardado en este dispositivo. Pídeselo a tu proveedor de internet." (Phase 2 adds the "Entrar con Face ID" button here.)
2. **One link stored** — straight to `/p/<token>`; the customer never sees this state.
3. **Several stored** (D3) — "¿De quién es el pago?" over a list of names, each with "Este no es mi servicio" to forget it. The forget buttons all read the same, so each carries the name in a visually hidden suffix: the accessible name stays distinguishable while still containing the visible text (WCAG 2.5.3).

### Payment page (`/p/<token>`)

4. **Saved quietly.** Arriving through a link stores it (D2); nothing is announced, because nothing was asked of the customer.
5. **Enrollment card** (phase 2) — offered below the payment instructions, never above them: paying is why they are here. In an in-app browser it becomes D8's "ábrelo en tu navegador" copy instead.

Statuses keep rendering through `StatusBadge`; no new status appears in this spec.

## Scenarios

1. Customer opens their link, closes the tab, later opens `pago.devoladapago.com` with no path → lands on their own payment page (US-D08, D2)
2. A device that has never held a link opens the bare origin → the "pide tu link" message, no redirect, no lookup field anywhere on the page (D1, D2)
3. Two customers open their links on one phone → the bare origin lists both by name; picking one opens that page (D3)
4. "Este no es mi servicio" on an entry removes it; with one entry left the bare origin redirects again (D3)
5. A stored token whose link the ISP later deleted → the page answers 404 as usual and the entry is dropped rather than shown forever; a 503 from the same lookup leaves it saved, because an outage is not a deleted account (D2)
6. Phase 2: enrollment from a valid link stores a credential against that `payment_link` and no `user` row is created (D4, D5)
7. Phase 2: "Entrar con Face ID" on the bare origin returns the token and opens the right customer's page, with no identifier typed (D4, D6)
8. Phase 2: an assertion for a credential of another ISP's customer opens that customer's page and nothing else — there is no account, no session, no admin surface reachable (D5)
9. Phase 2: in an in-app browser the enrollment button is replaced by the "ábrelo en tu navegador" copy (D8)
10. Phase 2: a replayed challenge is refused (Contract)

## Definition of Done

**Phase 1**

- [x] Scenarios 1–5 automated in `apps/pago/test/returning-access.test.tsx` (6 tests: scenario 5 is two — the deleted link and the outage that must not look like one)
- [x] Root route reads storage and opens the saved link; no API endpoint added, no Zod schema changed — `apps/pago/src/links.ts` plus the root state in `App.tsx`
- [x] The bare origin's empty state tells the customer how to get a link (D9), and the test asserts no text input of any kind exists on that screen — the absence of a lookup field is the decision, so it is tested rather than trusted
- [ ] Manual check on deployed dev: open a link, close the tab, return to `pago.dev.devoladapago.com`

**Phase 2** — blocked on TD-015; not part of this spec's first PR

- [ ] Scenarios 6–10 automated
- [ ] `payment_link_credentials` migration, with the D1 additive rule
- [ ] `PASSKEY_RP_ID` for `apps/pago` set to `pago.<env domain>` (D7), distinct from the operator rpID
- [ ] Manual check on a real Android phone in the WhatsApp in-app browser (D8 is a claim about that browser; it has to be seen)
