import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { fetchMock } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { payments } from "../src/db/schema";
import { sweepDirectPayments } from "../src/direct-payments/validation";
import { transferList } from "../src/routes/v1/schema";
import {
  collectingCtx,
  db,
  mockApiCep,
  payerPost,
  seedApiBusiness,
  testEnv,
  TRANSFER,
  v1,
} from "./collections-api-helpers";

/* automated-collections-api US4 — the business reconciles the transfers
   it received (spec scenarios 1–4, FR-020 – FR-023, research D16,
   contracts/public-api.md). Every business is a gym with NO integration
   row (research D5). Verdicts are reached through the real path; only
   the verdict moment is then moved to the day a scenario needs, because
   the validation schedule gives up after six hours and a sweep three
   days ahead would expire a claim rather than confirm it. */

beforeAll(() => {
  fetchMock.activate();
  fetchMock.disableNetConnect();
});
afterEach(() => fetchMock.assertNoPendingInterceptors());

const FEE = 1500;
const ASK = 49900;
const minutes = (n: number) => n * 60_000;
const isoDay = (d: Date) => d.toISOString().slice(0, 10);
/* A range that holds "now" whatever the business's wall clock says the
   day is — the UTC date and the Mexico City date part ways every evening */
const aroundNow = () => `from=${isoDay(new Date(Date.now() - 86_400_000))}&to=${isoDay(new Date(Date.now() + 86_400_000))}`;

async function arrange(overrides: Parameters<typeof seedApiBusiness>[0] = {}) {
  const { key, business } = await seedApiBusiness({ serviceFeeCents: FEE, ...overrides });
  const link = (await v1(key, "POST", "/payment-links", { customerRef: "CLI-4471", askCents: ASK, label: "Ana Ruiz" })).body.data!;
  return { key, business, link, token: String(link.url).split("/p/")[1] };
}

/* A transfer confirmed through the real path, its verdict moment then
   placed where the scenario needs it */
async function confirmAt(token: string, trackingKey: string, when: Date, amountCents = ASK + FEE): Promise<string> {
  mockApiCep({ cep: { amountCents, trackingKey } });
  const { ctx, settled } = collectingCtx();
  const paid = await payerPost(token, TRANSFER(trackingKey, amountCents), testEnv, ctx);
  expect(paid.body, JSON.stringify(paid.body)).toMatchObject({ success: true });
  /* two-eyes-receipt D4: the answer does not wait for the provider any
     more — it is `validating` while the attempt runs past it under
     `waitUntil`. The verdict is on the row once that work has settled. */
  expect(paid.body.data!.status).toBe("validating");
  await settled();
  const id = String(paid.body.data!.directPaymentId);
  const [row] = await db().select().from(payments).where(eq(payments.id, id));
  expect(["confirmed", "partial"]).toContain(row.status);
  await db().update(payments).set({ confirmedAt: when }).where(eq(payments.id, id));
  return id;
}

const transfers = async (key: string, query: string) => {
  const res = await v1(key, "GET", `/transfers?${query}`);
  expect(res.status).toBe(200);
  return transferList.parse(res.body.data);
};

describe("scenario 1: a date range returns exactly its payments, with their facts", () => {
  it("three days, two asked for — each row with reference, amount received, match, folio and verdict moment, oldest first", async () => {
    const { key, token } = await arrange();
    /* mid-day in Mexico City, so no day boundary is near */
    const a = await confirmAt(token, "TRACK000DAY14", new Date("2026-09-14T18:00:00Z"));
    const b = await confirmAt(token, "TRACK000DAY15", new Date("2026-09-15T18:00:00Z"));
    const c = await confirmAt(token, "TRACK000DAY16", new Date("2026-09-16T18:00:00Z"), 40000);

    const page = await transfers(key, "from=2026-09-15&to=2026-09-16");
    expect(page.nextCursor).toBeNull();
    expect(page.transfers.map((t) => t.id)).toEqual([b, c]);
    expect(page.transfers[0]).toMatchObject({
      id: b,
      customerRef: "CLI-4471",
      status: "confirmed",
      askedCents: ASK,
      receivedCents: ASK + FEE,
      match: "exact",
      confirmedAt: Date.parse("2026-09-15T18:00:00Z"),
      isTest: false,
    });
    expect(page.transfers[0].folio).toMatch(/^DV-/);
    /* `partial` is the row's word; `short` is the class (D17) */
    expect(page.transfers[1]).toMatchObject({ id: c, status: "partial", match: "short", receivedCents: 40000 });

    const single = await transfers(key, "from=2026-09-14&to=2026-09-14");
    expect(single.transfers.map((t) => t.id)).toEqual([a]);
    expect((await transfers(key, "from=2026-09-17&to=2026-09-30")).transfers).toEqual([]);
  });

  it("a range that runs backwards, a missing end or a bad day names the field (FR-025)", async () => {
    const { key } = await arrange();
    for (const [query, field] of [
      ["from=2026-09-16&to=2026-09-15", "to"],
      ["from=2026-09-15", "to"],
      ["from=15/09/2026&to=2026-09-16", "from"],
      ["from=2026-09-15&to=2026-09-16&limit=0", "limit"],
    ]) {
      const res = await v1(key, "GET", `/transfers?${query}`);
      expect(res.status).toBe(400);
      expect(res.body.error).toMatchObject({ code: "VALIDATION_ERROR", retryable: false });
      expect(res.body.error!.message).toMatch(new RegExp(`^${field}`));
    }
  });
});

describe("scenario 2: a walk through the pages sees every payment exactly once (FR-020)", () => {
  it("a payment confirmed mid-walk lands on a later page; two verdicts in the same instant are told apart by id", async () => {
    const { key, token } = await arrange();
    /* a second customer, because one link accepts only so many attempts
       an hour (payments-and-classes D9) — and a history spans customers */
    const second = (await v1(key, "POST", "/payment-links", { customerRef: "CLI-9000", askCents: ASK })).body.data!;
    const tokens = [token, token, String(second.url).split("/p/")[1], String(second.url).split("/p/")[1], token];
    const base = Date.now() - minutes(30);
    const ids = [];
    for (const [i, key_] of ["TRACK000P1", "TRACK000P2", "TRACK000P3", "TRACK000P4", "TRACK000P5"].entries()) {
      /* P2 and P3 share one verdict moment on purpose */
      ids.push(await confirmAt(tokens[i], key_, new Date(base + minutes(i === 2 ? 1 : i))));
    }
    const range = aroundNow();

    const seen: string[] = [];
    let page = await transfers(key, `${range}&limit=2`);
    seen.push(...page.transfers.map((t) => t.id));
    expect(page.nextCursor).toEqual(expect.any(String));

    /* the caller is between pages when a sixth transfer is confirmed */
    const sixth = await confirmAt(tokens[2], "TRACK000P6", new Date());

    while (page.nextCursor) {
      page = await transfers(key, `${range}&limit=2&cursor=${page.nextCursor}`);
      seen.push(...page.transfers.map((t) => t.id));
    }
    expect(seen).toHaveLength(6);
    expect(new Set(seen).size).toBe(6);
    /* P2 and P3 share a moment: id breaks the tie, the same way every time */
    expect(seen).toEqual([ids[0], ...[ids[1], ids[2]].sort(), ids[3], ids[4], sixth]);
  });

  it("a cursor this history never handed out is refused, not guessed", async () => {
    const { key } = await arrange();
    const res = await v1(key, "GET", "/transfers?from=2026-09-01&to=2026-09-30&cursor=page-2");
    expect(res.status).toBe(400);
    expect(res.body.error!.message).toMatch(/^cursor/);
  });
});

describe("scenario 3: 'Tuesday' is the business's Tuesday (FR-021)", () => {
  it("the same instant is the 14th in Hermosillo and the 15th in Mexico City, and each business's range says so", async () => {
    /* 06:30Z: 23:30 on the 14th at UTC−7, 00:30 on the 15th at UTC−6 */
    const instant = new Date("2026-09-15T06:30:00Z");
    const sonora = await arrange({ timezone: "America/Hermosillo", email: "sonora@devolada.app" });
    const centre = await arrange({ timezone: "America/Mexico_City" });
    const inSonora = await confirmAt(sonora.token, "TRACK000SONORA", instant);
    const inCentre = await confirmAt(centre.token, "TRACK000CENTRE", instant);

    expect((await transfers(sonora.key, "from=2026-09-15&to=2026-09-15")).transfers).toEqual([]);
    expect((await transfers(sonora.key, "from=2026-09-14&to=2026-09-14")).transfers.map((t) => t.id)).toEqual([inSonora]);

    expect((await transfers(centre.key, "from=2026-09-14&to=2026-09-14")).transfers).toEqual([]);
    expect((await transfers(centre.key, "from=2026-09-15&to=2026-09-15")).transfers.map((t) => t.id)).toEqual([inCentre]);
  });
});

describe("scenario 4 / D16: unapplied money is visible; a deposit Devolada never saw is not (FR-022, FR-023)", () => {
  it("a transfer validated after another closed the link is in the history as `unapplied`, beside the one that paid", async () => {
    const { key } = await arrange();
    const inAnHour = Date.now() + 3_600_000;
    const oneTime = (await v1(key, "POST", "/payment-links", { customerRef: "INV-9", askCents: 120000, mode: "one_time", expiresAt: inAnHour })).body.data!;
    const token = String(oneTime.url).split("/p/")[1];

    mockApiCep({ status: "pending" });
    const first = await payerPost(token, TRANSFER("TRACK000FIRST", 120000 + FEE));
    expect(first.body.data).toMatchObject({ status: "validating" });
    mockApiCep({ cep: { amountCents: 120000 + FEE, trackingKey: "TRACK000SECOND" } });
    const second = await payerPost(token, TRANSFER("TRACK000SECOND", 120000 + FEE));
    expect(second.body.data).toMatchObject({ status: "confirmed" });
    mockApiCep({ cep: { amountCents: 120000 + FEE, trackingKey: "TRACK000FIRST" } });
    expect(await sweepDirectPayments(testEnv, new Date(Date.now() + minutes(3)))).toMatchObject({ unapplied: 1 });

    const page = await transfers(key, aroundNow());
    const byId = Object.fromEntries(page.transfers.map((t) => [t.id, t]));
    expect(byId[String(second.body.data!.directPaymentId)]).toMatchObject({ customerRef: "INV-9", status: "confirmed", match: "exact", receivedCents: 120000 + FEE });
    expect(byId[String(first.body.data!.directPaymentId)]).toMatchObject({ customerRef: "INV-9", status: "unapplied", match: "over", receivedCents: 120000 + FEE, folio: null });
    expect(page.transfers).toHaveLength(2);
  });

  it("only money Banxico confirmed is history: a claim still validating and a contradicted one are not — and an ask of zero cannot exist on this door", async () => {
    const { key, token } = await arrange();
    const paid = await confirmAt(token, "TRACK000REAL", new Date());
    mockApiCep({ status: "pending" });
    const validating = await payerPost(token, TRANSFER("TRACK000WAIT", ASK + FEE));
    expect(validating.body.data).toMatchObject({ status: "validating" });
    mockApiCep({ status: "invalid", cepStatus: "DEVUELTO" });
    const invalid = await payerPost(token, TRANSFER("TRACK000DEVUE", ASK + FEE));
    expect(invalid.body.data).toMatchObject({ status: "invalid" });

    const page = await transfers(key, aroundNow());
    expect(page.transfers.map((t) => t.id)).toEqual([paid]);

    /* D16's second cause — an ask of zero — is refused at creation
       (FR-010) and at re-pricing, so on this door `unapplied` has one
       cause: the link had closed. Nothing else claims to be a deposit. */
    const zero = await v1(key, "POST", "/payment-links", { customerRef: "CLI-0", askCents: 0 });
    expect(zero.status).toBe(400);
    expect(zero.body.error!.message).toMatch(/askCents/);
  });

  it("another business's credential sees none of it", async () => {
    const { token } = await arrange();
    await confirmAt(token, "TRACK000MINE", new Date());
    const other = await seedApiBusiness({ email: "otro@devolada.app" });
    expect((await transfers(other.key, aroundNow())).transfers).toEqual([]);
  });
});
