import { z } from "zod";

/* The landing page's contract (landing-page spec; constitution III) —
   exported as `@devolada/api/landing-schema` and imported by the page at
   build, by the admin's Landing tab, by the MSW handlers and by the
   Playwright stubs. Pure zod: nothing here imports the database, the auth
   layer, Hono or Drizzle, because the page's build and the admin's bundle
   both load this file.

   landing-page D7: the constants the schema is built from are exported
   beside it, so the two forms stamp `required`, `pattern`, `maxlength` and
   their `<option>`s from the same source the API decides with, and no
   validator ships to the browser. */

/* landing-page D23: which system runs the reader's billing — the one
   answer that decides which door the conversation opens. The es-MX labels
   live in the page and in the admin, keyed by these values, the way the
   bank list and the role matrix are labelled. */
export const BILLING_SYSTEMS = ["wisphub", "own_software", "other", "none"] as const;
/* landing-page D23: which of the two forms sent it — the one-field form in
   the first screen, or the three-field closing form. */
export const FORMS = ["hero", "full"] as const;
/* landing-page D8: the three steps the page counts. `sent` is written by
   the API alone, when it stores a request. */
export const STEPS = ["visit", "began", "sent"] as const;
export const FIELD_LIMITS = { name: 80 } as const;
/* Ten to twenty characters of digits, spaces and `+ ( ) -`: a Mexican
   number with or without its lada and country code, as people type it
   (FR-015, D23). Kept as typed — the creator reads it, not a machine.
   The punctuation inside the class is escaped because the page stamps
   `source` into the form's `pattern` attribute (D7), which browsers
   compile with the `v` flag — where a bare `(`, `)` or `-` in a class is
   a syntax error and the whole constraint is silently dropped. */
export const WHATSAPP_PATTERN = /^\+?[0-9 \(\)\-]{10,20}$/;
/* landing-page D4: the channel tag's charset. Anything else is `direct`;
   the Worker, the beacon and the API all check this one expression. */
export const CHANNEL_PATTERN = /^[A-Za-z0-9_-]{1,32}$/;

export type BillingSystem = (typeof BILLING_SYSTEMS)[number];
export type Form = (typeof FORMS)[number];
export type Step = (typeof STEPS)[number];

/* An optional answer from a form: absent, empty (the field was shown and
   left blank) or a value. Whitespace alone is "left blank", never an
   error — a phone keyboard adds spaces nobody meant. */
const optionalName = z
  .string()
  .trim()
  .max(FIELD_LIMITS.name)
  .refine((s) => s.length === 0 || s.length >= 2, "two characters or nothing")
  .optional();

/* POST /landing/requests — JSON from the page's script, or
   application/x-www-form-urlencoded from the HTML form when no script
   runs (D6). */
export const accessRequestBody = z
  .object({
    /* The one required answer (FR-015) */
    whatsapp: z.string().trim().regex(WHATSAPP_PATTERN),
    name: optionalName,
    billingSystem: z.enum(BILLING_SYSTEMS).or(z.literal("")).optional(),
    /* Stamped by each form at build (D23) */
    form: z.enum(FORMS),
    /* The tag as the Worker injected it; the handler keeps it when it
       matches CHANNEL_PATTERN and writes `direct` otherwise (D4) — a bad
       tag is never a reason to refuse a person's request. */
    channel: z.string().max(200).optional(),
    /* landing-page D9: the honeypot. A person never sees it; a non-empty
       value is refused with REQUEST_REFUSED and stored nowhere. */
    website: z.string().optional(),
  })
  /* The hero form carries nothing but the WhatsApp (FR-015) */
  .refine((b) => b.form === "full" || (!b.name && !b.billingSystem), { path: ["form"] });

export const accessRequestReceived = z.object({ id: z.string(), receivedAt: z.number().int() });

/* POST /landing/events — form-urlencoded from the beacon (D8). `sent` is
   never accepted from the page: the API counts it when it stores a request. */
export const landingEventBody = z.object({
  step: z.enum(["visit", "began"]),
  channel: z.string().max(200).optional(),
});

/* GET /platform/landing/requests — the operator's list, newest first */
export const accessRequestListQuery = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
});

export const accessRequestRow = z.object({
  id: z.string(),
  whatsapp: z.string(),
  name: z.string().nullable(),
  billingSystem: z.enum(BILLING_SYSTEMS).nullable(),
  form: z.enum(FORMS),
  /* Another row carries the same WhatsApp — the "repetida" mark (D23).
     Both rows are kept: a person who mistyped their number must be able
     to ask again. */
  repeated: z.boolean(),
  channel: z.string(),
  createdAt: z.number().int(),
  /* landing-page D10: the notice's outcome, written on the row by the
     same request's `waitUntil`. Neither set → the notice is still in
     flight. */
  notifiedAt: z.number().int().nullable(),
  notifyError: z.string().nullable(),
});

export const accessRequestList = z.object({
  items: z.array(accessRequestRow),
  /* Opaque; `limit` ≤ 200, default 100 */
  nextCursor: z.string().nullable(),
});

/* GET /platform/landing/counts?from=YYYY-MM-DD&to=YYYY-MM-DD — inclusive,
   in America/Mexico_City (D8); default the last 30 days. */
const isoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const landingCountsQuery = z.object({ from: isoDay.optional(), to: isoDay.optional() });

export const landingCountRow = z.object({
  day: z.string(),
  channel: z.string(),
  step: z.enum(STEPS),
  count: z.number().int(),
});

export const landingCounts = z.object({ from: z.string(), to: z.string(), rows: z.array(landingCountRow) });

export type AccessRequestBody = z.infer<typeof accessRequestBody>;
export type AccessRequestReceived = z.infer<typeof accessRequestReceived>;
export type LandingEventBody = z.infer<typeof landingEventBody>;
export type AccessRequestListQuery = z.infer<typeof accessRequestListQuery>;
export type AccessRequestRow = z.infer<typeof accessRequestRow>;
export type AccessRequestList = z.infer<typeof accessRequestList>;
export type LandingCountsQuery = z.infer<typeof landingCountsQuery>;
export type LandingCountRow = z.infer<typeof landingCountRow>;
export type LandingCounts = z.infer<typeof landingCounts>;
