# Contract: the link summary

**Feature**: `specs/008-payer-doorway` | **Date**: 2026-09-18

One new route. The doorway calls it once per saved link, in parallel (D1).

## `GET /direct-payments/links/:token/summary`

Public, like every payer-facing route in this area: **the link is the
credential**. No session, no header, no identification (FR-008).

### Why it exists rather than reusing the page's read

`GET /direct-payments/links/:token` answers the same question and carries the
CLABE, the bank, the beneficiary, the reference and the invoice list. A list
screen that cannot build a transfer must not be handed the means to build one
(FR-007, FR-010). This route is that answer projected down to what a row needs
and nothing else (D2).

Both are produced by **one resolver** (D3). The summary is a projection of the
page's answer, never a second computation of it — that is what makes SC-002 hold
by construction.

### Response — `success`

The project envelope, `{ success: true, data }`:

```jsonc
{
  "success": true,
  "data": {
    "businessName": "Internet del Valle",   // always
    "name": "Ana Ruiz",                     // who the payment is for; falls back to businessName
    "status": "debt",                       // debt | no_debt | unavailable | closed
    "closedReason": "paid",                 // closed only: paid | expired
    "totalCents": 51900                     // debt only: what the page will ask to transfer (D7)
  }
}
```

| Field | Present when | Notes |
| --- | --- | --- |
| `businessName` | always | FR-002 — the row must name its business, or two rows read alike |
| `name` | always | the payer-facing name; the business's name when the channel has no better one, exactly as the page falls back today |
| `status` | always | the same four the payment page already returns — no new success state |
| `closedReason` | `status = "closed"` | the device drops the row either way (FR-013); the reason is carried so the drop can be logged honestly in tests |
| `totalCents` | `status = "debt"` | integer cents (constitution II). Debt **plus the service fee** — the number the page puts under "total a transferir" |

**Never carried**: `speiClabe`, `speiBank`, `speiBeneficiaryName`, `reference`,
`concept`, `cobros`, `invoiceCents`, `carriedBalanceCents`, `serviceFeeCents`.
Each of those is either a means to build a transfer or a breakdown of one, and
neither belongs on a list. This is the enforceable half of FR-010 — a test
asserts the absence, not just the presence.

### Response — `failure`

| Condition | Status | Code |
| --- | --- | --- |
| No link with this token, ever | 404 | `NOT_FOUND` |
| The business is suspended | 200 | `status: "unavailable"` |
| The provider cannot be reached | 503 | `WISPHUB_UNAVAILABLE` |

**FR-011 is the rule on the first row**: a token that was never real, one that
was deleted, and one belonging to someone else all answer the same 404 with the
same code and no timing tell. Nothing in the answer may reveal whether an
address ever existed.

The 503 is what the device turns into `unknown` (D10). Note the asymmetry and
keep it: a suspended business is a *known* state the payer should read in words,
while an unreachable provider is an absence of knowledge. The device drops a
row on 404 and keeps it on 503 — that difference is the whole of FR-013 against
"a bad connection must never erase the way back".

### What the route must not do

- **Never read the tenant roster.** Resolving one payer's link must not pull a
  whole business's customer list into a colo cache on a payer's request (D4).
  `rosterForDisplay` is the panel's, and this route may not call it.
- **Never widen with a list parameter.** One request, one link. A `?tokens=`
  variant would undo D1's progressive rendering and make the tenant-isolation
  reading (constitution V) hard to defend at a glance.

## Where the shape lives

`apps/api/src/routes/direct-payments/schema.ts`, exported through the existing
`@devolada/api/direct-payments-schema` — no new package export is needed.

It is imported by `apps/pago` for its types, by the pago MSW handlers, and by
the Playwright stubs to validate every fixture (constitution III).

## What does not change

`GET /direct-payments/links/:token` keeps its shape exactly. The payment page is
untouched by this feature except where it saves the business name alongside the
payer's name (data-model §1).
