import { and, eq, inArray, type SQL } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import { paymentLinks, type payments } from "../db/schema";
import { D1_MAX_PARAMS, chunks } from "../db/params";

/* The link's kind and state, read from the row (automated-collections-api
   D3, data-model.md). One table carries both collection channels, so the
   invariants the write path enforces are restated here as narrowings
   every reader can lean on instead of re-deriving them. */

export type PaymentLink = typeof paymentLinks.$inferSelect;

/* The token the payer's URL carries: opaque, permanent, non-guessable
   (direct-payment D1). 32-char alphabet without confusables; 256 % 32
   === 0, so the modulo is unbiased. 16 chars ≈ 80 bits. Shared by the
   panel's lazy generation and the API's create (automated-collections-api
   D2: one table, one token space). */
export function makeLinkToken(): string {
  const alphabet = "abcdefghijkmnpqrstuvwxyz23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  let out = "";
  for (const b of bytes) out += alphabet[b % 32];
  return out;
}

/* A panel link: made for a WispHub customer, its ask read live from
   WispHub. `source = 'panel'` ⟹ usuario and numeric id present. */
export type PanelLink = PaymentLink & {
  source: "panel";
  customerUsuario: string;
  wisphubCustomerId: string;
};

/* An API link: made by the business's own software through /v1, its ask
   stored on the row. `source = 'api'` ⟹ reference and ask present. */
export type ApiLink = PaymentLink & {
  source: "api";
  customerRef: string;
  askCents: number;
};

export function isPanelLink(link: PaymentLink): link is PanelLink {
  return link.source === "panel" && link.customerUsuario !== null && link.wisphubCustomerId !== null;
}

export function isApiLink(link: PaymentLink): link is ApiLink {
  return link.source === "api" && link.customerRef !== null && link.askCents !== null;
}

/* Derived, never stored (automated-collections-api D3, data-model.md):
   a fourth column would have to agree with `closed_at` and `expires_at`
   on every write, and the clock decides `expired` without any write at
   all. A reusable link carries neither timestamp, so it is always open. */
export type LinkState = "open" | "paid" | "expired";

export function linkState(
  link: Pick<PaymentLink, "closedAt" | "expiresAt">,
  now: Date,
): LinkState {
  if (link.closedAt !== null) return "paid";
  if (link.expiresAt !== null && link.expiresAt.getTime() <= now.getTime()) return "expired";
  return "open";
}

/* FR-031: only an open link accepts a payment */
export function linkAcceptsPayments(
  link: Pick<PaymentLink, "closedAt" | "expiresAt">,
  now: Date,
): boolean {
  return linkState(link, now) === "open";
}

/* automated-collections-api D12 (FR-035): a test credential's links and
   payments EXIST — the caller reads them through /v1 to test its own
   polling and history — and reach nothing real. Every business-facing
   read (the panel's feed and its totals, the proof and the actions, the
   link roster, the webhook health) spells this one predicate instead of
   remembering `is_test = false` at each call site: the requirement most
   likely to leak is enforced by one rule and one test
   (collections-api-test-mode.test.ts). The fee has its own gate in
   credit/index.ts, and the validation sweep never claims a test row. A
   panel link is never a test link — the write path guarantees it — so
   the panel's own list needs nothing. The payer's page reads by token
   and is not a business-facing read. */
export function realOnly(table: typeof paymentLinks | typeof payments): SQL {
  return eq(table.isTest, false);
}

/* Every customer of the roster has a link (direct-payment D5,
   admin-links-view D5): the usuario is the identity, the numeric id a
   cache.

   **Retiring** (links-on-demand-search D8, D12): the bulk writer is
   what made listing create links, and FR-008 ends that — a link is born
   on an operator's act, which `ensureLink` below serves. It stays only
   while its three callers do (the two link doors and the sweep's
   `roster` pass), and goes with them in one commit (tasks T044, T045).
   Nothing new may call it.

   Writes only what changed. Lives here, not in the route, since
   bug: links-roster-cap — the sweep creates each page's links as it
   stores it, and a sweep does not reach into a route handler. The
   upsert this replaces rewrote one `payment_links` row per customer on
   every read, cache hit or not — and the roster is read on every return
   to the Links tab (BUG-020). Statements grow with the tenant, so each
   goes in chunks under D1's parameter cap (BUG-021). Returns
   usuario → token. */
export async function ensureLinks(
  db: DrizzleD1Database,
  businessId: string,
  customers: { usuario: string; wisphubId: number }[],
): Promise<Map<string, string>> {
  const tokens = new Map<string, string>();
  if (!customers.length) return tokens;
  /* usuario → the numeric id the row holds today */
  const storedId = new Map<string, string>();
  const readTokens = async (usuarios: string[]) => {
    /* one parameter is the business id, one the source */
    for (const part of chunks(usuarios, D1_MAX_PARAMS - 2)) {
      const rows = await db
        .select({
          customerUsuario: paymentLinks.customerUsuario,
          token: paymentLinks.token,
          wisphubCustomerId: paymentLinks.wisphubCustomerId,
        })
        .from(paymentLinks)
        .where(
          and(
            eq(paymentLinks.businessId, businessId),
            /* automated-collections-api D3/D4: the usuario namespace is the
               panel's; an API link never holds one */
            eq(paymentLinks.source, "panel"),
            inArray(paymentLinks.customerUsuario, part),
          ),
        );
      for (const row of rows) {
        if (row.customerUsuario === null || row.wisphubCustomerId === null) continue;
        tokens.set(row.customerUsuario, row.token);
        storedId.set(row.customerUsuario, row.wisphubCustomerId);
      }
    }
  };
  await readTokens(customers.map((customer) => customer.usuario));

  const missing = customers.filter((customer) => !tokens.has(customer.usuario));
  /* nine values per row at most: id and created_at, the four written
     below, and `source`, `mode`, `is_test` — drizzle sends a column's
     literal default as a parameter too (automated-collections-api D3;
     measured 2026-09-17: 150 customers at six per row overran D1's cap) */
  for (const part of chunks(missing, Math.floor(D1_MAX_PARAMS / 9))) {
    const inserted = await db
      .insert(paymentLinks)
      .values(
        part.map((customer) => ({
          businessId,
          token: makeLinkToken(),
          wisphubCustomerId: String(customer.wisphubId),
          customerUsuario: customer.usuario,
        })),
      )
      /* Two members listing at once: the first insert wins the usuario,
         the second reads its token below. automated-collections-api D4:
         the usuario index is partial now, and SQLite matches a named
         conflict target to a partial index only when the target repeats
         its WHERE — which drizzle 0.40 cannot emit for DO NOTHING (it
         places `where` after `do nothing`, a syntax error; measured
         2026-09-17). An untargeted DO NOTHING covers every unique index
         on the table, which for a fresh token is the same one. */
      .onConflictDoNothing()
      .returning({ customerUsuario: paymentLinks.customerUsuario, token: paymentLinks.token });
    for (const row of inserted) {
      if (row.customerUsuario !== null) tokens.set(row.customerUsuario, row.token);
    }
  }
  const raced = missing.filter((customer) => !tokens.has(customer.usuario)).map((c) => c.usuario);
  if (raced.length) await readTokens(raced);

  /* D5: the numeric id refreshes on sight — one row each, only when it
     moved, which is a recycled id on the demo tenant and nothing on a
     real one. */
  for (const customer of customers) {
    const stored = storedId.get(customer.usuario);
    if (stored !== undefined && stored !== String(customer.wisphubId)) {
      await db
        .update(paymentLinks)
        .set({ wisphubCustomerId: String(customer.wisphubId) })
        .where(and(eq(paymentLinks.businessId, businessId), eq(paymentLinks.customerUsuario, customer.usuario)));
    }
  }
  return tokens;
}

/* ONE customer's link, created by the act and by nothing else
   (links-on-demand-search D8, FR-005/FR-008/FR-009).

   This is the whole write path for a panel link from now on: it is
   called only from `POST /direct-payments/links`, which only an
   operator pressing Copiar or WhatsApp reaches. No list read, no sweep,
   no background pass writes one — which is what SC-009 measures, and
   what `ensureLinks` below stopped being allowed to do.

   An existing link is RETURNED, never replaced: the usuario is the
   identity and the link is permanent while it exists. Only the numeric
   id refreshes, a cache WispHub may recycle to a different person
   (`direct-payment D5`), which keys nothing.

   `created` is what the door echoes to the operator's screen; it also
   makes "a second press creates no second link" a fact the caller can
   assert rather than infer. */
export async function ensureLink(
  db: DrizzleD1Database,
  businessId: string,
  customer: { usuario: string; wisphubId: number },
): Promise<{ token: string; created: boolean }> {
  const wisphubCustomerId = String(customer.wisphubId);
  const [existing] = await db
    .select({ token: paymentLinks.token, wisphubCustomerId: paymentLinks.wisphubCustomerId })
    .from(paymentLinks)
    .where(
      and(
        eq(paymentLinks.businessId, businessId),
        /* automated-collections-api D3/D4: the usuario namespace is the
           panel's; an API link never holds one */
        eq(paymentLinks.source, "panel"),
        eq(paymentLinks.customerUsuario, customer.usuario),
      ),
    );
  if (existing) {
    if (existing.wisphubCustomerId !== wisphubCustomerId) {
      await db
        .update(paymentLinks)
        .set({ wisphubCustomerId })
        .where(and(eq(paymentLinks.businessId, businessId), eq(paymentLinks.customerUsuario, customer.usuario)));
    }
    return { token: existing.token, created: false };
  }

  const [inserted] = await db
    .insert(paymentLinks)
    .values({ businessId, token: makeLinkToken(), wisphubCustomerId, customerUsuario: customer.usuario })
    /* Two operators pressing at once: the first insert wins the usuario,
       the second reads its token below. Untargeted for the reason
       `ensureLinks` records — drizzle 0.40 cannot emit the WHERE that
       SQLite needs to match the partial index by name. */
    .onConflictDoNothing()
    .returning({ token: paymentLinks.token });
  if (inserted) return { token: inserted.token, created: true };

  /* Lost the race: the row exists now and it is the one that counts */
  const [raced] = await db
    .select({ token: paymentLinks.token })
    .from(paymentLinks)
    .where(
      and(
        eq(paymentLinks.businessId, businessId),
        eq(paymentLinks.source, "panel"),
        eq(paymentLinks.customerUsuario, customer.usuario),
      ),
    );
  if (!raced) throw new Error("ensureLink: the link neither inserted nor exists");
  return { token: raced.token, created: false };
}
