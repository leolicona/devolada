import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { env, fetchMock } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { and, eq } from "drizzle-orm";
import {
  account,
  member,
  session as sessionTable,
  storeInvitations,
  stores,
  user as userTable,
  verification,
} from "../src/db/schema";
import { makeAuth } from "../src/auth/better";
import { eraseLegacyCredentials } from "../src/auth/credentials-sweep";
import type { Bindings } from "../src/env";
import {
  acceptStoreInvitationResponse,
  storeInvitationCodeResponse,
  storeMeResponse,
  storeSignInCodeResponse,
  storeSignInResponse,
} from "../src/routes/store/schema";
import { REFUSAL_ROUND_TRIPS } from "../src/routes/store/handler";
import {
  app,
  cookiesOf,
  failingDB,
  json,
  mintCode,
  seedBusiness,
  seedLegacyUser,
  sentCode,
  sessionCookieHeader,
  sessionOf,
} from "./helpers";
import { seedActiveStore, seedStore } from "./store-helpers";

/* passwordless-access US6 (contracts/store-access.md; research D3, D4, D8,
   D10): the store app loses its password. The invitation is an email and
   its código — a taken address is named only after a right código
   (FR-032), and the store becomes active only at the código (FR-031). The
   sign-in is the store's phone, with the código sent to the store
   account's email; every phone gets the same answer (FR-033). No store
   route but the acceptance ever creates an account (FR-034), and the
   password doors answer 404 (D4). */

beforeAll(() => {
  fetchMock.activate();
  fetchMock.disableNetConnect();
});
afterEach(() => fetchMock.assertNoPendingInterceptors());

const db = () => drizzle(env.DB);
const call = async (path: string, init: RequestInit = {}, e: unknown = env) => (await app()).request(path, init, e as typeof env);
const userOf = async (email: string) => (await db().select().from(userTable).where(eq(userTable.email, email)))[0];
const sessionsOf = (userId: string) => db().select().from(sessionTable).where(eq(sessionTable.userId, userId));
const codeRows = (email: string) => db().select().from(verification).where(eq(verification.identifier, `sign-in-otp-${email}`));
const invitationRow = async () => (await db().select().from(storeInvitations))[0];
const storeRow = async (id: string) => (await db().select().from(stores).where(eq(stores.id, id)))[0];
/* Every código the sender logged in this test (setup.ts keeps them) */
const loggedCodes = () => (globalThis as { [k: symbol]: Map<string, string> })[Symbol.for("devolada.test.sentCodes")];

/* passwordless-access D2: a código past its ten minutes, as the clock
   would leave it */
const ageCode = (email: string) =>
  db().update(verification).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(verification.identifier, `sign-in-otp-${email}`));

/* better-auth D11: the suite pins AUTH_RATE_LIMIT=off; these hand the app
   an env without the pin (rate-limit.test.ts's `armed`) */
const armed = () => {
  const { AUTH_RATE_LIMIT: _off, ...rest } = env as unknown as Record<string, unknown>;
  return rest;
};

/* The operator's create, as the panel calls it, answering the plaintext
   link once — the only place a test can learn a token */
async function invite(phone = "5512345678") {
  const business = await seedBusiness({ email: "operador@devolada.app" });
  const opEnv = { ...(env as unknown as Bindings), PLATFORM_OPERATOR_EMAILS: "operador@devolada.app" };
  const res = await (await app()).request(
    "/platform/stores",
    {
      ...json({ name: "Abarrotes Lupita", address: "Av. Juárez 12, Centro", shopkeeperName: "Lupita Hernández", phone }),
      headers: { "Content-Type": "application/json", Cookie: await sessionCookieHeader("operador@devolada.app") },
    },
    opEnv as unknown as typeof env,
  );
  const { data } = await res.json();
  return { business, store: data.store as { id: string }, token: (data.invitation.url as string).split("/invitacion/")[1] };
}

const askCode = (token: string, email: string, e: unknown = env) => call(`/store/invitations/${token}/code`, json({ email }), e);
const acceptWith = (token: string, email: string, otp: string, e: unknown = env) =>
  call(`/store/invitations/${token}/accept`, json({ email, otp }), e);
const askPhoneCode = (phone: string, e: unknown = env) => call("/store/sign-in/code", json({ phone }), e);
const signIn = (phone: string, otp: string, e: unknown = env) => call("/store/sign-in", json({ phone, otp }), e);

describe("passwordless-access US6 — the invitation's código (D10, FR-031, FR-032)", () => {
  it("goes to every address — a new one, a user's, an operator's — and answers the address typed", async () => {
    const { token } = await invite();
    await seedBusiness({ email: "tomado@correo.mx" });
    const opEnv = { ...(env as unknown as Bindings), PLATFORM_OPERATOR_EMAILS: "jefa@devolada.app" };
    for (const email of ["lupita@correo.mx", "tomado@correo.mx", "jefa@devolada.app"]) {
      const res = await askCode(token, ` ${email.toUpperCase()} `, opEnv);
      expect(res.status, email).toBe(200);
      expect(storeInvitationCodeResponse.parse((await res.json()).data)).toEqual({ sentTo: email });
      expect(sentCode(email)).toMatch(/^\d{6}$/);
    }
    /* nothing else moved: no user born, the store still invited */
    expect(await userOf("lupita@correo.mx")).toBeUndefined();
    expect(await userOf("jefa@devolada.app")).toBeUndefined();
    expect((await invitationRow()).status).toBe("sent");
  });

  it("a bad token is INVALID_INVITATION and sends nothing; a malformed address is VALIDATION_ERROR", async () => {
    const { token } = await invite();
    const bad = await askCode("no-such-token", "lupita@correo.mx");
    expect(bad.status).toBe(400);
    expect((await bad.json()).error.code).toBe("INVALID_INVITATION");
    expect(loggedCodes().size).toBe(0);

    const malformed = await askCode(token, "no-es-un-correo");
    expect(malformed.status).toBe(400);
    expect((await malformed.json()).error.code).toBe("VALIDATION_ERROR");
  });
});

describe("passwordless-access US6 — the acceptance, a new address (D10, cash-at-stores T089)", () => {
  it("births the user verified, named, with the phone as username and no password; the store active, the invitation accepted, the cookie set", async () => {
    const { store, token } = await invite();
    await askCode(token, "lupita@correo.mx");
    const res = await acceptWith(token, "lupita@correo.mx", sentCode("lupita@correo.mx"));
    expect(res.status).toBe(201);
    expect(acceptStoreInvitationResponse.parse((await res.json()).data)).toEqual({ storeName: "Abarrotes Lupita" });

    const user = await userOf("lupita@correo.mx");
    expect(user).toMatchObject({
      emailVerified: true,
      name: "Lupita Hernández",
      username: "5512345678",
      displayUsername: "5512345678",
    });
    expect(await db().select().from(account).where(eq(account.userId, user.id))).toHaveLength(0);
    expect(await storeRow(store.id)).toMatchObject({ userId: user.id, status: "active" });
    expect((await invitationRow()).status).toBe("accepted");
    /* used: it no longer opens */
    expect((await (await call(`/store/invitations/${token}`)).json()).data.state).toBe("invalid");

    /* the cookie is the store's session, and /auth/me carries its email (D8) */
    const me = await call("/auth/me", { headers: { Cookie: sessionOf(res) } });
    expect(me.status).toBe(200);
    expect(storeMeResponse.parse((await me.json()).data)).toEqual({
      type: "store",
      storeId: store.id,
      name: "Abarrotes Lupita",
      businessName: null,
      email: "lupita@correo.mx",
    });
  });

  it("a wrong código is INVALID_OTP and writes nothing; three wrong ones kill it, and its right digits read the same (FR-033)", async () => {
    const { store, token } = await invite();
    await askCode(token, "lupita@correo.mx");
    const right = sentCode("lupita@correo.mx");
    const wrong = right === "000000" ? "111111" : "000000";

    const first = await acceptWith(token, "lupita@correo.mx", wrong);
    expect(first.status).toBe(400);
    expect((await first.json()).error.code).toBe("INVALID_OTP");
    expect(await userOf("lupita@correo.mx")).toBeUndefined();
    expect((await storeRow(store.id)).status).toBe("invited");

    await acceptWith(token, "lupita@correo.mx", wrong);
    await acceptWith(token, "lupita@correo.mx", wrong);
    const dead = await acceptWith(token, "lupita@correo.mx", right);
    expect(dead.status).toBe(400);
    expect((await dead.json()).error.code).toBe("INVALID_OTP");
    expect(await userOf("lupita@correo.mx")).toBeUndefined();
    expect((await invitationRow()).status).toBe("sent");
  });

  it("a código past its ten minutes reads INVALID_OTP, and writes nothing (D2, FR-033)", async () => {
    const { store, token } = await invite();
    await askCode(token, "lupita@correo.mx");
    await ageCode("lupita@correo.mx");
    const res = await acceptWith(token, "lupita@correo.mx", sentCode("lupita@correo.mx"));
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("INVALID_OTP");
    expect(cookiesOf(res).some((c) => c.includes("session_token"))).toBe(false);
    expect(await userOf("lupita@correo.mx")).toBeUndefined();
    expect(await storeRow(store.id)).toMatchObject({ status: "invited", userId: null });
    expect((await invitationRow()).status).toBe("sent");
  });

  it("a malformed body is VALIDATION_ERROR: a password, or a código that is not six digits", async () => {
    const { token } = await invite();
    for (const body of [
      { email: "lupita@correo.mx", password: "secreta123" },
      { email: "lupita@correo.mx", otp: "12345" },
      { email: "lupita@correo.mx", otp: "abcdef" },
    ]) {
      const res = await call(`/store/invitations/${token}/accept`, json(body));
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect((await res.json()).error.code).toBe("VALIDATION_ERROR");
    }
  });
});

describe("passwordless-access US6 — the acceptance, a taken address (D10, FR-032)", () => {
  it("a user's address: a wrong código is INVALID_OTP; EMAIL_TAKEN only after a right one, which then opens nothing", async () => {
    const { store, token } = await invite();
    await seedBusiness({ email: "tomado@correo.mx" });
    const owner = await userOf("tomado@correo.mx");
    await askCode(token, "tomado@correo.mx");
    const right = sentCode("tomado@correo.mx");

    const wrong = await acceptWith(token, "tomado@correo.mx", right === "000000" ? "111111" : "000000");
    expect(wrong.status).toBe(400);
    expect((await wrong.json()).error.code).toBe("INVALID_OTP");

    const taken = await acceptWith(token, "tomado@correo.mx", right);
    expect(taken.status).toBe(409);
    expect((await taken.json()).error.code).toBe("EMAIL_TAKEN");
    expect(cookiesOf(taken).some((c) => c.includes("session_token"))).toBe(false);
    /* the código that proved the address is gone: it opens nothing after */
    expect(await codeRows("tomado@correo.mx")).toHaveLength(0);
    const reuse = await call("/auth/sign-in/email-otp", json({ email: "tomado@correo.mx", otp: right }));
    expect(reuse.status).toBe(400);

    /* the owner's account is untouched, and the invitation still open */
    expect(await userOf("tomado@correo.mx")).toMatchObject({ id: owner.id, username: null });
    expect(await storeRow(store.id)).toMatchObject({ status: "invited", userId: null });
    expect((await invitationRow()).status).toBe("sent");
    expect((await (await call(`/store/invitations/${token}`)).json()).data.state).toBe("open");
  });

  it("an operator's address with no account: EMAIL_TAKEN after a right código, and no account is born", async () => {
    const { store, token } = await invite();
    const opEnv = { ...(env as unknown as Bindings), PLATFORM_OPERATOR_EMAILS: "jefa@devolada.app" };
    await askCode(token, "jefa@devolada.app", opEnv);
    const right = sentCode("jefa@devolada.app");

    const wrong = await acceptWith(token, "jefa@devolada.app", right === "000000" ? "111111" : "000000", opEnv);
    expect(wrong.status).toBe(400);
    expect((await wrong.json()).error.code).toBe("INVALID_OTP");

    const taken = await acceptWith(token, "jefa@devolada.app", right, opEnv);
    expect(taken.status).toBe(409);
    expect((await taken.json()).error.code).toBe("EMAIL_TAKEN");
    expect(await userOf("jefa@devolada.app")).toBeUndefined();
    expect(await codeRows("jefa@devolada.app")).toHaveLength(0);
    expect(await storeRow(store.id)).toMatchObject({ status: "invited", userId: null });
    expect((await invitationRow()).status).toBe("sent");
  });

  it("a user's address with a código past its ten minutes reads INVALID_OTP: the address is not named (D2, FR-032, FR-033)", async () => {
    const { store, token } = await invite();
    await seedBusiness({ email: "tomado@correo.mx" });
    await askCode(token, "tomado@correo.mx");
    await ageCode("tomado@correo.mx");
    const res = await acceptWith(token, "tomado@correo.mx", sentCode("tomado@correo.mx"));
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("INVALID_OTP");
    expect(await storeRow(store.id)).toMatchObject({ status: "invited", userId: null });
    expect((await invitationRow()).status).toBe("sent");
  });
});

/* The race D10 guards: the address gains an account between the taken
   check and the código's sign-in. The binding the app gets runs the
   real D1, and the moment the taken check has read "no user", the other
   request lands — a verified account with a membership. `at` names the
   one query after which the other request lands: by default the taken
   check; the rollback's cases pass the race guard's own store read. */
const TAKEN_CHECK = /^select "id" from "user" where "user"\."email" = \?/;
const GUARD_STORE_READ = /^select "id" from "stores" where "stores"\."user_id" = \?/;
function racingDB(onChecked: () => Promise<void>, at: RegExp = TAKEN_CHECK): D1Database {
  const real = env.DB;
  let fired = false;
  const wrap = (stmt: D1PreparedStatement): D1PreparedStatement =>
    new Proxy(stmt, {
      get(target, prop) {
        if (prop === "bind") return (...values: unknown[]) => wrap(target.bind(...values));
        if (prop === "all" || prop === "raw" || prop === "first" || prop === "run") {
          return async (...args: unknown[]) => {
            const result = await (target[prop] as (...a: unknown[]) => Promise<unknown>)(...args);
            if (!fired) {
              fired = true;
              await onChecked();
            }
            return result;
          };
        }
        const value = Reflect.get(target, prop);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
  return new Proxy(real, {
    get(target, prop) {
      if (prop === "prepare") {
        return (query: string) => {
          const stmt = target.prepare(query);
          /* the one query `at` names, and nothing else */
          return !fired && at.test(query) ? wrap(stmt) : stmt;
        };
      }
      const value = Reflect.get(target, prop);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

/* The statements `failingDB` (helpers.ts) drops, inside the plugin */
const PLUGIN_SESSION_INSERT = /^insert into "session"/;
const PLUGIN_USER_READ = /^select "id", "name", "email", .* from "user" where "user"\."email" = \?/;

describe("passwordless-access US6 — the race guard (D10)", () => {
  it("an address that gains a membership between the check and the sign-in is EMAIL_TAKEN, with no session left and no link written", async () => {
    const { business, store, token } = await invite();
    await askCode(token, "lupita@correo.mx");
    let racerId = "";
    const racing = {
      ...(env as unknown as Bindings),
      DB: racingDB(async () => {
        const racer = await (await makeAuth(env as unknown as Bindings).$context).internalAdapter.createUser({
          name: "Otra Persona",
          email: "lupita@correo.mx",
          emailVerified: true,
        });
        racerId = racer.id;
        await db().insert(member).values({
          id: crypto.randomUUID(),
          organizationId: business.orgId,
          userId: racer.id,
          role: "operator",
          createdAt: new Date(),
        });
      }),
    };

    const res = await acceptWith(token, "lupita@correo.mx", sentCode("lupita@correo.mx"), racing);
    expect(racerId).not.toBe("");
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe("EMAIL_TAKEN");
    expect(cookiesOf(res).some((c) => c.includes("session_token"))).toBe(false);

    expect(await sessionsOf(racerId)).toHaveLength(0);
    /* the other person's account is theirs, untouched */
    expect(await userOf("lupita@correo.mx")).toMatchObject({ id: racerId, name: "Otra Persona", username: null });
    expect(await storeRow(store.id)).toMatchObject({ status: "invited", userId: null });
    expect((await invitationRow()).status).toBe("sent");
  });

  it("an address taken between the plugin's own read and its insert is EMAIL_TAKEN, and the other account is kept whole (adversarial review, 2026-10-03)", async () => {
    const { store, token } = await invite();
    await askCode(token, "lupita@correo.mx");
    let racerId = "";
    const racing = {
      ...(env as unknown as Bindings),
      /* born with nothing yet — what the undo would remove were it ours */
      DB: racingDB(async () => {
        racerId = (
          await (await makeAuth(env as unknown as Bindings).$context).internalAdapter.createUser({
            name: "Otra Persona",
            email: "lupita@correo.mx",
            emailVerified: true,
          })
        ).id;
      }, PLUGIN_USER_READ),
    };

    const res = await acceptWith(token, "lupita@correo.mx", sentCode("lupita@correo.mx"), racing);
    expect(racerId).not.toBe("");
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe("EMAIL_TAKEN");
    expect(cookiesOf(res).some((c) => c.includes("session_token"))).toBe(false);
    expect(await userOf("lupita@correo.mx")).toMatchObject({ id: racerId, name: "Otra Persona", username: null });
    expect(await storeRow(store.id)).toMatchObject({ status: "invited", userId: null });
    expect((await invitationRow()).status).toBe("sent");
  });
});

/* D5's rollback (cash-at-stores T089, `undoAcceptance`): the store is
   linked to someone else after the race guard passed — another acceptance
   won it. The guard's store read is where the other request lands. */
async function winStoreElsewhere(storeId: string) {
  const winner = await (await makeAuth(env as unknown as Bindings).$context).internalAdapter.createUser({
    name: "Ganadora",
    email: "ganadora@correo.mx",
    emailVerified: true,
  });
  await db().update(stores).set({ userId: winner.id, status: "active" }).where(eq(stores.id, storeId));
  return winner.id;
}

describe("passwordless-access US6 — the acceptance's rollback (D10, cash-at-stores D5)", () => {
  it("a store won by another acceptance after the guard: INVALID_INVITATION, and the user this request made is gone", async () => {
    const { store, token } = await invite();
    await askCode(token, "lupita@correo.mx");
    let winnerId = "";
    const racing = {
      ...(env as unknown as Bindings),
      DB: racingDB(async () => {
        winnerId = await winStoreElsewhere(store.id);
      }, GUARD_STORE_READ),
    };

    const res = await acceptWith(token, "lupita@correo.mx", sentCode("lupita@correo.mx"), racing);
    expect(winnerId).not.toBe("");
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("INVALID_INVITATION");
    expect(cookiesOf(res).some((c) => c.includes("session_token"))).toBe(false);
    expect(await userOf("lupita@correo.mx")).toBeUndefined();
    /* the winner's link stands; the invitation is left as the winner left it */
    expect(await storeRow(store.id)).toMatchObject({ status: "active", userId: winnerId });
    expect((await invitationRow()).status).toBe("sent");
  });

  it("a user that holds anything besides this request's session is kept: only that session goes", async () => {
    const { store, token } = await invite();
    await askCode(token, "lupita@correo.mx");
    let otherToken = "";
    const racing = {
      ...(env as unknown as Bindings),
      DB: racingDB(async () => {
        await winStoreElsewhere(store.id);
        /* the same address, signed in at the panel within the same second */
        const born = await userOf("lupita@correo.mx");
        otherToken = crypto.randomUUID();
        const now = new Date();
        await db()
          .insert(sessionTable)
          .values({ id: crypto.randomUUID(), token: otherToken, userId: born.id, expiresAt: new Date(now.getTime() + 60_000), createdAt: now, updatedAt: now });
      }, GUARD_STORE_READ),
    };

    const res = await acceptWith(token, "lupita@correo.mx", sentCode("lupita@correo.mx"), racing);
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("INVALID_INVITATION");
    expect(cookiesOf(res).some((c) => c.includes("session_token"))).toBe(false);
    const kept = await userOf("lupita@correo.mx");
    expect(kept).toBeDefined();
    expect((await sessionsOf(kept.id)).map((row) => row.token)).toEqual([otherToken]);
  });

  it("an error between the user's birth and the store's link undoes the user: her own address still accepts (adversarial review, 2026-10-02)", async () => {
    const { store, token } = await invite();
    await askCode(token, "lupita@correo.mx");
    /* D1 drops the connection on the race guard's store read */
    const failing = {
      ...(env as unknown as Bindings),
      DB: racingDB(async () => {
        throw new Error("D1_ERROR: Network connection lost.");
      }, GUARD_STORE_READ),
    };

    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await acceptWith(token, "lupita@correo.mx", sentCode("lupita@correo.mx"), failing);
    quiet.mockRestore();
    expect(res.status).toBe(500);
    expect(cookiesOf(res).some((c) => c.includes("session_token"))).toBe(false);
    /* no verified orphan is left to read as someone else's account */
    expect(await userOf("lupita@correo.mx")).toBeUndefined();
    expect(await storeRow(store.id)).toMatchObject({ status: "invited", userId: null });
    expect((await invitationRow()).status).toBe("sent");

    await askCode(token, "lupita@correo.mx");
    const retry = await acceptWith(token, "lupita@correo.mx", sentCode("lupita@correo.mx"));
    expect(retry.status).toBe(201);
    expect((await storeRow(store.id)).status).toBe("active");
    expect((await invitationRow()).status).toBe("accepted");
  });

  it("an error on the plugin's own session insert, after it bore the user, undoes the user too: her own address still accepts (adversarial review, 2026-10-03)", async () => {
    const { store, token } = await invite();
    await askCode(token, "lupita@correo.mx");
    /* D1 drops the connection on the session insert, inside signInEmailOTP */
    const hits = { count: 0 };
    const failing = { ...(env as unknown as Bindings), DB: failingDB(PLUGIN_SESSION_INSERT, hits) };

    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await acceptWith(token, "lupita@correo.mx", sentCode("lupita@correo.mx"), failing);
    quiet.mockRestore();
    expect(hits.count).toBe(1);
    expect(res.status).toBe(500);
    expect(cookiesOf(res).some((c) => c.includes("session_token"))).toBe(false);
    /* no verified orphan is left to read as someone else's account */
    expect(await userOf("lupita@correo.mx")).toBeUndefined();
    expect(await storeRow(store.id)).toMatchObject({ status: "invited", userId: null });
    expect((await invitationRow()).status).toBe("sent");

    await askCode(token, "lupita@correo.mx");
    const retry = await acceptWith(token, "lupita@correo.mx", sentCode("lupita@correo.mx"));
    expect(retry.status).toBe(201);
    expect((await storeRow(store.id)).status).toBe("active");
    expect((await invitationRow()).status).toBe("accepted");
  });
});

describe("passwordless-access US6 — leaving before the código (FR-031, analysis G3)", () => {
  it("the código alone activates nothing; a second attempt with a new código accepts", async () => {
    const { store, token } = await invite();
    await askCode(token, "lupita@correo.mx");
    const first = sentCode("lupita@correo.mx");
    /* the person left here */
    expect(await storeRow(store.id)).toMatchObject({ status: "invited", userId: null });
    expect((await invitationRow()).status).toBe("sent");
    expect(await userOf("lupita@correo.mx")).toBeUndefined();

    /* later, back through the same invitation: a new código ends the old one (D2) */
    await askCode(token, "lupita@correo.mx");
    const second = sentCode("lupita@correo.mx");
    if (second !== first) {
      const stale = await acceptWith(token, "lupita@correo.mx", first);
      expect(stale.status).toBe(400);
      expect((await stale.json()).error.code).toBe("INVALID_OTP");
    }
    const res = await acceptWith(token, "lupita@correo.mx", second);
    expect(res.status).toBe(201);
    expect((await storeRow(store.id)).status).toBe("active");
    expect((await invitationRow()).status).toBe("accepted");
  });
});

/* FR-033's "as fast" (adversarial review, 2026-10-02), read from outside
   the handler. `recordingDB` keeps the text of every statement a request
   prepares, in order — the work it did, without its values. `gatedDB`
   holds the statement `at` names until `gate` opens, so a test can see
   whether the answer waited for it. */
function recordingDB(log: string[]): D1Database {
  const real = env.DB;
  return new Proxy(real, {
    get(target, prop) {
      if (prop === "prepare") {
        return (query: string) => {
          log.push(query);
          return target.prepare(query);
        };
      }
      const value = Reflect.get(target, prop);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}
function gatedDB(at: RegExp, gate: Promise<void>): D1Database {
  const real = env.DB;
  const hold = (stmt: D1PreparedStatement): D1PreparedStatement =>
    new Proxy(stmt, {
      get(target, prop) {
        if (prop === "bind") return (...values: unknown[]) => hold(target.bind(...values));
        if (prop === "all" || prop === "raw" || prop === "first" || prop === "run") {
          return async (...args: unknown[]) => {
            await gate;
            return (target[prop] as (...a: unknown[]) => Promise<unknown>)(...args);
          };
        }
        const value = Reflect.get(target, prop);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
  return new Proxy(real, {
    get(target, prop) {
      if (prop === "prepare") return (query: string) => (at.test(query) ? hold(target.prepare(query)) : target.prepare(query));
      const value = Reflect.get(target, prop);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

/* A D1 primary far from the Worker: every statement answers `ms` after it
   is sent, whatever the local D1 took inside that window. The refusals
   it times run no batch. The wait holds on the clock the floor reads: a
   workerd timer can fire a few ms early, so the clock is read again after
   it, as `refusalFloor` does. Held before the statement, the store
   lookup read 34–39 ms when a timer fired early, or 59 when the local D1
   stalled after it, and the floor — ten of those — moved with it
   (adversarial review, 2026-10-03). */
function slowDB(ms: number): D1Database {
  const real = env.DB;
  const slow = (stmt: D1PreparedStatement): D1PreparedStatement =>
    new Proxy(stmt, {
      get(target, prop) {
        if (prop === "bind") return (...values: unknown[]) => slow(target.bind(...values));
        if (prop === "all" || prop === "raw" || prop === "first" || prop === "run") {
          return async (...args: unknown[]) => {
            const until = Date.now() + ms;
            const result = await (target[prop] as (...a: unknown[]) => Promise<unknown>)(...args);
            for (let left = until - Date.now(); left > 0; left = until - Date.now()) {
              await new Promise((resolve) => setTimeout(resolve, left));
            }
            return result;
          };
        }
        const value = Reflect.get(target, prop);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
  return new Proxy(real, {
    get(target, prop) {
      if (prop === "prepare") return (query: string) => slow(target.prepare(query));
      const value = Reflect.get(target, prop);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

describe("passwordless-access US6 — the phone door (D10, FR-033, FR-034)", () => {
  it("sends the código to the store's email, and the código signs in — the cookie is the store's", async () => {
    const { store, email, userId } = await seedActiveStore({ phone: "5512345678" });
    const asked = await askPhoneCode("55 1234 5678");
    expect(asked.status).toBe(200);
    expect(storeSignInCodeResponse.parse((await asked.json()).data)).toEqual({ sent: true });
    expect([...loggedCodes().keys()]).toEqual([email]);

    const res = await signIn("+52 55 1234 5678", sentCode(email));
    expect(res.status).toBe(200);
    expect(storeSignInResponse.parse((await res.json()).data)).toEqual({ storeName: store.name });
    const me = await call("/auth/me", { headers: { Cookie: sessionOf(res) } });
    expect(storeMeResponse.parse((await me.json()).data)).toMatchObject({ type: "store", storeId: store.id, email });
    /* the seeded session and the código's */
    expect(await sessionsOf(userId)).toHaveLength(2);
  });

  it("a stranger's phone gets the same answer and no código; with any código it is INVALID_OTP, as a wrong código is", async () => {
    const { email } = await seedActiveStore({ phone: "5512345678" });
    const stranger = await askPhoneCode("5599999999");
    expect(stranger.status).toBe(200);
    expect((await stranger.json()).data).toEqual({ sent: true });
    expect(loggedCodes().size).toBe(0);

    const strangerTry = await signIn("5599999999", "123456");
    expect(strangerTry.status).toBe(400);
    expect((await strangerTry.json()).error.code).toBe("INVALID_OTP");

    await askPhoneCode("5512345678");
    const right = sentCode(email);
    const wrong = await signIn("5512345678", right === "000000" ? "111111" : "000000");
    expect(wrong.status).toBe(400);
    expect((await wrong.json()).error.code).toBe("INVALID_OTP");
    expect(cookiesOf(wrong).some((c) => c.includes("session_token"))).toBe(false);
  });

  it("a store's phone answers exactly as a stranger's: before a código, past its three tries, and once it died (FR-033)", async () => {
    const { email } = await seedActiveStore({ phone: "5512345678" });
    const stranger = await signIn("5599999999", "123456");
    const strangerBody = await stranger.text();
    expect(stranger.status).toBe(400);
    expect(JSON.parse(strangerBody)).toEqual({ success: false, error: { code: "INVALID_OTP" } });

    /* no código asked yet */
    const answers = [await signIn("5512345678", "123456")];
    await askPhoneCode("5512345678");
    const right = sentCode(email);
    const wrong = right === "000000" ? "111111" : "000000";
    /* the plugin says TOO_MANY_ATTEMPTS past the third (D2); here it reads INVALID_OTP */
    for (let i = 0; i < 4; i++) answers.push(await signIn("5512345678", wrong));
    /* the código died with its tries: its own right digits open nothing now */
    answers.push(await signIn("5512345678", right));

    for (const res of answers) {
      expect(res.status).toBe(400);
      expect(await res.text()).toBe(strangerBody);
      expect(cookiesOf(res).some((c) => c.includes("session_token"))).toBe(false);
    }
  });

  it("a código past its ten minutes reads exactly as a stranger's phone (D2, FR-033)", async () => {
    const { email } = await seedActiveStore({ phone: "5512345678" });
    const strangerBody = await (await signIn("5599999999", "123456")).text();
    await askPhoneCode("5512345678");
    await ageCode(email);
    const res = await signIn("5512345678", sentCode(email));
    expect(res.status).toBe(400);
    expect(await res.text()).toBe(strangerBody);
    expect(cookiesOf(res).some((c) => c.includes("session_token"))).toBe(false);
  });

  /* The other door to the same código (adversarial review, 2026-10-03):
     what /store/sign-in/code writes lives under the store's email, which
     Better Auth's own HTTP door reads too. Whoever guesses a shop's email
     tries it there; the plugin's TOO_MANY_ATTEMPTS and OTP_EXPIRED exist
     only for a live código, so that door folds them as /store/sign-in does
     (FR-033, SC-006). */
  const publicTry = async (email: string, otp: string) => {
    const res = await call("/auth/sign-in/email-otp", json({ email, otp }));
    expect(cookiesOf(res).some((c) => c.includes("session_token"))).toBe(false);
    return { status: res.status, statusText: res.statusText, headers: [...res.headers.entries()], body: await res.text() };
  };

  it("Better Auth's own código door cannot tell a store's phone either: four wrong tries with the store's email answer alike (FR-033, SC-006; adversarial review, 2026-10-03)", async () => {
    const { email } = await seedActiveStore({ phone: "5512345678" });

    /* a store's phone: the código goes to the store's email */
    await askPhoneCode("5512345678");
    const right = sentCode(email);
    const wrong = right === "000000" ? "111111" : "000000";
    const afterStore = [];
    for (let i = 0; i < 4; i++) afterStore.push(await publicTry(email, wrong));
    /* the código died with its third try: its own right digits open nothing */
    afterStore.push(await publicTry(email, right));

    /* a stranger's phone: no código anywhere */
    await askPhoneCode("5599999999");
    expect([...loggedCodes().keys()]).toEqual([email]);
    const afterStranger = [];
    for (let i = 0; i < 4; i++) afterStranger.push(await publicTry(email, wrong));
    afterStranger.push(await publicTry(email, right));

    expect(afterStore).toEqual(afterStranger);
    for (const answer of afterStore) {
      expect(answer.status).toBe(400);
      expect(JSON.parse(answer.body)).toMatchObject({ code: "INVALID_OTP" });
    }
  });

  it("and the other way round: a código asked for the guessed email, three tries spent through a phone, then one public try (FR-033, SC-006; adversarial review, 2026-10-03)", async () => {
    const { email } = await seedActiveStore({ phone: "5512345678" });
    const probe = async (phone: string) => {
      await call("/auth/email-otp/send-verification-otp", json({ email, type: "sign-in" }));
      const right = sentCode(email);
      const wrong = right === "000000" ? "111111" : "000000";
      for (let i = 0; i < 3; i++) expect((await signIn(phone, wrong)).status).toBe(400);
      return publicTry(email, wrong);
    };
    /* the store's phone spent the email's tries; a stranger's spent none */
    const viaStore = await probe("5512345678");
    const viaStranger = await probe("5599999999");
    expect(viaStore).toEqual(viaStranger);
    expect(JSON.parse(viaStore.body)).toMatchObject({ code: "INVALID_OTP" });
  });

  it("a stranger's phone does the same work as a store's: both reach the plugin's código check (FR-033; adversarial review, 2026-10-02)", async () => {
    await seedActiveStore({ phone: "5512345678" });
    const stranger: string[] = [];
    const store: string[] = [];
    expect((await signIn("5599999999", "123456", { ...env, DB: recordingDB(stranger) })).status).toBe(400);
    expect((await signIn("5512345678", "123456", { ...env, DB: recordingDB(store) })).status).toBe(400);
    expect(stranger.filter((q) => q.includes('"verification"')).length).toBeGreaterThan(0);
    expect(stranger).toEqual(store);
    /* the address it checked holds nothing, before or after */
    expect(await db().select().from(verification)).toHaveLength(0);
  });

  it("every refusal answers no sooner than the floor; a sign-in is not held (FR-033; adversarial review, 2026-10-02)", async () => {
    const { email } = await seedActiveStore({ phone: "5512345678" });
    const FLOOR = 500;
    const floored = { ...env, STORE_SIGN_IN_FLOOR_MS: String(FLOOR) };
    const timed = async (phone: string, otp: string) => {
      const started = Date.now();
      const res = await signIn(phone, otp, floored);
      return { status: res.status, ms: Date.now() - started };
    };

    const stranger = await timed("5599999999", "123456");
    expect(stranger.status).toBe(400);
    expect(stranger.ms).toBeGreaterThanOrEqual(FLOOR);

    await askPhoneCode("5512345678");
    const right = sentCode(email);
    const wrong = await timed("5512345678", right === "000000" ? "111111" : "000000");
    expect(wrong.status).toBe(400);
    expect(wrong.ms).toBeGreaterThanOrEqual(FLOOR);

    const signedIn = await timed("5512345678", right);
    expect(signedIn.status).toBe(200);
    expect(signedIn.ms).toBeLessThan(FLOOR);
  });

  it("a far D1 primary raises the floor to ten of the store lookup's round trips, and a stranger's phone and a live código answer as fast (FR-033; adversarial review, 2026-10-03)", async () => {
    const { email } = await seedActiveStore({ phone: "5512345678" });
    /* a base far under the work, and every statement held 40 ms: a live
       código's wrong guess then works ~320 ms and a stranger's ~200 ms,
       both under a floor of ten round trips (~400 ms). A floor that did
       not scale would leave the three statements between them, 120 ms,
       on the stopwatch. */
    const STATEMENT_MS = 40;
    const far = { ...env, STORE_SIGN_IN_FLOOR_MS: "50", DB: slowDB(STATEMENT_MS) };
    const timed = async (phone: string, otp: string) => {
      const started = Date.now();
      const res = await signIn(phone, otp, far);
      expect(res.status).toBe(400);
      return Date.now() - started;
    };

    /* timed on a warm Worker: a cold first request runs 10–40 ms slower,
       whichever phone it carries (measured 2026-10-03) */
    await timed("5599999999", "123456");
    await askPhoneCode("5512345678");
    const right = sentCode(email);
    const wrong = right === "000000" ? "111111" : "000000";

    /* A stopwatch reads the fastest of several tries: noise only adds
       time. The floor is ten times the lookup, so it multiplies the few ms
       of CPU around the lookup too, and now and then one stall (one run in
       ~40, measured 2026-10-03). Three tries each, taken in turn, compare
       what an attacker would — and a live código's three wrong tries are
       all it has before it dies (D2). */
    const stranger: number[] = [];
    const live: number[] = [];
    for (let i = 0; i < 3; i++) {
      stranger.push(await timed("5599999999", "123456"));
      live.push(await timed("5512345678", wrong));
    }
    for (const ms of [...stranger, ...live]) expect(ms).toBeGreaterThanOrEqual(REFUSAL_ROUND_TRIPS * STATEMENT_MS);
    /* the property itself: closer than one statement, where a floor that
       did not scale shows three */
    expect(Math.abs(Math.min(...live) - Math.min(...stranger))).toBeLessThan(STATEMENT_MS);
  }, 20_000);

  it("a wrong guess on a live código runs fewer statements than the floor counts round trips, so the floor still covers it (FR-033; adversarial review, 2026-10-03)", async () => {
    const { email } = await seedActiveStore({ phone: "5512345678" });
    await askPhoneCode("5512345678");
    const right = sentCode(email);
    const log: string[] = [];
    const res = await signIn("5512345678", right === "000000" ? "111111" : "000000", { ...env, DB: recordingDB(log) });
    expect(res.status).toBe(400);
    /* the live path: the guess rewrote the código's row with one more try */
    expect(log.some((q) => q.startsWith('insert into "verification"'))).toBe(true);
    /* measured 2026-10-03 with better-auth 1.6.29: 8 statements */
    expect(log.length).toBeLessThan(REFUSAL_ROUND_TRIPS);
  });

  it("a store's phone is answered before its código is written: the send rides waitUntil (FR-033; adversarial review, 2026-10-02)", async () => {
    const { email } = await seedActiveStore({ phone: "5512345678" });
    let open!: () => void;
    const gate = new Promise<void>((resolve) => (open = resolve));
    const waits: Promise<unknown>[] = [];
    const ctx = {
      waitUntil: (work: Promise<unknown>) => void waits.push(work),
      passThroughOnException: () => {},
    } as unknown as ExecutionContext;
    const gated = { ...env, DB: gatedDB(/^insert into "verification"/, gate) };

    const pending = (await app()).request("/store/sign-in/code", json({ phone: "5512345678" }), gated, ctx);
    try {
      const answered = await Promise.race([pending, new Promise<null>((resolve) => setTimeout(() => resolve(null), 2000))]);
      /* the answer came while the código's write was still held */
      expect(answered?.status).toBe(200);
      expect(await answered!.json()).toEqual({ success: true, data: { sent: true } });
      expect(loggedCodes().size).toBe(0);
      expect(await codeRows(email)).toHaveLength(0);
      expect(waits).toHaveLength(1);
    } finally {
      open();
      await pending;
    }
    await Promise.all(waits);
    expect([...loggedCodes().keys()]).toEqual([email]);
    expect(await codeRows(email)).toHaveLength(1);
  });

  it("a phone that is not ten national digits is VALIDATION_ERROR on both calls", async () => {
    for (const res of [await askPhoneCode("12345"), await signIn("12345", "123456")]) {
      expect(res.status).toBe(400);
      expect((await res.json()).error.code).toBe("VALIDATION_ERROR");
    }
  });

  it("an invited store's phone, with no shopkeeper yet, signs nobody in", async () => {
    await seedStore({ status: "invited", phone: "5512345678" });
    expect((await (await askPhoneCode("5512345678")).json()).data).toEqual({ sent: true });
    expect(loggedCodes().size).toBe(0);
    expect((await (await signIn("5512345678", "123456")).json()).error.code).toBe("INVALID_OTP");
  });

  it("a suspended store is STORE_SUSPENDED after a right código, with no session row left", async () => {
    const { store, email, userId } = await seedActiveStore({ phone: "5512345678" });
    await db().update(stores).set({ status: "suspended" }).where(eq(stores.id, store.id));
    await db().delete(sessionTable).where(eq(sessionTable.userId, userId));

    await askPhoneCode("5512345678");
    const res = await signIn("5512345678", sentCode(email));
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe("STORE_SUSPENDED");
    expect(cookiesOf(res).some((c) => c.includes("session_token"))).toBe(false);
    expect(await sessionsOf(userId)).toHaveLength(0);
  });
});

describe("passwordless-access US6 — a legacy shopkeeper (analysis G1, D5)", () => {
  it("who accepted with a password and never typed the código gets in by phone, verified, and keeps no password", async () => {
    /* as cash-at-stores' acceptance left them before the release */
    const store = await seedStore({ status: "invited", phone: "5512345678" });
    const userId = await seedLegacyUser("Lupita Hernández", "lupita@correo.mx");
    await db().update(userTable).set({ username: "5512345678", displayUsername: "5512345678" }).where(eq(userTable.id, userId));
    await db().update(stores).set({ userId, status: "active" }).where(eq(stores.id, store.id));
    await db().update(storeInvitations).set({ status: "accepted" });

    await askPhoneCode("5512345678");
    const res = await signIn("5512345678", sentCode("lupita@correo.mx"));
    expect(res.status).toBe(200);
    expect(await userOf("lupita@correo.mx")).toMatchObject({ id: userId, emailVerified: true, username: "5512345678" });
    const me = await call("/auth/me", { headers: { Cookie: sessionOf(res) } });
    expect(me.status).toBe(200);
    expect((await me.json()).data).toMatchObject({ type: "store", storeId: store.id, email: "lupita@correo.mx" });
    /* the código proved the address, and the plugin dropped the password an
       unproven account held at that moment (1.6.29 revokeUnprovenAccountAccess) */
    expect(
      await db().select().from(account).where(and(eq(account.userId, userId), eq(account.providerId, "credential"))),
    ).toHaveLength(0);

    /* and the sweep, past its grace, leaves them no password (T064) */
    await eraseLegacyCredentials(env as unknown as Bindings, new Date(Date.now() + 60 * 60_000));
    expect(
      await db().select().from(account).where(and(eq(account.userId, userId), eq(account.providerId, "credential"))),
    ).toHaveLength(0);
    expect(await userOf("lupita@correo.mx")).toBeDefined();
  });

  it("who had verified their address (cash-at-stores D5) gets in by phone too; the sweep erases the password and keeps them", async () => {
    const store = await seedStore({ status: "invited", phone: "5512345678" });
    const userId = await seedLegacyUser("Lupita Hernández", "lupita@correo.mx", { emailVerified: true });
    await db().update(userTable).set({ username: "5512345678", displayUsername: "5512345678" }).where(eq(userTable.id, userId));
    await db().update(stores).set({ userId, status: "active" }).where(eq(stores.id, store.id));
    await db().update(storeInvitations).set({ status: "accepted" });

    await askPhoneCode("5512345678");
    const res = await signIn("5512345678", sentCode("lupita@correo.mx"));
    expect(res.status).toBe(200);
    expect(storeSignInResponse.parse((await res.json()).data)).toEqual({ storeName: store.name });

    await eraseLegacyCredentials(env as unknown as Bindings, new Date(Date.now() + 60 * 60_000));
    expect(
      await db().select().from(account).where(and(eq(account.userId, userId), eq(account.providerId, "credential"))),
    ).toHaveLength(0);
    /* the store's link and the session the código opened both stand */
    expect(await storeRow(store.id)).toMatchObject({ status: "active", userId });
    expect(await sessionsOf(userId)).toHaveLength(1);
  });
});

describe("passwordless-access US6 — no account from the store app but the acceptance (FR-034)", () => {
  it("asking for códigos and trying them, at the invitation and the phone, creates no user", async () => {
    const { token } = await invite();
    const before = (await db().select().from(userTable)).length;

    await askCode(token, "nueva@correo.mx");
    await askPhoneCode("5599999999");
    await signIn("5599999999", "123456");
    /* the phone door reaches the plugin only with an address a store names
       or one nobody could predict: even the address's right código, typed
       with a stranger's phone, opens nothing, and nothing is written */
    await signIn("5599999999", sentCode("nueva@correo.mx"));
    expect((await db().select().from(userTable)).length).toBe(before);
    expect((await db().select().from(verification)).map((v) => v.identifier)).toEqual(["sign-in-otp-nueva@correo.mx"]);

    /* the acceptance is the one door that births one */
    expect((await acceptWith(token, "nueva@correo.mx", sentCode("nueva@correo.mx"))).status).toBe(201);
    expect((await db().select().from(userTable)).length).toBe(before + 1);
  });
});

describe("passwordless-access US6 — the retired doors answer 404 (D4)", () => {
  it("the phone and password, the recovery, the old verification and the HTTP código check", async () => {
    const { email } = await seedActiveStore({ phone: "5512345678" });
    const otp = await mintCode(email);
    const doors: [string, unknown][] = [
      ["/auth/sign-in/username", { username: "5512345678", password: "devolada123" }],
      ["/auth/email-otp/reset-password", { email, otp, password: "nueva-clave-1" }],
      ["/auth/email-otp/request-password-reset", { email }],
      ["/auth/forget-password/email-otp", { email }],
      ["/auth/email-otp/verify-email", { email, otp }],
      ["/auth/email-otp/check-verification-otp", { email, type: "sign-in", otp }],
    ];
    for (const [path, body] of doors) {
      const res = await call(path, json(body));
      expect(res.status, path).toBe(404);
      expect(res.headers.get("set-cookie"), path).toBeNull();
    }
    /* none of them spent the código: it still opens the account */
    expect((await call("/auth/sign-in/email-otp", json({ email, otp }))).status).toBe(200);
  });
});

describe("passwordless-access US6 — the store routes' limits (D3)", () => {
  it("the fourth /store/sign-in/code and the sixth /store/sign-in within 60 s answer 429", async () => {
    for (let i = 0; i < 3; i++) expect((await askPhoneCode("5599999999", armed())).status).toBe(200);
    const fourth = await askPhoneCode("5599999999", armed());
    expect(fourth.status).toBe(429);
    expect(fourth.headers.get("x-retry-after")).toBeTruthy();

    for (let i = 0; i < 5; i++) expect((await signIn("5599999999", "123456", armed())).status).toBe(400);
    expect((await signIn("5599999999", "123456", armed())).status).toBe(429);
  });

  it("the fourth invitation código within 60 s answers 429", async () => {
    const { token } = await invite();
    for (let i = 0; i < 3; i++) expect((await askCode(token, "lupita@correo.mx", armed())).status).toBe(200);
    expect((await askCode(token, "lupita@correo.mx", armed())).status).toBe(429);
  });

  it("the sixth acceptance within 60 s answers 429: our own código check, which Better Auth's limiter never sees (FR-027)", async () => {
    const { token } = await invite();
    for (let i = 0; i < 5; i++) expect((await acceptWith(token, "lupita@correo.mx", "000000", armed())).status).toBe(400);
    const sixth = await acceptWith(token, "lupita@correo.mx", "000000", armed());
    expect(sixth.status).toBe(429);
    expect(sixth.headers.get("x-retry-after")).toBeTruthy();
  });
});
