# Contract: the landing's doors into the API

**Feature**: 008-landing-page · **Date**: 2026-09-19, amended 2026-09-20 (D22, D23: three fields, no sign-up)

The zod schema is the contract (constitution III). Everything below lands in
`apps/api/src/routes/landing/schema.ts`, exported as
`@devolada/api/landing-schema`, and is imported by the page at build (the
constants), by the admin (types), by MSW handlers and by Playwright stubs
(fixture validation). The module imports no server code.

---

## The constants the page stamps into its form (D7)

```ts
export const BILLING_SYSTEMS = ["wisphub", "own_software", "other", "none"] as const;
export const FORMS = ["hero", "full"] as const;               // which of the two forms sent it (D23)
export const FIELD_LIMITS = { name: 80 } as const;
export const WHATSAPP_PATTERN = /^\+?[0-9 ()-]{10,20}$/;
export const CHANNEL_PATTERN = /^[A-Za-z0-9_-]{1,32}$/;
```

Their es-MX labels live in the page and in the admin tab, keyed by these
values — the same arrangement the bank list and the role matrix use.

---

## `POST /landing/requests` — public, rate-limited (5 / hour / address)

Body, as JSON or as `application/x-www-form-urlencoded`:

```ts
export const accessRequestBody = z
  .object({
    whatsapp: z.string().trim().regex(WHATSAPP_PATTERN),                        // the one required answer (FR-015)
    name: z.string().trim().min(2).max(FIELD_LIMITS.name).or(z.literal("")).optional(),
    billingSystem: z.enum(BILLING_SYSTEMS).or(z.literal("")).optional(),
    form: z.enum(FORMS),                                                        // stamped by each form at build (D23)
    channel: z.string().regex(CHANNEL_PATTERN).optional(),                     // anything else → "direct" (D4)
    website: z.string().optional(),                                             // the honeypot: non-empty → REQUEST_REFUSED (D9)
  })
  .refine((b) => b.form === "full" || (!b.name && !b.billingSystem), { path: ["form"] }); // the hero form carries nothing but the WhatsApp
```

Two answers, chosen by the request's `Content-Type` (D6):

| Request | Received | Refused |
| --- | --- | --- |
| `application/json` | `200 { success: true, data: { id, receivedAt } }` | `400 { success: false, error: { code: "VALIDATION_ERROR" \| "REQUEST_REFUSED" } }` · `429 { …, code: "TOO_MANY_REQUESTS" }` |
| form-urlencoded | `303` → `${LANDING_BASE_URL}/gracias` | `303` → `${LANDING_BASE_URL}/no-enviada?motivo=<code>` |

`LANDING_BASE_URL` unset → the form-urlencoded request is answered exactly
as the JSON one (VIII). No `message`, no `retryable`: this is a
browser-facing route.

```ts
export const accessRequestReceived = z.object({ id: z.string(), receivedAt: z.number() });
```

Side effects: one row in `access_requests`; `landing_counts(sent)` for the
row's channel and day; one notice to `PLATFORM_OPERATOR_EMAILS` in
`waitUntil`, outcome written on the row (D10).

---

## `POST /landing/events` — public, rate-limited (60 / hour / address)

Body, form-urlencoded (sent with `fetch` + `keepalive`, `mode: "no-cors"`,
so no preflight and no dependency on `ALLOWED_ORIGINS`):

```ts
export const landingEventBody = z.object({
  step: z.enum(["visit", "began"]),   // `sent` is never accepted from the page
  channel: z.string().regex(CHANNEL_PATTERN).optional(),
});
```

Answer: `200 { success: true, data: { counted: true } }`. A refused or
malformed event answers the envelope with `VALIDATION_ERROR` /
`TOO_MANY_REQUESTS`; the page never reads it.

---

## `GET /platform/landing/requests?cursor=&limit=` — operator only

Behind `requireSession + requirePlatformOperator`, mounted by `platformRoute`.

```ts
export const accessRequestRow = z.object({
  id: z.string(),
  whatsapp: z.string(),
  name: z.string().nullable(),
  billingSystem: z.enum(BILLING_SYSTEMS).nullable(),
  form: z.enum(FORMS),
  repeated: z.boolean(),                    // another row carries the same WhatsApp (the "repetida" mark)
  channel: z.string(),
  createdAt: z.number(),
  notifiedAt: z.number().nullable(),
  notifyError: z.string().nullable(),
});
export const accessRequestList = z.object({
  items: z.array(accessRequestRow),        // newest first
  nextCursor: z.string().nullable(),       // opaque; `limit` ≤ 200, default 100
});
```

---

## `GET /platform/landing/counts?from=YYYY-MM-DD&to=YYYY-MM-DD` — operator only

Default: the last 30 days in `America/Mexico_City`, inclusive.

```ts
export const landingCountRow = z.object({
  day: z.string(),                          // YYYY-MM-DD
  channel: z.string(),
  step: z.enum(["visit", "began", "sent"]),
  count: z.number().int(),
});
export const landingCounts = z.object({ from: z.string(), to: z.string(), rows: z.array(landingCountRow) });
```

The admin computes the shares; the API returns rows.

---

## Error codes this area adds

| Code | Status | When |
| --- | --- | --- |
| `VALIDATION_ERROR` | 400 | the body fails the schema (the page names the field itself, D7) |
| `REQUEST_REFUSED` | 400 | the honeypot carried a value |
| `TOO_MANY_REQUESTS` | 429 | the address is past its window (existing code from the limiter) |
| `NOT_PLATFORM_OPERATOR` | 403 | an operator read without the right (existing) |

---

## The notice (email), for the intercepted test

`POST https://api.resend.com/emails` from `sendAccessRequestNotice`:
`from: EMAIL_FROM`, `to: PLATFORM_OPERATOR_EMAILS` (split on commas),
subject `Nuevo WhatsApp — <whatsapp>`, body with every field as typed, the
form and the channel. Tests intercept the origin with `fetchMock`,
exactly as `prepaid-credit.test.ts` does.
