import { describe, expect, it, vi } from "vitest";
import { env } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import { account, invitation, member, session as sessionTable, user as userTable, verification } from "../src/db/schema";
import { app, cookiesOf, failingDB, json, seedBusiness, sentCode, sessionCookieHeader, sessionOf } from "./helpers";

/* passwordless-access US4 (contracts/panel-access.md § accept-new; D9 as
   amended 2026-10-03, spec Clarifications Q5): an invitee without an
   account gives a name and the código sent to the invited address. The
   invitation's id is the route's key, not a proof — the inviter reads it
   in POST /businesses/members' answer — so without that código nobody is
   born and no session opens (US4 scenario 7). With it, the account is
   born verified and named, with a session, inside the business, holding
   no password (US4 scenario 4). */

const db = () => drizzle(env.DB);
const call = async (who: string | null, method: string, path: string, body?: unknown, e: unknown = env) => {
  const headers: Record<string, string> = { "Content-Type": "application/json", Origin: "http://localhost:5174" };
  if (who) headers.Cookie = await sessionCookieHeader(who);
  return (await app()).request(path, { method, headers, body: body ? JSON.stringify(body) : undefined }, e as typeof env);
};

/* The inviter's own door, as the panel calls it: the id comes back in
   the answer — which is the whole of the hole Q5 closes */
async function invite(email: string, role = "operator") {
  const business = await seedBusiness();
  const res = await call("demo@devolada.app", "POST", "/businesses/members", { email, role });
  const { id } = (await res.json()).data as { id: string };
  return { business, id };
}
const acceptNew = (id: string, body: unknown, e: unknown = env) =>
  call(null, "POST", `/businesses/invitations/${id}/accept-new`, body, e);

/* The page's first step (D9): a sign-in código to the invited address,
   through the plugin's public door, as the browser asks for it */
async function askCode(email: string) {
  const res = await (await app()).request("/auth/email-otp/send-verification-otp", json({ email, type: "sign-in" }), env);
  expect(res.status).toBe(200);
  return sentCode(email);
}
const wrongFor = (right: string) => (right === "000000" ? "111111" : "000000");

const userOf = async (email: string) => (await db().select().from(userTable).where(eq(userTable.email, email)))[0];
const codeRows = (email: string) => db().select().from(verification).where(eq(verification.identifier, `sign-in-otp-${email}`));
const hasSessionCookie = (res: Response) => cookiesOf(res).some((c) => c.includes("session_token"));

/* passwordless-access D2: a código past its ten minutes, as the clock
   would leave it (passwordless-store.test.ts's `ageCode`) */
const ageCode = (email: string) =>
  db().update(verification).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(verification.identifier, `sign-in-otp-${email}`));

/* better-auth D11: the suite pins AUTH_RATE_LIMIT=off; this hands the app
   an env without the pin (rate-limit.test.ts's `armed`) */
const armed = () => {
  const { AUTH_RATE_LIMIT: _off, ...rest } = env as unknown as Record<string, unknown>;
  return rest;
};

describe("passwordless-access US4 — holding the invitation's id births nothing (scenario 7, Clarifications Q5, FR-004)", () => {
  it("the inviter takes the id from its own answer and makes up códigos: INVALID_OTP, no user, no session cookie", async () => {
    const { id } = await invite("ana@wifiplus.mx");

    /* no código was ever asked for the address */
    for (const otp of ["000000", "123456", "999999"]) {
      const res = await acceptNew(id, { name: "Ana Ruiz", otp });
      expect(res.status, otp).toBe(400);
      expect(await res.json(), otp).toEqual({ success: false, error: { code: "INVALID_OTP" } });
      expect(hasSessionCookie(res), otp).toBe(false);
    }
    /* and one the real invitee has asked for, live in their inbox only */
    const right = await askCode("ana@wifiplus.mx");
    const guess = await acceptNew(id, { name: "Ana Ruiz", otp: wrongFor(right) });
    expect(guess.status).toBe(400);
    expect((await guess.json()).error.code).toBe("INVALID_OTP");
    expect(hasSessionCookie(guess)).toBe(false);

    expect(await userOf("ana@wifiplus.mx")).toBeUndefined();
    expect(await db().select().from(member)).toHaveLength(1);
    const [row] = await db().select().from(invitation).where(eq(invitation.id, id));
    expect(row.status).toBe("pending");
  });

  it("a código the inviter got for ANOTHER address opens nothing: a código is only its address's (FR-003)", async () => {
    const { id } = await invite("ana@wifiplus.mx");
    /* the inviter's own inbox, and one more address the inviter controls */
    for (const own of ["demo@devolada.app", "otra-cuenta@inviter.mx"]) {
      const theirs = await askCode(own);
      const res = await acceptNew(id, { name: "Ana Ruiz", otp: theirs });
      expect(res.status, own).toBe(400);
      expect((await res.json()).error.code, own).toBe("INVALID_OTP");
      expect(hasSessionCookie(res), own).toBe(false);
    }
    expect(await userOf("ana@wifiplus.mx")).toBeUndefined();
    expect(await userOf("otra-cuenta@inviter.mx")).toBeUndefined();
    /* the invitee's own door is still whole: the invitation is pending */
    const [row] = await db().select().from(invitation).where(eq(invitation.id, id));
    expect(row.status).toBe("pending");
  });
});

describe("passwordless-access US4 — the código sent to the invited address births the account, inside (scenario 4, D9, FR-019)", () => {
  it("born verified and named, no password, a member with the invited role, the business active, the cookie set", async () => {
    const { business, id } = await invite("ana@wifiplus.mx", "operator");
    const otp = await askCode("ana@wifiplus.mx");

    const res = await acceptNew(id, { name: " Ana Ruiz ", otp });
    expect(res.status).toBe(201);
    expect((await res.json()).data).toMatchObject({ type: "business", id: business.id, role: "operator" });

    const ana = await userOf("ana@wifiplus.mx");
    expect(ana).toMatchObject({ emailVerified: true, name: "Ana Ruiz" });
    expect(await db().select().from(account).where(eq(account.userId, ana.id))).toHaveLength(0);
    const [membership] = await db().select().from(member).where(eq(member.userId, ana.id));
    expect(membership).toMatchObject({ organizationId: business.orgId, role: "operator" });
    const [session] = await db().select().from(sessionTable).where(eq(sessionTable.userId, ana.id));
    expect(session.activeOrganizationId).toBe(business.orgId);

    const me = await (await app()).request("/auth/me", { headers: { Cookie: sessionOf(res) } }, env);
    expect((await me.json()).data).toMatchObject({ type: "business", id: business.id, role: "operator" });

    /* the código is spent, and so is the invitation */
    expect(await codeRows("ana@wifiplus.mx")).toEqual([]);
    const [row] = await db().select().from(invitation).where(eq(invitation.id, id));
    expect(row.status).toBe("accepted");
  });

  it("a `password` a stale client still sends is ignored: no account row is written", async () => {
    const { id } = await invite("ana@wifiplus.mx");
    const otp = await askCode("ana@wifiplus.mx");
    const res = await acceptNew(id, { name: "Ana Ruiz", otp, password: "una-clave-123" });
    expect(res.status).toBe(201);
    const ana = await userOf("ana@wifiplus.mx");
    expect(await db().select().from(account).where(eq(account.userId, ana.id))).toHaveLength(0);
  });
});

describe("passwordless-access US4 — every refusal of the código reads INVALID_OTP, and nothing is born (D9, D2; FR-033)", () => {
  it("a código past its ten minutes reads INVALID_OTP, as a wrong one does", async () => {
    const { id } = await invite("ana@wifiplus.mx");
    const otp = await askCode("ana@wifiplus.mx");
    await ageCode("ana@wifiplus.mx");

    const res = await acceptNew(id, { name: "Ana Ruiz", otp });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ success: false, error: { code: "INVALID_OTP" } });
    expect(hasSessionCookie(res)).toBe(false);
    expect(await userOf("ana@wifiplus.mx")).toBeUndefined();
  });

  it("three wrong tries kill the código: its own right digits then read INVALID_OTP, and open nothing", async () => {
    const { id } = await invite("ana@wifiplus.mx");
    const right = await askCode("ana@wifiplus.mx");
    for (let i = 0; i < 3; i++) {
      const wrong = await acceptNew(id, { name: "Ana Ruiz", otp: wrongFor(right) });
      expect(wrong.status).toBe(400);
      expect((await wrong.json()).error.code).toBe("INVALID_OTP");
    }

    const dead = await acceptNew(id, { name: "Ana Ruiz", otp: right });
    expect(dead.status).toBe(400);
    expect(await dead.json()).toEqual({ success: false, error: { code: "INVALID_OTP" } });
    expect(hasSessionCookie(dead)).toBe(false);
    expect(await userOf("ana@wifiplus.mx")).toBeUndefined();
    const [row] = await db().select().from(invitation).where(eq(invitation.id, id));
    expect(row.status).toBe("pending");
  });
});

describe("passwordless-access US4 — accept-new refuses what is not its door (D9)", () => {
  it("an address with an account is EMAIL_TAKEN before any código is checked: the page's key or código is its door", async () => {
    await seedBusiness({ email: "contador@wifiplus.mx" });
    const { id } = await invite("contador@wifiplus.mx");
    const contador = await userOf("contador@wifiplus.mx");
    const right = await askCode("contador@wifiplus.mx");

    for (const otp of [wrongFor(right), right]) {
      const res = await acceptNew(id, { name: "Xavier", otp });
      expect(res.status).toBe(409);
      expect(await res.json()).toEqual({ success: false, error: { code: "EMAIL_TAKEN" } });
      expect(hasSessionCookie(res)).toBe(false);
    }
    /* the código was never looked at: live, with none of its three tries spent */
    const [code] = await codeRows("contador@wifiplus.mx");
    expect(code.value).toMatch(/:0$/);
    /* no session was opened for the account, and its name stands */
    expect(await db().select().from(sessionTable).where(eq(sessionTable.userId, contador.id))).toHaveLength(1);
    expect((await userOf("contador@wifiplus.mx")).name).toBe(contador.name);
  });

  it("an expired invitation and a gone one are INVITATION_NOT_FOUND, and the código stays unspent", async () => {
    const { id } = await invite("ana@wifiplus.mx");
    const otp = await askCode("ana@wifiplus.mx");
    await db().update(invitation).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(invitation.id, id));
    const expired = await acceptNew(id, { name: "Ana Ruiz", otp });
    expect(expired.status).toBe(404);
    expect((await expired.json()).error.code).toBe("INVITATION_NOT_FOUND");

    const gone = await acceptNew("no-such-invitation", { name: "Ana Ruiz", otp });
    expect(gone.status).toBe(404);
    expect((await gone.json()).error.code).toBe("INVITATION_NOT_FOUND");
    expect(await userOf("ana@wifiplus.mx")).toBeUndefined();
    expect((await codeRows("ana@wifiplus.mx"))[0].value).toMatch(/:0$/);
  });

  it("a missing or malformed código, or a name outside 2–80, is VALIDATION, and nobody is born", async () => {
    const { id } = await invite("ana@wifiplus.mx");
    const otp = await askCode("ana@wifiplus.mx");
    for (const body of [
      { name: "Ana Ruiz" },
      { name: "Ana Ruiz", otp: "12345" },
      { name: "Ana Ruiz", otp: "1234567" },
      { name: "Ana Ruiz", otp: "abcdef" },
      { name: "Ana Ruiz", otp: 123456 },
      { name: "A", otp },
      { name: "x".repeat(81), otp },
      { otp },
      {},
    ]) {
      const res = await acceptNew(id, body);
      expect(res.status, JSON.stringify(body)).toBe(400);
      /* the one envelope, never the validator's raw ZodError (adversarial review, 2026-10-02) */
      expect(await res.json(), JSON.stringify(body)).toEqual({ success: false, error: { code: "VALIDATION" } });
    }
    expect(await userOf("ana@wifiplus.mx")).toBeUndefined();
    /* the validator stood before the plugin: the código is live and whole */
    expect((await codeRows("ana@wifiplus.mx"))[0].value).toMatch(/:0$/);
  });

  it("the sixth accept-new within 60 s answers 429: it tries a código where Better Auth's limiter never looks (D3, FR-027)", async () => {
    for (let i = 0; i < 5; i++) {
      expect((await acceptNew("no-such-invitation", { name: "Ana Ruiz", otp: "123456" }, armed())).status).toBe(404);
    }
    const sixth = await acceptNew("no-such-invitation", { name: "Ana Ruiz", otp: "123456" }, armed());
    expect(sixth.status).toBe(429);
    expect(sixth.headers.get("x-retry-after")).toBeTruthy();
  });
});

/* The invitation dying between the route's own check and the plugin's
   acceptance (D9 step 3, contracts/panel-access.md § accept-new). The
   binding the app gets runs the real D1, and the moment the taken check
   has read "no user", the inviter cancels the invitation. */
const TAKEN_CHECK = /^select "id" from "user" where "user"\."email" = \?/;
function racingDB(onChecked: () => Promise<void>): D1Database {
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
          return !fired && TAKEN_CHECK.test(query) ? wrap(stmt) : stmt;
        };
      }
      const value = Reflect.get(target, prop);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

describe("passwordless-access US4 — an invitation that dies after the check keeps the proved account (D9 step 3)", () => {
  it("INVITATION_NOT_FOUND, with the session cookie: the account the código proved is its owner's, with no membership", async () => {
    const { business, id } = await invite("ana@wifiplus.mx");
    const otp = await askCode("ana@wifiplus.mx");
    let cancelled = false;
    const racing = {
      ...(env as unknown as Record<string, unknown>),
      DB: racingDB(async () => {
        await db().update(invitation).set({ status: "canceled" }).where(eq(invitation.id, id));
        cancelled = true;
      }),
    };

    const res = await acceptNew(id, { name: "Ana Ruiz", otp }, racing);
    expect(cancelled).toBe(true);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ success: false, error: { code: "INVITATION_NOT_FOUND" } });

    const ana = await userOf("ana@wifiplus.mx");
    expect(ana).toMatchObject({ emailVerified: true, name: "Ana Ruiz" });
    expect(await db().select().from(member).where(eq(member.organizationId, business.orgId))).toHaveLength(1);
    expect(await db().select().from(member).where(eq(member.userId, ana.id))).toEqual([]);
    /* the cookie is a live session of that account: /auth/me resolves it
       and finds no business, where a dead cookie would be 401 */
    const me = await (await app()).request("/auth/me", { headers: { Cookie: sessionOf(res) } }, env);
    expect(me.status).toBe(403);
    expect((await me.json()).error.code).toBe("NO_BUSINESS");
    expect(await db().select().from(sessionTable).where(eq(sessionTable.userId, ana.id))).toHaveLength(1);
  });
});

/* Any other failure of step 4 (D9 as amended 2026-10-03,
   contracts/panel-access.md § accept-new): only the plugin's own
   INVITATION_NOT_FOUND reads as "the invitation died"; anything else is a
   500, and the account the código proved is kept, with no undo (the
   store acceptance has one, D10): whoever typed the código holds the inbox.
   The cookie went out before step 4, so the 500 carries it (adversarial
   review, 2026-10-03). D1 drops the connection on one statement of the
   step: the acceptance's own write of the membership, or the
   activation's membership check, which only setActiveOrganization reads.
   What each leaves is what the page meets on a retry (measured
   2026-10-03, better-auth 1.6.29): a failed acceptance leaves the
   invitation pending, for the session's own acceptance to take; a failed
   activation leaves the membership written and the invitation accepted. */
const STEP_4_FAILURES = [
  { step: "the acceptance", at: /^insert into "member"/, memberships: 0, invitationStatus: "pending" },
  {
    step: "the activation",
    at: /^select "id", "organization_id", "user_id", "role", "created_at" from "member" where \("member"\."user_id" = \? and "member"\."organization_id" = \?\)/,
    memberships: 1,
    invitationStatus: "accepted",
  },
];

describe("passwordless-access US4 — a step-4 failure that is not the invitation dying keeps the proved account (D9)", () => {
  for (const { step, at, memberships, invitationStatus } of STEP_4_FAILURES) {
    it(`${step} failing: 500 with the session cookie, and the account kept, verified and named`, async () => {
      const { id } = await invite("ana@wifiplus.mx");
      const otp = await askCode("ana@wifiplus.mx");
      const hits = { count: 0 };
      const failing = { ...(env as unknown as Record<string, unknown>), DB: failingDB(at, hits) };

      const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
      const res = await acceptNew(id, { name: "Ana Ruiz", otp }, failing);
      quiet.mockRestore();
      expect(hits.count).toBe(1);
      expect(res.status).toBe(500);
      expect(await res.json()).toEqual({ success: false, error: { code: "INTERNAL_SERVER_ERROR" } });

      /* kept: one account, verified and named, and the código spent on it */
      const ana = await userOf("ana@wifiplus.mx");
      expect(ana).toMatchObject({ emailVerified: true, name: "Ana Ruiz" });
      expect(await db().select().from(userTable).where(eq(userTable.email, "ana@wifiplus.mx"))).toHaveLength(1);
      expect(await codeRows("ana@wifiplus.mx")).toEqual([]);
      /* the step failed where it was made to, and left what it left */
      expect(await db().select().from(member).where(eq(member.userId, ana.id))).toHaveLength(memberships);
      expect((await db().select().from(invitation).where(eq(invitation.id, id)))[0].status).toBe(invitationStatus);

      /* the cookie on the 500 is a live session of that account */
      const session = await (await app()).request("/auth/get-session", { headers: { Cookie: sessionOf(res) } }, env);
      expect(((await session.json()) as { user: { id: string } }).user.id).toBe(ana.id);
    });
  }
});
