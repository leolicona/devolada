import { describe, expect, it, vi } from "vitest";
import { env } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { and, eq } from "drizzle-orm";
import { account, passkey, session as sessionTable, stores, topUps, user as userTable } from "../src/db/schema";
import { eraseLegacyCredentials } from "../src/auth/credentials-sweep";
import worker from "../src/index";
import type { Bindings } from "../src/env";
import { seedBusiness, seedLegacyUser, seedMember, seedSession } from "./helpers";
import { seedStore } from "./store-helpers";

/* passwordless-access US2 (FR-029, research D5): the passwords that exist
   are erased by a sweep on the every-minute cron, and so are the legacy
   accounts whose email was never proven and that nothing names. PR 1
   kept the store's password while the store app still used it;
   passwordless-access US6 (PR 2, T064) erases it too. */

const db = () => drizzle(env.DB);
const bindings = env as unknown as Bindings;
/* Past the sweep's grace for accounts still being born */
const later = () => new Date(Date.now() + 60 * 60_000);
const credentialsOf = async (userId: string) =>
  db().select().from(account).where(and(eq(account.userId, userId), eq(account.providerId, "credential")));

/* A user as the retired password doors left one: a `credential` account */
const withPassword = (name: string, email: string, verified: boolean) =>
  seedLegacyUser(name, email, { emailVerified: verified });

describe("passwordless-access US2 — the sweep erases the passwords (D5, FR-029)", () => {
  it("deletes a panel user's password, and keeps the user", async () => {
    const userId = await withPassword("Ana", "ana@negocio.mx", true);
    expect(await credentialsOf(userId)).toHaveLength(1);

    const report = await eraseLegacyCredentials(bindings, later());
    expect(report).toEqual({ credentials: 1, users: 0 });
    expect(await credentialsOf(userId)).toHaveLength(0);
    expect(await db().select().from(userTable).where(eq(userTable.id, userId))).toHaveLength(1);
  });

  it("erases a store user's password too, and keeps the user and the store (passwordless-access US6, T064)", async () => {
    const store = await seedStore({ status: "active", phone: "5512345678" });
    const userId = await withPassword("Lupita", "lupita@correo.mx", true);
    await db().update(stores).set({ userId }).where(eq(stores.id, store.id));
    expect(await credentialsOf(userId)).toHaveLength(1);

    expect(await eraseLegacyCredentials(bindings, later())).toEqual({ credentials: 1, users: 0 });
    expect(await credentialsOf(userId)).toHaveLength(0);
    expect(await db().select().from(userTable).where(eq(userTable.id, userId))).toHaveLength(1);
    const [row] = await db().select().from(stores).where(eq(stores.id, store.id));
    expect(row.userId).toBe(userId);
  });

  it("leaves an account still being born alone, for the grace (D5)", async () => {
    const userId = await withPassword("Ana", "ana@negocio.mx", true);
    expect(await eraseLegacyCredentials(bindings)).toEqual({ credentials: 0, users: 0 });
    expect(await credentialsOf(userId)).toHaveLength(1);
  });
});

describe("passwordless-access US2 — the sweep erases the legacy unverified accounts nothing names (D5)", () => {
  it("deletes an unverified user with no store and no membership, with its sessions, accounts and keys", async () => {
    const userId = await withPassword("Legado", "legado@negocio.mx", false);
    await seedSession(userId, "legado@negocio.mx");
    await db().insert(passkey).values({
      id: crypto.randomUUID(),
      publicKey: "pk",
      userId,
      credentialID: "cred-legacy",
      counter: 0,
      deviceType: "singleDevice",
      backedUp: false,
      createdAt: new Date(),
    });

    const report = await eraseLegacyCredentials(bindings, later());
    expect(report).toEqual({ credentials: 1, users: 1 });
    expect(await db().select().from(userTable).where(eq(userTable.id, userId))).toHaveLength(0);
    expect(await db().select().from(sessionTable).where(eq(sessionTable.userId, userId))).toHaveLength(0);
    expect(await db().select().from(account).where(eq(account.userId, userId))).toHaveLength(0);
    expect(await db().select().from(passkey).where(eq(passkey.userId, userId))).toHaveLength(0);
  });

  it("keeps the unverified users a row names — and still erases a panel password in the same run (analysis U1)", async () => {
    /* an unverified shopkeeper: the store names them */
    const store = await seedStore({ status: "invited" });
    const shopkeeper = await withPassword("Lupita", "lupita@correo.mx", false);
    await db().update(stores).set({ userId: shopkeeper }).where(eq(stores.id, store.id));
    /* an unverified member */
    const business = await seedBusiness({ email: "dueno@negocio.mx" });
    const memberId = await seedMember(business, "socio@negocio.mx", "operator");
    await db().update(userTable).set({ emailVerified: false }).where(eq(userTable.id, memberId));
    /* an unverified user one of our rows names */
    const submitter = await withPassword("Envía", "envia@negocio.mx", false);
    await db().insert(topUps).values({ businessId: business.id, submittedByUserId: submitter, claimedCents: 10000, proofMode: "transfer" });
    /* and a panel user with a password */
    const panel = await withPassword("Ana", "ana@negocio.mx", true);

    const report = await eraseLegacyCredentials(bindings, later());
    expect(report.users).toBe(0);
    for (const id of [shopkeeper, memberId, submitter]) {
      expect(await db().select().from(userTable).where(eq(userTable.id, id)), id).toHaveLength(1);
    }
    expect(await credentialsOf(panel)).toHaveLength(0);
    /* every password goes, the shopkeeper's too (US6, T064) */
    expect(await credentialsOf(shopkeeper)).toHaveLength(0);
    expect(await credentialsOf(submitter)).toHaveLength(0);
  });
});

describe("passwordless-access US2 — the sweep rides the cron and speaks only when it did something (D5)", () => {
  it("counts both kinds, and a second run deletes nothing", async () => {
    await withPassword("Ana", "ana@negocio.mx", true);
    await withPassword("Legado", "legado@negocio.mx", false);

    const first = await eraseLegacyCredentials(bindings, later());
    expect(first).toEqual({ credentials: 2, users: 1 });
    expect(await eraseLegacyCredentials(bindings, later())).toEqual({ credentials: 0, users: 0 });
  });

  it("the scheduled handler runs it in its own lane, and is quiet when there is nothing to erase", async () => {
    const run = async () => {
      const waits: Promise<unknown>[] = [];
      const log = vi.spyOn(console, "log").mockImplementation(() => {});
      await worker.scheduled({} as ScheduledController, bindings, {
        waitUntil: (p: Promise<unknown>) => waits.push(p),
        passThroughOnException: () => {},
      } as unknown as ExecutionContext);
      await Promise.allSettled(waits);
      const lines = log.mock.calls.map((c) => String(c[0]));
      log.mockRestore();
      return lines;
    };

    /* nothing to erase: not a word */
    expect((await run()).filter((l) => l.startsWith("credential erase:"))).toHaveLength(0);

    /* a password from before the release, past the grace: erased, and said once */
    const userId = await withPassword("Ana", "ana@negocio.mx", true);
    await db().update(userTable).set({ createdAt: new Date(Date.now() - 24 * 3600_000) }).where(eq(userTable.id, userId));
    expect((await run()).filter((l) => l.startsWith("credential erase:"))).toHaveLength(1);
    expect(await credentialsOf(userId)).toHaveLength(0);
    expect((await run()).filter((l) => l.startsWith("credential erase:"))).toHaveLength(0);
  });
});
