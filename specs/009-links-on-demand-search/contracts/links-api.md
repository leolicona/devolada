# Contract: the Links doors

**Feature**: [spec.md](../spec.md) · **Decisions**: [research.md](../research.md)

All responses wear the project envelope (constitution III):
`{ success: true, data }` or `{ success: false, error: { code } }` with
`UPPER_SNAKE` codes. Schemas live in
`apps/api/src/routes/direct-payments/schema.ts` and are exported as
`@devolada/api/direct-payments-schema`; the admin takes its types from there,
and MSW handlers and Playwright stubs validate every fixture against them.

---

## `GET /direct-payments/customers` — added

The ISP's customers, with their link if one exists. Browsing and searching are
one door (D1).

**Auth**: session + `requireArea("payments", "read")`.

### Query

| Parameter | Rule |
| --- | --- |
| `q` | optional. Trimmed. When present it must be ≥ 3 characters, otherwise `VALIDATION_ERROR` (FR-002). A text of only spaces is an absent `q` (Edge Cases). |
| `limit` | optional, default 20, clamped to `10 ≤ limit ≤ 50` (D3). The client sends what fills its viewport. |
| `cursor` | optional, opaque (D2). Only meaningful when `q` is absent. An unreadable cursor is `VALIDATION_ERROR`. |

### Response

```
{
  results: CustomerRow[],          // data-model.md
  nextCursor: string | null,       // always null when q is present (D5)
  matched: number | null,          // search only: a floor, not a total (D5)
  total: number | null,            // browse only: the provider's count
  wisphub: "ok" | "unavailable" | "not_configured"
}
```

### Behaviour

- **Browse** (`q` absent): phase 1 walks the business's API links by keyset,
  phase 2 walks `/clientes/?limit=&offset=`. The cursor carries the phase (D2).
  `nextCursor` is null when the provider's list is exhausted. The order is the
  provider's own and is not promised (D6).
- **Search** (`q` present): four provider filters — `nombre__contains`,
  `apellido__contains`, `usuario__contains`, `telefono__contains` — in
  parallel, plus a D1 read of API links by reference and label. Merged, deduped
  by identity, capped at `limit` (D4). `matched` is the largest of the four
  provider counts; the page renders it as *"más de N coincidencias"* and asks
  for more characters (FR-006).
- **Test links never appear** (FR-017) — the `realOnly` predicate on the API side.
- **A customer without a usuario never appears** — nothing can be keyed to them.

### Provider outage is an answer, not a failure (D10, FR-014)

| Situation | Answer |
| --- | --- |
| Provider unreachable or past the operation budget | `200`, `wisphub: "unavailable"`, results = the business's API links only |
| Business has no WispHub key | `200`, `wisphub: "not_configured"`, same shape |
| Provider rejected the key (401/403) | `503` `WISPHUB_AUTH_FAILED` — a setup problem the ISP must fix, not an outage. **503, not 502**: `wisphubFailure(c, e, "panel")` already answers this way and `bug: links-refused-key` asserts it (`apps/api/test/direct-payments-links.test.ts`) |

`WISPHUB_READ_INCOMPLETE` retires with the roster: nothing is read whole, so
nothing can be cut short (FR-018).

---

## `POST /direct-payments/links` — added

Creates the customer's permanent link, or returns the one that exists. This is
the act FR-008 names.

**Auth**: session + `requireArea("payments", "operate")`, and the business must
have a CLABE configured (FR-016).

### Request

```
{ usuario: string }
```

### Response

```
{ token: string, url: string, waLink: string, created: boolean }
```

`created` is false when the link already existed — the same link is returned,
never a second one (FR-005, FR-009).

### Behaviour

- The handler reads the customer from the provider by **exact** `usuario=` to
  get the numeric id a panel link needs, and the phone the WhatsApp link needs.
  Identity is not a search, so no `__contains` filter is used here (D4, D8).
- Called from Links **and** from Cobros — one door, one rule (D14).

### Errors

| Code | When |
| --- | --- |
| `VALIDATION_ERROR` | empty or malformed usuario |
| `AUTHENTICATION_ERROR` | no session |
| `FORBIDDEN_FOR_ROLE` | the role cannot operate payments — the code `auth/middleware.ts` already returns, 403 |
| `SPEI_NOT_CONFIGURED` | no CLABE — a link nobody can pay is not shared (FR-016) |
| `WISPHUB_NOT_CONFIGURED` | no provider key; a panel link cannot be made without one |
| `CUSTOMER_NOT_FOUND` | the provider does not know that usuario. **A new code, deliberately**: the area's `NOT_FOUND` means "no such link or route", and the panel must tell that apart from "the provider has no such customer", which is an integration problem the operator can act on |
| `WISPHUB_UNAVAILABLE` | the provider did not answer — this door **does** fail, unlike the read door: a link created from a stale identity would be a link to the wrong person |
| `BUSINESS_SUSPENDED` | as everywhere else in the area |

---

## `GET /direct-payments/links` — removed

`listLinks`. The panel never called it; it read the roster and created a link
per customer on every read (D12).

## `GET /direct-payments/links/roster` — removed

`linksRoster` and `linksRosterResponse`. It is what this feature replaces
(D12). Consumers to update: `apps/admin/src/features/links/LinksScreen.tsx`,
`tests/e2e/stubs.ts`, `tests/design/review-foundations.spec.ts`,
`tests/design/review-feedback.spec.ts`.

Also removed: the stale stub for `/direct-payments/links/search` in
`tests/design/review-links.spec.ts` — that endpoint went in the pilot-UX round
and the stub outlived it.

---

## `GET /payment-requests` — changed in meaning, not in shape

`cobroRow.linkUrl` and `waLink` stay `string | null`. What null means changes:

| Before | After |
| --- | --- |
| null → hide Copiar and WhatsApp | null → show them; pressing one calls `POST /direct-payments/links` and proceeds with what it returns (FR-025, FR-026, D14) |

Nothing else about the door changes: the same rows, the same debt read, the
same `complete` and `readAt`, the same 5-page window. The batch lookup of
stored links stays — it saves a call for a debtor who already has one.

---

## The payer's doors — untouched

`GET|POST /direct-payments/links/:token` and its `/pay`, `/proof`, `/read`
children are the payer's path, resolved by token, public because the token is
the credential (`direct-payment D1`). This feature does not touch them.

One consequence reaches them all the same: a link the prune deleted resolves to
nothing, and the payer's page answers as it does for any unknown token
(FR-024, D13).
