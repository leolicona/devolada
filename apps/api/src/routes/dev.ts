import { Hono } from "hono";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import type { Bindings } from "../env";
import { account, businesses, invitation, member, organization, user as userTable, verification } from "../db/schema";
import { upsertIntegration } from "../integrations/store";
import { issueCredential, listCredentials, revokeCredential } from "../api-clients/store";
import { makeAuth } from "../auth/better";
import { queuedCount, sweepReconnections } from "../reconnection/queue";
import { sweepDirectPayments, validatingCount } from "../direct-payments/validation";
import { releaseQueuedForCredit, sweepTopUps } from "../credit/topups";
import { sweepWebhookDeliveries } from "../webhooks/queue";
import { readBundleBytes } from "../consta/bundle/store";
import { tailOf } from "../consta/bundle/match";

/* Dev-only routes: index.ts mounts them solely when ENVIRONMENT === "dev".
   Seeds a demo ISP to verify login with curl. */

export const dev = new Hono<{ Bindings: Bindings }>();

/* passwordless-access D16: the demo holds no password. A developer gets in
   with a código — from the API's console, where it prints without
   RESEND_API_KEY, or from `POST /dev/code` below. */
const DEMO = {
  ispEmail: "demo@devolada.app",
  credential: "Demo (real)",
  testCredential: "Demo (prueba)",
};

/* D7: one sweep on demand — waiting a minute for cron while standing
   next to a pilot ISP's router is a bad way to spend a visit. */
dev.post("/reconnect-sweep", async (c) => {
  const report = await sweepReconnections(c.env);
  return c.json({ success: true, data: { ...report, queued: await queuedCount(c.env) } });
});

/* cep-bundle-match T046 (quickstart Step 0): read a bundle of CEPs — the
   ZIP apiCEP serves as `cepPdf`, or one CEP's PDF — exactly as the engine
   would (`readBundleBytes`, D3, D4), and say what it found: the records
   and the entries it could not read. Keeps nothing: no record, no file,
   no business. Accounts by their last four digits only (FR-010), so a
   reading copied into a task's notes carries no whole account. */
dev.post("/cep-read", async (c) => {
  const reading = await readBundleBytes(new Uint8Array(await c.req.arrayBuffer()));
  if (!reading) return c.json({ success: false, error: { code: "NOT_A_BUNDLE" } }, 400);
  return c.json({
    success: true,
    data: {
      kind: reading.kind,
      records: reading.found.map(({ clave, facts }) => ({
        clave,
        operationDate: facts.operationDate,
        creditDate: facts.creditDate,
        creditTime: facts.creditTime,
        amountCents: facts.amountCents,
        senderBank: facts.senderBank,
        senderAccountType: facts.senderAccountType,
        senderTail: tailOf(facts.senderAccount),
        receiverAccountType: facts.receiverAccountType,
        receiverTail: tailOf(facts.receiverAccount),
      })),
      unreadable: reading.unreadable,
    },
  });
});

/* Same escape hatch for the direct-payment re-validations (D7) */
dev.post("/direct-payment-sweep", async (c) => {
  const released = await releaseQueuedForCredit(c.env);
  const report = await sweepDirectPayments(c.env);
  const topUps = await sweepTopUps(c.env);
  /* automated-collections-api D8: the webhook retries, chained as in the cron */
  const webhooks = await sweepWebhookDeliveries(c.env);
  return c.json({ success: true, data: { ...report, released, topUps, webhooks, validating: await validatingCount(c.env) } });
});

/* bug: dev-code-readable — "dev" is also the deployed dev Worker
   (wrangler.jsonc `env.dev`), so what an email would carry is read only for
   a test address: one in `.invalid`, the domain RFC 2606 reserves so no
   mailbox can exist there (no real person owns, verifies or is invited at
   one), or the demo account, whose código /dev/code hands out by design.
   Anything else, the empty query included, is refused before a row is read. */
const testAddress = (email: string | undefined): string | null => {
  const address = (email ?? "").trim().toLowerCase();
  return address.endsWith(".invalid") || address === DEMO.ispEmail ? address : null;
};
const notTestAddress = { success: false, error: { code: "TEST_ADDRESS_ONLY" } } as const;

const CODE_TYPES = new Set(["sign-in", "email-verification", "forget-password"]);

/* passwordless-access D14, D15: the passkey journeys get what an email
   would carry. Códigos are stored hashed now (D2), so there are no digits
   to read back: this mints a fresh one through the plugin's own
   server-only door and answers it, replacing the address's live código of
   that kind (one live row per address, as T005's hook keeps it). Only for
   a test address (`testAddress`, bug: dev-code-readable): the deployed dev
   Worker runs with ENVIRONMENT=dev too, and a código for any address would
   open any account there. `GET /dev/last-code` retired with it. */
dev.post("/code", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { email?: unknown; type?: unknown };
  const address = testAddress(typeof body.email === "string" ? body.email : undefined);
  if (!address) return c.json(notTestAddress, 403);
  const type = body.type ?? "sign-in";
  if (typeof type !== "string" || !CODE_TYPES.has(type)) {
    return c.json({ success: false, error: { code: "VALIDATION" } }, 400);
  }
  await drizzle(c.env.DB).delete(verification).where(eq(verification.identifier, `${type}-otp-${address}`));
  const code = await makeAuth(c.env).api.createVerificationOTP({
    body: { email: address, type: type as "sign-in" | "email-verification" | "forget-password" },
  });
  return c.json({ success: true, data: { code } });
});

/* The journey e2e (tests/passkey/identity-journey.spec.ts) reads the last
   invitation id sent to an address: what the invitation email would carry. */

dev.get("/last-invitation", async (c) => {
  const email = testAddress(c.req.query("email"));
  if (!email) return c.json(notTestAddress, 403);
  const rows = await drizzle(c.env.DB).select().from(invitation).where(eq(invitation.email, email));
  const row = rows.at(-1);
  return c.json({ success: true, data: { id: row?.id ?? null } });
});

dev.post("/seed", async (c) => {
  const db = drizzle(c.env.DB);
  const ba = makeAuth(c.env);

  /* passwordless-access D16: the demo user is born the way every person
     is now — through the email-OTP plugin's door, by a código minted and
     consumed on the spot — so it is verified, named, and holds no
     password. */
  async function seedUser(name: string, email: string) {
    await db.delete(verification).where(eq(verification.identifier, `sign-in-otp-${email}`));
    const otp = await ba.api.createVerificationOTP({ body: { email, type: "sign-in" } });
    const { user } = await ba.api.signInEmailOTP({ body: { email, otp, name } });
    return user.id;
  }

  let [demoUser] = await db.select().from(userTable).where(eq(userTable.email, DEMO.ispEmail));
  const userId = demoUser ? demoUser.id : await seedUser("ISP Demo", DEMO.ispEmail);
  /* An adopted orphan is demo data too: verified, or the gate (better-auth
     D16) would revoke its session; and, like every account now, without a
     password (passwordless-access D5 — the sweep would erase it within a
     minute anyway; the seed does not wait for it). */
  if (demoUser) {
    if (!demoUser.emailVerified) {
      await db.update(userTable).set({ emailVerified: true }).where(eq(userTable.id, demoUser.id));
    }
    await db.delete(account).where(and(eq(account.userId, demoUser.id), eq(account.providerId, "credential")));
  }

  let [business] = await db.select().from(businesses).where(eq(businesses.email, DEMO.ispEmail));
  if (!business) {
    /* The server-side door (spike): organization + owner membership as
       rows, no plugin session needed — same shape the D7 backfill wrote */
    const orgId = `org_${crypto.randomUUID()}`;
    const now = new Date();
    await db.insert(organization).values({ id: orgId, name: "ISP Demo", slug: `negocio-demo`, createdAt: now });
    await db.insert(member).values({
      id: crypto.randomUUID(),
      organizationId: orgId,
      userId,
      role: "owner",
      createdAt: now,
    });
    [business] = await db
      .insert(businesses)
      .values({
        name: "ISP Demo",
        email: DEMO.ispEmail,
        orgId,
      })
      .returning();
  }
  /* automated-collections-api T070 / quickstart: the demo business
     collects by SPEI out of the box — a CLABE, a bank the provider knows
     and a beneficiary — so a link created with the credential below
     shows the payer an account, not "no disponible". Written once; a
     CLABE the person changed in Configuración is theirs and stays. */
  if (!business.speiClabe) {
    [business] = await db
      .update(businesses)
      .set({ speiClabe: "646180157000000004", speiBank: "STP", speiBeneficiaryName: "ISP Demo SA de CV" })
      .where(eq(businesses.id, business.id))
      .returning();
  }
  /* Idempotent, and the key refreshes: the demo business may have been
     seeded before the key existed in the environment. Actions enabled —
     the demo tenant is the backfill posture, not a new customer's ramp
     (integrations-hub D2/D4). */
  if (c.env.WISPHUB_API_KEY) {
    await upsertIntegration(db, business.id, {
      apiKey: c.env.WISPHUB_API_KEY,
      actionsEnabled: true,
    });
  }

  /* automated-collections-api T070: the quickstart in one step — a real
     and a test credential for the demo business (research D11/D12).
     Minted fresh on every seed, because the plaintext exists only in
     this answer; the pair from the previous seed is revoked first, so
     the demo never holds more than one live pair and the key you copied
     last time is simply replaced by the one you just received. */
  const seededAt = new Date();
  for (const row of await listCredentials(db, business.id)) {
    if (row.revokedAt === null && (row.name === DEMO.credential || row.name === DEMO.testCredential)) {
      await revokeCredential(db, business.id, row.id, seededAt);
    }
  }
  const real = await issueCredential(db, business.id, { name: DEMO.credential });
  const test = await issueCredential(db, business.id, { name: DEMO.testCredential, isTest: true });

  return c.json({
    success: true,
    data: {
      admin: { email: DEMO.ispEmail },
      /* `Authorization: Bearer <key>` on /v1; `testKey` runs the whole
         flow with no bank transfer (contracts/public-api.md) */
      api: { key: real.plaintext, testKey: test.plaintext },
    },
  });
});
