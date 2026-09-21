import { beforeAll, describe, expect, it } from "vitest";
import { env, fetchMock } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { accessRequests, landingCounts } from "../src/db/schema";
import type { Bindings } from "../src/env";
import { dayInMexicoCity } from "../src/routes/landing/handler";
import { accessRequestList, landingCounts as landingCountsSchema } from "../src/routes/landing/schema";
import { app, seedBusiness, seedMember, sessionCookieHeader } from "./helpers";

/* landing-page US1 (the request door: FR-015–FR-021, research D4, D6, D8,
   D9, D10, D23) and landing-page US2 (the counts and the operator's reads:
   FR-017, FR-023–FR-025, SC-010). The Hono app runs in workerd against a
   migrated D1; Resend is intercepted at its real origin (constitution IV). */

beforeAll(() => {
  fetchMock.activate();
  fetchMock.disableNetConnect();
});

const OPERATOR = "demo@devolada.app";
const LANDING = "https://landing-test.devolada.internal";

type Env = typeof env & Bindings;
const base = () => env as unknown as Env;
/* The suite pins AUTH_RATE_LIMIT=off (vitest.config.ts); the limiter's own
   scenarios hand the app an env without it, as rate-limit.test.ts does. */
const armed = (e: Env = base()) => {
  const { AUTH_RATE_LIMIT: _off, ...rest } = e as unknown as Record<string, unknown>;
  return rest as unknown as Env;
};
/* D6: the unset behaviour — a form post answered with the envelope */
const withoutLanding = (e: Env = base()) => {
  const { LANDING_BASE_URL: _unset, ...rest } = e as unknown as Record<string, unknown>;
  return rest as unknown as Env;
};
const withOperators = (e: Env = base()) => ({ ...e, PLATFORM_OPERATOR_EMAILS: `${OPERATOR}, socio@devolada.app` }) as Env;

const json = (body: unknown): RequestInit => ({
  method: "POST",
  headers: { "Content-Type": "application/json", Origin: "https://devoladapago.com" },
  body: JSON.stringify(body),
});
const form = (fields: Record<string, string>): RequestInit => ({
  method: "POST",
  headers: { "Content-Type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams(fields).toString(),
  /* A browser follows the 303 itself; the test reads it */
  redirect: "manual",
});
const request = async (init: RequestInit, bindings: Env = base()) =>
  (await app()).request("/landing/requests", init, bindings);
const event = async (fields: Record<string, string>, bindings: Env = base()) =>
  (await app()).request("/landing/events", { ...form(fields), redirect: "follow" }, bindings);

const rows = () => drizzle(env.DB).select().from(accessRequests);
const counts = () => drizzle(env.DB).select().from(landingCounts);

const HERO = { whatsapp: "55 1234 5678", form: "hero" };
const FULL = { whatsapp: "+52 1 55 9876 5432", name: "Ana Torres", billingSystem: "wisphub", form: "full", channel: "Grupo-ISP" };

describe("landing-page US1: the request reaches the creator as typed", () => {
  it("a hero request is stored with the WhatsApp as typed, form hero, nothing else, channel direct", async () => {
    const res = await request(json(HERO));
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(typeof data.id).toBe("string");
    expect(typeof data.receivedAt).toBe("number");

    const [row] = await rows();
    expect(row.whatsapp).toBe("55 1234 5678");
    expect(row.form).toBe("hero");
    expect(row.name).toBeNull();
    expect(row.billingSystem).toBeNull();
    expect(row.channel).toBe("direct");
    /* D8: `sent` is counted by the API, for the channel and Mexico City's day */
    const [count] = await counts();
    expect(count).toMatchObject({ day: dayInMexicoCity(), channel: "direct", step: "sent", count: 1 });
  });

  it("a closing-form request keeps the name, the system and the tag (FR-015, FR-017, D4)", async () => {
    expect((await request(json(FULL))).status).toBe(200);
    const [row] = await rows();
    expect(row).toMatchObject({ whatsapp: "+52 1 55 9876 5432", name: "Ana Torres", billingSystem: "wisphub", form: "full", channel: "Grupo-ISP" });
    const [count] = await counts();
    expect(count).toMatchObject({ channel: "Grupo-ISP", step: "sent", count: 1 });
  });

  it("a tag outside the charset and a blank optional answer are kept as nothing, never refused (D4, D23)", async () => {
    expect((await request(json({ ...FULL, name: "  ", billingSystem: "", channel: "<script>" }))).status).toBe(200);
    const [row] = await rows();
    expect(row.name).toBeNull();
    expect(row.billingSystem).toBeNull();
    expect(row.channel).toBe("direct");
  });

  it("a missing or malformed WhatsApp answers VALIDATION_ERROR and stores nothing (FR-020)", async () => {
    for (const body of [{ form: "hero" }, { whatsapp: "", form: "hero" }, { whatsapp: "12", form: "hero" }, { whatsapp: "ana@correo.mx", form: "hero" }]) {
      const res = await request(json(body));
      expect(res.status).toBe(400);
      expect((await res.json()).error.code).toBe("VALIDATION_ERROR");
    }
    /* The hero form carries nothing but the WhatsApp */
    const res = await request(json({ ...HERO, name: "Ana" }));
    expect(res.status).toBe(400);
    expect(await rows()).toHaveLength(0);
  });

  it("a filled honeypot answers REQUEST_REFUSED with no row and no count (FR-019, D9)", async () => {
    const res = await request(json({ ...HERO, website: "http://spam.example" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("REQUEST_REFUSED");
    expect(await rows()).toHaveLength(0);
    expect(await counts()).toHaveLength(0);
  });

  it("the sixth request in an hour from one address answers 429 (FR-019, D9)", async () => {
    for (let i = 0; i < 5; i++) expect((await request(json(HERO), armed())).status).toBe(200);
    const sixth = await request(json(HERO), armed());
    expect(sixth.status).toBe(429);
    expect((await sixth.json()).error.code).toBe("TOO_MANY_REQUESTS");
    expect(await rows()).toHaveLength(5);
  });

  it("a plain form post is answered with a page: 303 to /gracias, a refusal to /no-enviada (D6)", async () => {
    const received = await request(form({ whatsapp: "55 1234 5678", form: "hero", channel: "" }));
    expect(received.status).toBe(303);
    expect(received.headers.get("location")).toBe(`${LANDING}/gracias`);
    const [row] = await rows();
    expect(row.channel).toBe("direct");

    const refused = await request(form({ whatsapp: "55 1234 5678", form: "hero", website: "x" }));
    expect(refused.status).toBe(303);
    expect(refused.headers.get("location")).toBe(`${LANDING}/no-enviada?motivo=REQUEST_REFUSED`);

    const malformed = await request(form({ whatsapp: "12", form: "hero" }));
    expect(malformed.status).toBe(303);
    expect(malformed.headers.get("location")).toBe(`${LANDING}/no-enviada?motivo=VALIDATION_ERROR`);
    expect(await rows()).toHaveLength(1);
  });

  it("the sixth plain form post lands on the outcome page too (D6, D9)", async () => {
    for (let i = 0; i < 5; i++) expect((await request(form({ whatsapp: "55 1234 5678", form: "hero" }), armed())).status).toBe(303);
    const sixth = await request(form({ whatsapp: "55 1234 5678", form: "hero" }), armed());
    expect(sixth.status).toBe(303);
    expect(sixth.headers.get("location")).toBe(`${LANDING}/no-enviada?motivo=TOO_MANY_REQUESTS`);
  });

  it("with LANDING_BASE_URL unset the same form post is answered with the envelope (D6, constitution VIII)", async () => {
    const res = await request(form({ whatsapp: "55 1234 5678", form: "hero" }), withoutLanding());
    expect(res.status).toBe(200);
    expect((await res.json()).success).toBe(true);
    const refused = await request(form({ whatsapp: "55 1234 5678", form: "hero", website: "x" }), withoutLanding());
    expect(refused.status).toBe(400);
    expect((await refused.json()).error.code).toBe("REQUEST_REFUSED");
  });

  it("the notice reaches every operator with every field as typed, and the row says so (FR-018, D10)", async () => {
    const sent: { to: string[]; subject: string; html: string }[] = [];
    fetchMock
      .get("https://api.resend.com")
      .intercept({ method: "POST", path: "/emails" })
      .reply(200, (req) => {
        sent.push(JSON.parse(String(req.body)));
        return { id: "e" };
      });
    const mailEnv = { ...withOperators(), RESEND_API_KEY: "re_test" } as Env;
    expect((await request(json(FULL), mailEnv)).status).toBe(200);

    expect(sent).toHaveLength(1);
    expect(sent[0].to).toEqual([OPERATOR, "socio@devolada.app"]);
    expect(sent[0].subject).toBe("Nuevo WhatsApp — +52 1 55 9876 5432");
    for (const piece of ["+52 1 55 9876 5432", "Ana Torres", "wisphub", "full", "Grupo-ISP"]) expect(sent[0].html).toContain(piece);
    const [row] = await rows();
    expect(row.notifiedAt).toBeInstanceOf(Date);
    expect(row.notifyError).toBeNull();
  });

  it("a provider failure loses nothing: the row is kept and names the failure (FR-018)", async () => {
    fetchMock.get("https://api.resend.com").intercept({ method: "POST", path: "/emails" }).reply(500, "nope");
    const mailEnv = { ...withOperators(), RESEND_API_KEY: "re_test" } as Env;
    expect((await request(json(HERO), mailEnv)).status).toBe(200);
    const [row] = await rows();
    expect(row.notifyError).toBe("RESEND_500");
    expect(row.notifiedAt).toBeNull();
  });

  it("without a Resend key the notice is logged and the row reads NO_RESEND_KEY; without operators, NO_OPERATOR_EMAILS (D10, constitution VIII)", async () => {
    expect((await request(json(HERO), withOperators())).status).toBe(200);
    expect((await request(json(HERO))).status).toBe(200);
    const all = await rows();
    expect(all.map((r) => r.notifyError).sort()).toEqual(["NO_OPERATOR_EMAILS", "NO_RESEND_KEY"]);
  });
});

describe("landing-page US2: the creator reads the answer", () => {
  it("an event increments one row per (day, channel, step); a second event increments it again (FR-023, D8)", async () => {
    expect((await event({ step: "visit", channel: "Grupo-ISP" })).status).toBe(200);
    expect((await event({ step: "visit", channel: "Grupo-ISP" })).status).toBe(200);
    expect((await event({ step: "began", channel: "Grupo-ISP" })).status).toBe(200);
    expect((await event({ step: "visit" })).status).toBe(200);
    const all = (await counts()).map(({ day, channel, step, count }) => ({ day, channel, step, count }));
    const today = dayInMexicoCity();
    expect(all).toEqual(
      expect.arrayContaining([
        { day: today, channel: "Grupo-ISP", step: "visit", count: 2 },
        { day: today, channel: "Grupo-ISP", step: "began", count: 1 },
        { day: today, channel: "direct", step: "visit", count: 1 },
      ]),
    );
    expect(all).toHaveLength(3);
  });

  it("`sent` is never accepted from the page; a tag outside the charset counts as direct (D4, D8)", async () => {
    const res = await event({ step: "sent" });
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("VALIDATION_ERROR");
    expect((await event({ step: "visit", channel: "grupo isp!" })).status).toBe(200);
    const [row] = await counts();
    expect(row.channel).toBe("direct");
  });

  it("a counted event leaves a row holding nothing but day, channel, step and count (SC-010)", async () => {
    await event({ step: "visit", channel: "x" });
    const [row] = await counts();
    expect(Object.keys(row).sort()).toEqual(["channel", "count", "day", "id", "step"]);
  });

  it("the 61st event in an hour from one address answers 429 (D9)", async () => {
    for (let i = 0; i < 60; i++) expect((await event({ step: "visit" }, armed())).status).toBe(200);
    expect((await event({ step: "visit" }, armed())).status).toBe(429);
  });

  const operatorEnv = () => withOperators();
  const asOperator = async (path: string) =>
    (await app()).request(path, { headers: { Cookie: await sessionCookieHeader(OPERATOR) } }, operatorEnv());

  it("the operator reads the requests newest first, with a working cursor and the repeated mark (FR-017, D23)", async () => {
    await seedBusiness();
    await request(json({ ...HERO, whatsapp: "55 1111 1111" }), withOperators());
    await request(json({ ...FULL, whatsapp: "55 2222 2222" }), withOperators());
    await request(json({ ...HERO, whatsapp: "55 1111 1111" }), withOperators());

    const first = await asOperator("/platform/landing/requests?limit=2");
    expect(first.status).toBe(200);
    const page1 = accessRequestList.parse((await first.json()).data);
    expect(page1.items).toHaveLength(2);
    expect(page1.items.map((i) => i.whatsapp)).toEqual(["55 1111 1111", "55 2222 2222"]);
    expect(page1.items.map((i) => i.repeated)).toEqual([true, false]);
    expect(page1.items[1]).toMatchObject({ name: "Ana Torres", billingSystem: "wisphub", form: "full", channel: "Grupo-ISP", notifyError: "NO_RESEND_KEY" });
    expect(page1.nextCursor).not.toBeNull();

    const second = await asOperator(`/platform/landing/requests?limit=2&cursor=${encodeURIComponent(page1.nextCursor!)}`);
    const page2 = accessRequestList.parse((await second.json()).data);
    expect(page2.items.map((i) => i.whatsapp)).toEqual(["55 1111 1111"]);
    expect(page2.items[0].repeated).toBe(true);
    expect(page2.nextCursor).toBeNull();
  });

  it("the reads are the operator's alone: 401 without a session, 403 for a member (FR-017, constitution V)", async () => {
    const business = await seedBusiness();
    await seedMember(business, "dueno2@wifiplus.mx", "owner");
    expect((await (await app()).request("/platform/landing/requests", {}, operatorEnv())).status).toBe(401);
    const member = await (await app()).request(
      "/platform/landing/counts",
      { headers: { Cookie: await sessionCookieHeader("dueno2@wifiplus.mx") } },
      operatorEnv(),
    );
    expect(member.status).toBe(403);
    expect((await member.json()).error.code).toBe("NOT_PLATFORM_OPERATOR");
  });

  it("the counts default to the last 30 Mexico City days and honour from / to (FR-024, D8)", async () => {
    await seedBusiness();
    await event({ step: "visit", channel: "Grupo-ISP" });
    await event({ step: "began", channel: "Grupo-ISP" });
    await request(json({ ...FULL }));
    /* A row from before the window, written by hand */
    await drizzle(env.DB).insert(landingCounts).values({ day: "2026-01-01", channel: "viejo", step: "visit", count: 7 });

    const today = dayInMexicoCity();
    const res = await asOperator("/platform/landing/counts");
    const data = landingCountsSchema.parse((await res.json()).data);
    expect(data.to).toBe(today);
    const [ty, tm, td] = today.split("-").map(Number);
    expect(data.from).toBe(new Date(Date.UTC(ty, tm - 1, td - 29)).toISOString().slice(0, 10));
    expect(data.rows).toEqual(
      expect.arrayContaining([
        { day: today, channel: "Grupo-ISP", step: "visit", count: 1 },
        { day: today, channel: "Grupo-ISP", step: "began", count: 1 },
        { day: today, channel: "Grupo-ISP", step: "sent", count: 1 },
      ]),
    );
    expect(data.rows.some((r) => r.channel === "viejo")).toBe(false);

    const old = landingCountsSchema.parse((await (await asOperator("/platform/landing/counts?from=2026-01-01&to=2026-01-31")).json()).data);
    expect(old.rows).toEqual([{ day: "2026-01-01", channel: "viejo", step: "visit", count: 7 }]);

    expect((await asOperator("/platform/landing/counts?from=2026-02-01&to=2026-01-01")).status).toBe(400);
    expect((await asOperator("/platform/landing/counts?from=ayer")).status).toBe(400);
  });
});
