import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { ADMIN } from "../../playwright.config";
import { businessActor, settings } from "./stubs";
/* Constitution III: every fixture below is parsed by the contract it
   stands in for, so a stub cannot serve a shape the server never sends
   (cobros-in-links T047). By path, as stubs.ts reaches them. */
import { paymentRequestsResponse } from "../../apps/api/src/routes/payment-requests/schema";
import {
  createLinkResponse,
  customerDebtResponse,
  customersResponse,
} from "../../apps/api/src/routes/direct-payments/schema";

/* links-on-demand-search US1 — the questions only a browser can answer
   (constitution IV).

   The component layer proves what the page DOES; happy-dom applies no
   stylesheet, reports no layout and has no IntersectionObserver, so
   four things waited for this file: that scrolling really loads the
   next block, that the page holds at 360/768/1280, that the colours
   that actually met pass in both themes, and that Copiar and WhatsApp
   are real tap targets with a focus indicator someone can see.

   ## The measurements (T053)

   Measured 2026-09-22 against the stubbed API with a 500 ms provider
   delay per call — the middle of the 0.4–0.6 s measured live on the
   connected ISP (research.md, 2026-08-18):

   | Criterion | Target | Measured | Ceiling asserted |
   | --- | --- | --- | --- |
   | SC-002 ready to search | 1 s | **0.25 s** | 3 s |
   | SC-003 results after the operator's pause | 3 s | **1.34 s** | 6 s |
   | SC-001 open, find, send | 15 s | **2.41 s** | 20 s |

   All three are inside their targets with room, and SC-003 carries the
   300 ms pause inside it — the operator's wait starts when they stop
   typing, not when the request leaves. SC-002 does not wait on the
   provider at all, which is the point of it: the box takes typing while
   the first block is still in flight.

   The ceilings are deliberately generous and the targets are not
   asserted. A wall-clock target on CI hardware measures the runner's
   mood, not the page — it would flake, and a flaky gate gets disabled,
   which costs more than it protects. What the ceiling catches is a page
   that got SLOW: a second round trip before the box is usable, a search
   that waits on something it should not. The targets stay what they
   are — measurements to take against the real provider before the
   release (quickstart.md). */

const PHONE = { width: 360, height: 740 };
const TABLET = { width: 768, height: 1024 };
const DESKTOP = { width: 1280, height: 900 };

/* What one provider call costs, live: 0.4–0.6 s measured (research.md) */
const PROVIDER_MS = 500;

const row = (n: number, over: Record<string, unknown> = {}) => ({
  channel: "panel",
  usuario: `cliente${n}@wifiplus`,
  wisphubId: 1000 + n,
  customerRef: null,
  label: null,
  askCents: null,
  linkState: null,
  name: `Cliente ${n} Pérez Domínguez`,
  phone: "5551234567",
  /* FR-008: most customers have no link until someone acts */
  hasLink: false,
  url: null,
  waLink: null,
  ...over,
});

/* The count from the operator's own report: «Leo» matched 39 and the
   page showed 10 (2026-09-23) */
const LEO_MATCHES = 39;

const envelope = (data: unknown) => ({
  status: 200,
  contentType: "application/json",
  body: JSON.stringify({ success: true, data }),
});

/* The ISP of the measurements: 6,513 customers, read a block at a time,
   every call paying what a real one pays. */
async function stubLinks(page: Page, opts: { delayMs?: number } = {}) {
  const delay = opts.delayMs ?? PROVIDER_MS;
  await page.route("**/auth/me", (route) => route.fulfill(envelope(businessActor)));
  await page.route("**/settings", (route) => route.fulfill(envelope(settings)));
  await page.route("**/direct-payments/prune-notice", (route) => route.fulfill(envelope(null)));
  await page.route("**/payments/pulse", (route) => route.fulfill(envelope({ registeredAt: null })));

  await page.route("**/direct-payments/customers*", async (route) => {
    if (route.request().resourceType() === "document") return route.fallback();
    const url = new URL(route.request().url());
    const q = url.searchParams.get("q");
    const limit = Number(url.searchParams.get("limit") ?? 20);
    const cursor = url.searchParams.get("cursor");
    await new Promise((r) => setTimeout(r, delay));

    if (q !== null) {
      /* «leo» is the operator's report made reproducible: 39 matches,
         one screenful at a time, every block handing back a cursor
         until they run out. A search walks exactly as a browse does
         (FR-006, D5 amended 2026-09-23). */
      if (q.toLowerCase().startsWith("leo")) {
        const seen = cursor === null ? 0 : Number(atob(cursor).split(":")[1] ?? 0);
        const size = Math.min(limit, LEO_MATCHES - seen);
        return route.fulfill(
          envelope(
            customersResponse.parse({
              results: Array.from({ length: size }, (_, i) =>
                row(seen + i + 1, {
                  name: `Leo ${seen + i + 1} Hernández`,
                  usuario: `leo${seen + i + 1}@wifiplus`,
                }),
              ),
              nextCursor: seen + size < LEO_MATCHES ? btoa(`sq:${seen + limit}:1`) : null,
              matched: LEO_MATCHES,
              total: null,
              wisphub: "ok",
            }),
          ),
        );
      }
      return route.fulfill(
        envelope(
          customersResponse.parse({
            results: [row(1, { name: "María Fernanda López Ruiz", usuario: "maria.lopez@wifiplus" })],
            nextCursor: null,
            matched: 1,
            total: null,
            wisphub: "ok",
          }),
        ),
      );
    }
    /* An ISP with more customers than any page could hold: every block
       hands back another cursor, so "the page never walks the list to
       its end on its own" is a claim the stub can actually falsify. */
    const offset = cursor === null ? 0 : Number(atob(cursor).split(":")[1] ?? 0);
    return route.fulfill(
      envelope(
        customersResponse.parse({
          results: Array.from({ length: limit }, (_, i) => row(offset + i + 1)),
          nextCursor: btoa(`wh:${offset + limit}`),
          matched: null,
          total: 6513,
          wisphub: "ok",
        }),
      ),
    );
  });

  await page.route("**/direct-payments/links", async (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    await new Promise((r) => setTimeout(r, delay));
    return route.fulfill(
      envelope(
        createLinkResponse.parse({
          token: "tok-maria",
          url: "https://link.dev.devoladapago.com/p/tok-maria",
          waLink: "https://wa.me/525551234567?text=hola",
          created: true,
        }),
      ),
    );
  });
}

async function expectNoHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(
    overflow.scrollWidth,
    `page scrolls sideways: ${overflow.scrollWidth}px of content in ${overflow.clientWidth}px`,
  ).toBeLessThanOrEqual(overflow.clientWidth + 1);
}

test.describe("links-on-demand-search US1: the page holds in a real browser", () => {
  test.use({ viewport: DESKTOP });

  test("FR-020: the walk follows the operator, and never runs ahead to the end", async ({ page }) => {
    let blocks = 0;
    await stubLinks(page, { delayMs: 50 });
    await page.route("**/direct-payments/customers*", async (route) => {
      blocks++;
      return route.fallback();
    });
    await page.goto(`${ADMIN}/links`);
    await expect(page.getByText("Cliente 1 Pérez Domínguez")).toBeVisible();

    /* The page asks for what the viewport reaches and then STOPS. It may
       well be more than one block — a sentinel already near the fold is
       a bottom the operator has effectively arrived at — but on a list
       of 6,513 it must be a handful, and it must come to rest. */
    await page.waitForTimeout(800);
    const onArrival = blocks;
    expect(onArrival, "the page walked ahead on its own").toBeLessThanOrEqual(3);
    await page.waitForTimeout(800);
    expect(blocks, "the page kept walking with nobody scrolling").toBe(onArrival);

    /* Scrolling toward the end is what asks for more */
    const before = await page.getByRole("listitem").count();
    await page.getByRole("listitem").last().scrollIntoViewIfNeeded();
    await expect(page.getByRole("listitem")).not.toHaveCount(before, { timeout: 5_000 });
    expect(blocks).toBeGreaterThan(onArrival);
  });

  test("FR-006: a search that matches more than one screen is reachable by scrolling", async ({
    page,
  }) => {
    /* The operator's report, 2026-09-23: «Leo» matched 39, the page
       showed 10, and scrolling produced nothing — the other 29 were
       reachable only by guessing a longer text. D5 used to say a search
       answers one block; it now walks like a browse. */
    await stubLinks(page, { delayMs: 50 });
    await page.goto(`${ADMIN}/links`);
    await expect(page.getByText("Cliente 1 Pérez Domínguez")).toBeVisible();

    await page.getByRole("searchbox").fill("leo");
    await expect(page.getByText("Leo 1 Hernández")).toBeVisible();

    /* While there is more below, the page says so and points DOWN */
    await expect(page.getByText(/más de 39 clientes coinciden con «leo»/i)).toBeVisible();
    await expect(page.getByText(/desplázate para ver más/i)).toBeVisible();

    const firstBlock = await page.getByRole("listitem").count();
    expect(firstBlock).toBeLessThan(39);

    /* Scroll to the end, as an operator looking for their customer
       does, until the walk runs out */
    for (let reach = 0; reach < 8; reach++) {
      const rows = await page.getByRole("listitem").count();
      if (rows >= 39) break;
      await page.getByRole("listitem").last().scrollIntoViewIfNeeded();
      await expect(page.getByRole("listitem")).not.toHaveCount(rows, { timeout: 5_000 });
    }

    /* Every one of the 39 is on screen — including the last, which the
       capped search could never reach */
    await expect(page.getByRole("listitem")).toHaveCount(39);
    await expect(page.getByText("Leo 39 Hernández")).toBeVisible();

    /* And with the walk done there is nothing left to hedge: the count
       stops being a floor and becomes what the search found */
    await expect(page.getByText(/39 clientes coinciden con «leo»/i)).toBeVisible();
    await expect(page.getByText(/desplázate para ver más/i)).toHaveCount(0);
  });

  for (const size of [PHONE, TABLET, DESKTOP]) {
    test(`does not scroll sideways at ${size.width}px`, async ({ page }) => {
      await page.setViewportSize(size);
      await stubLinks(page, { delayMs: 50 });
      await page.goto(`${ADMIN}/links`);
      await expect(page.getByText("Cliente 1 Pérez Domínguez")).toBeVisible();
      await expectNoHorizontalScroll(page);

      /* And with a search on screen, which adds the count line */
      await page.getByRole("searchbox").fill("maria");
      await expect(page.getByText("María Fernanda López Ruiz")).toBeVisible();
      await expectNoHorizontalScroll(page);
    });
  }

  test("FR-016: Copiar and WhatsApp are real tap targets on a phone", async ({ page }) => {
    await page.setViewportSize(PHONE);
    await stubLinks(page, { delayMs: 50 });
    await page.goto(`${ADMIN}/links`);
    await expect(page.getByText("Cliente 1 Pérez Domínguez")).toBeVisible();

    const small = await page.evaluate(() => {
      const bad: string[] = [];
      for (const el of document.querySelectorAll("main button, main a")) {
        const box = el.getBoundingClientRect();
        if (box.width === 0 || box.height === 0) continue;
        if (box.height < 40) bad.push(`${el.textContent?.trim().slice(0, 24)} ${Math.round(box.height)}px`);
      }
      return bad;
    });
    expect(small, "controls under the 40px compact floor").toEqual([]);
  });

  test("every control on the row shows a focus indicator someone can see", async ({ page }) => {
    await stubLinks(page, { delayMs: 50 });
    await page.goto(`${ADMIN}/links`);
    await expect(page.getByText("Cliente 1 Pérez Domínguez")).toBeVisible();

    /* Resting styles first, so an indicator is recognisable as a CHANGE:
       a static card shadow must never pass as a focus style */
    await page.evaluate(() => {
      for (const el of document.querySelectorAll<HTMLElement>("main button, main input")) {
        el.dataset.restingShadow = getComputedStyle(el).boxShadow;
      }
    });

    for (const name of [/copiar/i, /whatsapp/i]) {
      const control = page.getByRole("button", { name }).first();
      await control.focus();
      const visible = await control.evaluate((el) => {
        const s = getComputedStyle(el);
        const outline = s.outlineStyle !== "none" && parseFloat(s.outlineWidth) > 0;
        const ring = s.boxShadow !== "none" && s.boxShadow !== (el as HTMLElement).dataset.restingShadow;
        return { focusVisible: el.matches(":focus-visible"), indicator: outline || ring };
      });
      expect(visible.focusVisible, `${name} is not :focus-visible`).toBe(true);
      expect(visible.indicator, `${name} has no visible focus indicator`).toBe(true);
    }
  });
});

/* Constitution VI: the palette passes on paper (contrast-lint); only a
   browser knows which inks actually met on this screen. */
for (const theme of ["light", "dark"] as const) {
  test.describe(`links-on-demand-search US1: real contrast in ${theme}`, () => {
    test("the page and a row of results have no contrast violations", async ({ page }) => {
      await page.emulateMedia({ colorScheme: theme });
      await stubLinks(page, { delayMs: 50 });
      await page.goto(`${ADMIN}/links`);
      await expect(page.getByText("Cliente 1 Pérez Domínguez")).toBeVisible();

      const results = await new AxeBuilder({ page })
        .withRules(["color-contrast", "target-size"])
        .analyze();
      const readable = results.violations.map(
        (v) => `${v.id}: ${v.nodes.map((n) => n.failureSummary?.split("\n").slice(-1)[0]).join(" | ")}`,
      );
      expect(readable, `Links in ${theme}`).toEqual([]);
    });
  });
}

/* T053: the three the spec asks to be measured. The numbers land in the
   header comment above; what is ASSERTED is the ceiling. */
test.describe("links-on-demand-search: what the operator waits for", () => {
  test.use({ viewport: DESKTOP });

  test("SC-002: ready to search without waiting on the provider", async ({ page }) => {
    await stubLinks(page);
    const opened = Date.now();
    await page.goto(`${ADMIN}/links`);
    /* Ready means the box takes typing — NOT that the rows arrived. The
       first block is a provider call and the operator should never wait
       on it to start searching (FR-001). */
    await page.getByRole("searchbox").fill("ma");
    const ready = Date.now() - opened;

    console.log(`SC-002 ready to search: ${ready}ms (target 1000ms, ceiling 3000ms)`);
    expect(ready, "the page got slow to become usable").toBeLessThan(3_000);
  });

  test("SC-003: a search answers within the ceiling of the operator's pause", async ({ page }) => {
    await stubLinks(page);
    await page.goto(`${ADMIN}/links`);
    await expect(page.getByText("Cliente 1 Pérez Domínguez")).toBeVisible();

    const typed = Date.now();
    await page.getByRole("searchbox").fill("maria");
    await expect(page.getByText("María Fernanda López Ruiz")).toBeVisible();
    const answered = Date.now() - typed;

    /* The 300 ms pause is part of it, deliberately: the operator's wait
       starts when they stop typing, not when the request leaves. */
    console.log(`SC-003 search answered: ${answered}ms (target 3000ms, ceiling 6000ms)`);
    expect(answered, "the search got slow").toBeLessThan(6_000);
  });

  test("SC-001: a customer is found and sent their link inside the ceiling", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await stubLinks(page);
    const opened = Date.now();
    await page.goto(`${ADMIN}/links`);

    await page.getByRole("searchbox").fill("maria");
    await expect(page.getByText("María Fernanda López Ruiz")).toBeVisible();
    await page.getByRole("button", { name: /copiar/i }).first().click();
    /* The BUTTON says Copiado, and so does the mark beside the name —
       FR-022 puts both on the row, so the locator has to name which */
    await expect(page.getByRole("button", { name: /copiado/i })).toBeVisible();
    const sent = Date.now() - opened;

    /* The whole journey the spec measures: open, search, act. Copiar
       rather than WhatsApp because the send leaves the browser. */
    console.log(`SC-001 found and sent: ${sent}ms (target 15000ms, ceiling 20000ms)`);
    expect(sent, "finding and sending got slow").toBeLessThan(20_000);
  });
});

/* ---- cobros-in-links US1 (T040): Por cobrar, in a real browser ----

   The questions the component layer cannot answer about the chip and
   the view (constitution IV): that opening Por cobrar and not scrolling
   reads exactly ONE block (FR-003, SC-003) — which needs layout, because
   the sentinel's position is what decides it — that the page holds at
   360/768/1280 with the chip on it, that the chip is a real 40px target
   on the desktop with a measured focus ring, and that its inks meet in
   both themes. The two new badges are measured in contrast.spec.ts.

   Measured 2026-09-28 against the stubbed API with the same 500 ms per
   provider call as above:

   | Criterion | Target | Measured | Ceiling asserted |
   | --- | --- | --- | --- |
   | SC-002 first Por cobrar block after the press | 3 s | **0.95 s** | 6 s |
   | SC-001 open Links, Por cobrar, WhatsApp | 10 s | **2.29 s** | 20 s |

   The same rule as above: the ceilings catch a page that got slow, and
   the targets are measured against the real provider before release. */

/* A business with more open invoices than any page could hold, one
   block per call, every call paying what a real one pays. `blocks`
   counts what the view asked for. */
async function stubPorCobrar(page: Page, opts: { delayMs?: number } = {}) {
  const delay = opts.delayMs ?? PROVIDER_MS;
  await stubLinks(page, { delayMs: delay });
  const asked = { blocks: 0, debts: 0 };
  await page.route("**/payment-requests*", async (route) => {
    if (route.request().resourceType() === "document") return route.fallback();
    asked.blocks++;
    const url = new URL(route.request().url());
    const limit = Number(url.searchParams.get("limit") ?? 20);
    const cursor = url.searchParams.get("cursor");
    const offset = cursor === null ? 0 : Number(atob(cursor).split(":")[1] ?? 0);
    await new Promise((r) => setTimeout(r, delay));
    return route.fulfill(
      envelope(
        paymentRequestsResponse.parse({
          results: Array.from({ length: limit }, (_, i) => {
            const n = offset + i + 1;
            return {
              externalId: 9000 + n,
              customerUsuario: `deudor${n}@wifiplus`,
              customerName: `Deudor ${n} Ramírez Olvera`,
              amountCents: 49900 + n,
              invoiceDate: "2026-09-01",
              /* Every third one overdue, so Venció and its warning ink are on screen */
              dueDate: n % 3 === 0 ? "2026-09-11" : "2099-01-11",
              periodCents: 49900,
              carriedCents: n % 3 === 0 ? 29900 : 0,
              period: "Periodo del 1/Sept./2026 al 30/Sept./2026",
            };
          }),
          /* The stub's own cursor: the offset the next block starts at */
          nextCursor: btoa(`inv:${offset + limit}`),
          total: 193,
          integration: "ok",
        }),
      ),
    );
  });
  await page.route("**/direct-payments/customers/debt*", (route) => {
    asked.debts++;
    const usuario = new URL(route.request().url()).searchParams.get("usuario") ?? "";
    return route.fulfill(
      envelope(
        customerDebtResponse.parse({
          usuario,
          state: "owes",
          totalCents: 29900,
          invoiceCents: 0,
          carriedBalanceCents: 29900,
          invoices: [],
        }),
      ),
    );
  });
  return asked;
}

test.describe("cobros-in-links US1: Por cobrar holds in a real browser", () => {
  test.use({ viewport: DESKTOP });

  test("FR-003 / SC-003: pressing Por cobrar and not scrolling reads exactly one block; scrolling reads the next", async ({ page }) => {
    const asked = await stubPorCobrar(page, { delayMs: 50 });
    await page.goto(`${ADMIN}/links`);
    await expect(page.getByText("Cliente 1 Pérez Domínguez")).toBeVisible();

    await page.getByRole("tab", { name: /por cobrar/i }).click();
    await expect(page.getByText("Deudor 1 Ramírez Olvera")).toBeVisible();
    await expect(page.getByText("193 facturas abiertas")).toBeVisible();
    await page.waitForTimeout(1_000);
    expect(asked.blocks, "the view read ahead with nobody scrolling").toBe(1);

    const before = await page.getByRole("list", { name: /clientes con facturas abiertas/i }).getByRole("listitem").count();
    await page.getByRole("list", { name: /clientes con facturas abiertas/i }).getByRole("listitem").last().scrollIntoViewIfNeeded();
    await page.mouse.wheel(0, 600);
    await expect(
      page.getByRole("list", { name: /clientes con facturas abiertas/i }).getByRole("listitem"),
    ).not.toHaveCount(before, { timeout: 5_000 });
    expect(asked.blocks).toBe(2);
  });

  /* cobros-in-links SC-009 (T049): every result costs a debt read of two
     provider calls, so a block loaded ahead of the scroll is debt read for
     rows nobody reached. Like the list (SC-003), the search reads one
     block until the operator scrolls. */
  test("SC-009: an unscrolled Por cobrar search reads its first block's debts, and nothing past it", async ({ page }) => {
    const asked = await stubPorCobrar(page, { delayMs: 50 });
    let searchBlocks = 0;
    await page.route("**/direct-payments/customers*", async (route) => {
      if (new URL(route.request().url()).searchParams.get("q") !== null) searchBlocks++;
      return route.fallback();
    });
    await page.goto(`${ADMIN}/links?view=receivables`);
    await expect(page.getByText("Deudor 1 Ramírez Olvera")).toBeVisible();

    /* «leo» matches 39, one screenful at a time */
    await page.getByRole("searchbox").fill("leo");
    await expect(page.getByText("Leo 1 Hernández")).toBeVisible();
    const firstBlock = await page.getByRole("listitem").count();
    expect(firstBlock).toBeLessThan(39);
    await expect.poll(() => asked.debts).toBe(firstBlock);
    await page.waitForTimeout(1_000);
    expect(searchBlocks, "the search read ahead with nobody scrolling").toBe(1);
    expect(asked.debts, "debt was read for rows past the first block").toBe(firstBlock);

    /* Scrolling toward the end reads the next block, and only then its debts */
    await page.getByRole("listitem").last().scrollIntoViewIfNeeded();
    await page.mouse.wheel(0, 600);
    await expect(page.getByRole("listitem")).not.toHaveCount(firstBlock, { timeout: 5_000 });
    expect(searchBlocks).toBe(2);
    await expect.poll(() => asked.debts).toBeGreaterThan(firstBlock);
  });

  for (const size of [PHONE, TABLET, DESKTOP]) {
    test(`the chip and Por cobrar do not scroll sideways at ${size.width}px`, async ({ page }) => {
      await page.setViewportSize(size);
      await stubPorCobrar(page, { delayMs: 50 });
      await page.goto(`${ADMIN}/links?view=receivables`);
      await expect(page.getByText("Deudor 1 Ramírez Olvera")).toBeVisible();
      await expectNoHorizontalScroll(page);

      /* A row opened, with its period and saldo anterior */
      await page.getByRole("button", { name: /deudor 3 ramírez/i }).click();
      await expect(page.getByText(/incluye saldo anterior/i).first()).toBeVisible();
      await expectNoHorizontalScroll(page);

      /* A search, with each result's debt on its row */
      await page.getByRole("searchbox").fill("maria");
      await expect(page.getByText("María Fernanda López Ruiz")).toBeVisible();
      await expect(page.getByText("$299.00").first()).toBeVisible();
      await expectNoHorizontalScroll(page);
    });
  }

  test("D14: the chip is a 40px compact target on the desktop and 44px under a finger", async ({ page }) => {
    await stubPorCobrar(page, { delayMs: 50 });
    await page.goto(`${ADMIN}/links?view=receivables`);
    await expect(page.getByText("Deudor 1 Ramírez Olvera")).toBeVisible();
    for (const tab of await page.getByRole("tab").all()) {
      const box = await tab.boundingBox();
      expect(Math.round(box!.height), "a chip under the compact 40px").toBe(40);
    }

    await page.setViewportSize(PHONE);
    for (const tab of await page.getByRole("tab").all()) {
      const box = await tab.boundingBox();
      expect(box!.height, "a chip under 44px on a phone").toBeGreaterThanOrEqual(44);
    }
  });

  test("the chip shows a focus indicator someone can see", async ({ page }) => {
    await stubPorCobrar(page, { delayMs: 50 });
    await page.goto(`${ADMIN}/links`);
    await expect(page.getByText("Cliente 1 Pérez Domínguez")).toBeVisible();

    const chip = page.getByRole("tab", { name: /todos/i });
    await chip.evaluate((el) => ((el as HTMLElement).dataset.restingShadow = getComputedStyle(el).boxShadow));
    await chip.focus();
    const visible = await chip.evaluate((el) => {
      const s = getComputedStyle(el);
      const outline = s.outlineStyle !== "none" && parseFloat(s.outlineWidth) > 0;
      const ring = s.boxShadow !== "none" && s.boxShadow !== (el as HTMLElement).dataset.restingShadow;
      return { focusVisible: el.matches(":focus-visible"), indicator: outline || ring };
    });
    expect(visible.focusVisible, "the chip is not :focus-visible").toBe(true);
    expect(visible.indicator, "the chip has no visible focus indicator").toBe(true);

    /* The arrow key moves between the two views, as tabs do */
    await page.keyboard.press("ArrowRight");
    await expect(page.getByRole("tab", { name: /por cobrar/i })).toBeFocused();
    await expect(page.getByText("Deudor 1 Ramírez Olvera")).toBeVisible();
  });
});

for (const theme of ["light", "dark"] as const) {
  test.describe(`cobros-in-links US1: Por cobrar's real contrast in ${theme}`, () => {
    test("the chip, the list and a search with its debts have no contrast violations", async ({ page }) => {
      await page.emulateMedia({ colorScheme: theme });
      await stubPorCobrar(page, { delayMs: 50 });
      await page.goto(`${ADMIN}/links?view=receivables`);
      await expect(page.getByText("Deudor 1 Ramírez Olvera")).toBeVisible();
      await page.getByRole("button", { name: /deudor 3 ramírez/i }).click();
      await expect(page.getByText(/incluye saldo anterior/i).first()).toBeVisible();

      const analyze = async () =>
        (await new AxeBuilder({ page }).withRules(["color-contrast", "target-size"]).analyze()).violations.map(
          (v) => `${v.id}: ${v.nodes.map((n) => n.failureSummary?.split("\n").slice(-1)[0]).join(" | ")}`,
        );
      expect(await analyze(), `Por cobrar in ${theme}`).toEqual([]);

      await page.getByRole("searchbox").fill("maria");
      await expect(page.getByText("$299.00").first()).toBeVisible();
      expect(await analyze(), `Por cobrar search in ${theme}`).toEqual([]);
    });
  });
}

test.describe("cobros-in-links: what the operator waits for in Por cobrar", () => {
  test.use({ viewport: DESKTOP });

  test("SC-002: the first Por cobrar block is on screen within the ceiling", async ({ page }) => {
    await stubPorCobrar(page);
    await page.goto(`${ADMIN}/links`);
    await expect(page.getByRole("tab", { name: /por cobrar/i })).toBeVisible();

    const pressed = Date.now();
    await page.getByRole("tab", { name: /por cobrar/i }).click();
    await expect(page.getByText("Deudor 1 Ramírez Olvera")).toBeVisible();
    const shown = Date.now() - pressed;

    console.log(`SC-002 first Por cobrar block: ${shown}ms (target 3000ms, ceiling 6000ms)`);
    expect(shown, "the first block got slow").toBeLessThan(6_000);
  });

  test("SC-001: from opening Links to WhatsApp on a Por cobrar row, inside the ceiling", async ({ page, context }) => {
    await context.route("https://wa.me/**", (route) => route.fulfill({ status: 200, body: "" }));
    await stubPorCobrar(page);
    const opened = Date.now();
    await page.goto(`${ADMIN}/links`);

    await page.getByRole("tab", { name: /por cobrar/i }).click();
    await page.getByRole("button", { name: /deudor 1 ramírez/i }).click();
    const popup = context.waitForEvent("page");
    await page.getByRole("button", { name: /whatsapp/i }).first().click();
    await popup;
    await expect(page.getByText("Enviado").first()).toBeVisible();
    const sent = Date.now() - opened;

    console.log(`SC-001 open Links to WhatsApp on Por cobrar: ${sent}ms (target 10000ms, ceiling 20000ms)`);
    expect(sent, "sending from Por cobrar got slow").toBeLessThan(20_000);
  });
});
