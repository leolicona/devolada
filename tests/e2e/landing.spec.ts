import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { LANDING } from "../../playwright.config";
import { CLAIMS } from "../../apps/landing/src/content/claims";
import { CONTACT_EMAIL } from "../../apps/landing/src/content/legal";
import { holdApiRoute, stubLandingApi, stubLandingRefusal } from "./stubs";

/* landing-page US1 (FR-003, FR-004, FR-013, FR-016, FR-019–FR-021, FR-028–
   FR-030; SC-002, SC-006, SC-008, SC-010; research D15, D16, D18) and
   landing-page US3 (FR-031): the page in a real browser, on the dark palette
   it renders, against a stubbed API. Layout, contrast, targets, focus and
   weight are questions no simulated DOM can answer (constitution IV). */

const PHONE = { width: 360, height: 740 };
const WIDTHS = [
  { name: "phone", width: 360, height: 740 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "desktop", width: 1280, height: 900 },
] as const;

async function open(page: Page, query = "") {
  await stubLandingApi(page);
  await page.goto(`${LANDING}/${query}`);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("sin la talacha");
}

async function expectNoHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(
    overflow.scrollWidth,
    `page scrolls sideways: ${overflow.scrollWidth}px in ${overflow.clientWidth}px`,
  ).toBeLessThanOrEqual(overflow.clientWidth + 1);
}

test.describe("landing-page US1: the page reads on a phone, dark, and takes one action", () => {
  test.use({ viewport: PHONE });

  test("dark for everyone, one link to the product and it is sign-in (FR-004, D15)", async ({ page }) => {
    await open(page);
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await expect(page.locator("html")).toHaveAttribute("lang", "es-MX");
    await expect(page.locator('a[href*="signup"], a[href*="registro"], a[href*="crear-cuenta"]')).toHaveCount(0);
    const login = page.locator("header a[data-login]");
    await expect(login).toHaveAttribute("href", /^https:\/\/app\.[^/]+\/login$/);
    await expect(login).toHaveText("Entrar");
    /* The only other links to the product's hosts are none: everything else is on the page */
    const external = await page.locator('a[href^="http"]:not([data-login])').evaluateAll((as) => as.map((a) => (a as HTMLAnchorElement).href));
    expect(external.filter((h) => !h.startsWith(LANDING))).toEqual([]);
  });

  test("the first screen holds the eyebrow, the headline, the subhead and the form's button at 360×740 (FR-003)", async ({ page }) => {
    await open(page);
    const first = page.locator("main > section:first-of-type");
    await expect(first).toHaveAttribute("id", "inicio");
    await expect(first.getByText("Cobros por SPEI para ISPs en México")).toBeVisible();
    await expect(first.getByRole("heading", { level: 1 })).toHaveText("Cobrar por transferencia, sin la talacha.");
    await expect(first.getByText("Banxico", { exact: false }).first()).toBeVisible();
    const button = first.locator('form[data-form="hero"] button[type="submit"]');
    const box = await button.boundingBox();
    expect(box, "the hero form's button has a box").not.toBeNull();
    expect(box!.y + box!.height, "the button ends inside a 740px viewport").toBeLessThanOrEqual(PHONE.height);
    expect(await page.evaluate(() => parseFloat(getComputedStyle(document.body).fontSize))).toBe(16);
  });

  for (const size of WIDTHS) {
    test(`no sideways scroll at ${size.name} (FR-029)`, async ({ page }) => {
      await page.setViewportSize({ width: size.width, height: size.height });
      await open(page);
      await expectNoHorizontalScroll(page);
    });
  }

  test("every target is at least 48 px and both send buttons are 64 (FR-029)", async ({ page }) => {
    await open(page);
    const small = await page.locator("a, button, input, select").evaluateAll((els) =>
      els
        .filter((el) => (el as HTMLElement).offsetParent !== null && !el.closest('[aria-hidden="true"]'))
        .map((el) => ({ tag: el.tagName, text: (el.textContent ?? (el as HTMLInputElement).name ?? "").trim().slice(0, 40), h: el.getBoundingClientRect().height }))
        .filter((t) => t.h < 48),
    );
    expect(small, "targets under 48px").toEqual([]);
    const buttons = page.locator('form[data-form] button[type="submit"]');
    await expect(buttons).toHaveCount(2);
    for (const box of await buttons.evaluateAll((els) => els.map((el) => el.getBoundingClientRect().height))) expect(box).toBe(64);
  });

  test("axe finds no contrast or target violation on the dark palette (FR-028, SC-006)", async ({ page }) => {
    await open(page);
    const results = await new AxeBuilder({ page }).withRules(["color-contrast", "target-size"]).analyze();
    const readable = results.violations.map(
      (v) => `${v.id}: ${v.nodes.map((n) => n.failureSummary?.split("\n").slice(-1)[0]).join(" | ")}`,
    );
    expect(readable).toEqual([]);
  });

  test("the keyboard reaches the sign-in link and both forms, each stop with a visible focus (FR-028)", async ({ page }) => {
    await open(page);
    const wanted = ["a[data-login]", '#whatsapp-hero', 'form[data-form="hero"] button[type="submit"]', "#whatsapp-full", "#name-full", "#system-full", 'form[data-form="full"] button[type="submit"]'];
    const reached = new Set<string>();
    let withoutIndicator: string[] = [];
    for (let i = 0; i < 40 && reached.size < wanted.length; i++) {
      await page.keyboard.press("Tab");
      const stop = await page.evaluate((selectors) => {
        const el = document.activeElement as HTMLElement | null;
        if (!el || el === document.body) return null;
        const s = getComputedStyle(el);
        const indicator = (s.outlineStyle !== "none" && parseFloat(s.outlineWidth) > 0) || s.boxShadow !== "none";
        return { match: selectors.find((sel) => el.matches(sel)) ?? null, focusVisible: el.matches(":focus-visible"), indicator, label: (el.textContent ?? el.id).trim().slice(0, 30) };
      }, wanted);
      if (!stop) break;
      if (stop.match) reached.add(stop.match);
      if (stop.focusVisible && !stop.indicator) withoutIndicator.push(stop.label);
    }
    expect([...reached].sort()).toEqual([...wanted].sort());
    expect(withoutIndicator, "stops focused without a visible indicator").toEqual([]);
    /* The honeypot is never a stop */
    expect(reached.has('input[name="website"]')).toBe(false);
  });

  test("the customer's steps use the payer page's words, and every claim is on the page once (FR-006, FR-013, SC-008)", async ({ page }) => {
    await open(page);
    for (const words of ["Haz tu transferencia", "Envía tu comprobante", "Tu pago fue registrado"]) {
      await expect(page.getByText(words, { exact: true }).first()).toBeVisible();
    }
    const texts = await page.locator("[data-claim]").evaluateAll((els) =>
      els.map((el) => ({ id: el.getAttribute("data-claim"), text: (el.textContent ?? "").replace(/\s+/g, " ").trim() })),
    );
    expect(texts.map((t) => t.id).sort()).toEqual(CLAIMS.map((c) => c.id).sort());
    for (const c of CLAIMS) {
      const found = texts.filter((t) => t.id === c.id);
      expect(found, `claim ${c.id} rendered once`).toHaveLength(1);
      expect(found[0].text, `claim ${c.id} says what the list says`).toBe(c.text);
    }
    /* Echoes are not claims: a tile never carries a claim's full text */
    const echoes = await page.locator("[data-claim-echo]").evaluateAll((els) => els.map((el) => (el.textContent ?? "").trim()));
    for (const e of echoes) expect(CLAIMS.some((c) => c.text === e), `echo "${e}" is not a claim's text`).toBe(false);
    /* FR-007: the supported system appears on the page only as an answer in
       the form's billing-system question — never in a sentence */
    const vendor = await page.evaluate(() =>
      Array.from(document.body.querySelectorAll("*"))
        .filter((el) => el.children.length === 0 && /wisphub/i.test(el.textContent ?? ""))
        .map((el) => el.tagName),
    );
    expect(vendor).toEqual(["OPTION"]);
  });

  test("a missing or malformed WhatsApp is named next to the field, and what was typed stays (FR-020)", async ({ page }) => {
    await open(page);
    const hero = page.locator('form[data-form="hero"]');
    await hero.locator('button[type="submit"]').click();
    const error = hero.locator('[data-field="whatsapp"] [data-error]');
    await expect(error).toBeVisible();
    await expect(error).toContainText("Escribe tu WhatsApp con lada");
    await expect(hero.locator('input[name="whatsapp"]')).toHaveAttribute("aria-invalid", "true");
    await expect(hero.locator('input[name="whatsapp"]')).toBeFocused();

    await hero.locator('input[name="whatsapp"]').fill("12");
    await hero.locator('button[type="submit"]').click();
    await expect(error).toBeVisible();
    await expect(hero.locator('input[name="whatsapp"]')).toHaveValue("12");
    await expect(hero.locator('[data-outcome-for="received"]')).toBeHidden();
  });

  test("the hero form sends the WhatsApp alone; the closing form's name and system are optional (FR-015, FR-016)", async ({ page }) => {
    const sent: Record<string, string>[] = [];
    page.on("request", (r) => {
      if (r.url().endsWith("/landing/requests") && r.method() === "POST") sent.push(JSON.parse(r.postData() ?? "{}"));
    });
    await open(page);
    const hero = page.locator('form[data-form="hero"]');
    await hero.locator('input[name="whatsapp"]').fill("55 1234 5678");
    await hero.locator('button[type="submit"]').click();
    await expect(hero.locator('[data-outcome-for="received"]')).toBeVisible();
    await expect(hero.locator('[data-outcome-for="received"]')).toContainText("un día hábil");
    /* Received asks for nothing further */
    await expect(hero.locator("[data-fields]")).toBeHidden();

    const full = page.locator('form[data-form="full"]');
    await expect(full).toHaveAttribute("id", "solicitar");
    await full.locator('input[name="whatsapp"]').fill("55 9876 5432");
    await full.locator('button[type="submit"]').click();
    await expect(full.locator('[data-outcome-for="received"]')).toBeVisible();

    expect(sent).toEqual([
      expect.objectContaining({ whatsapp: "55 1234 5678", form: "hero", channel: "", website: "" }),
      expect.objectContaining({ whatsapp: "55 9876 5432", form: "full", name: "", billingSystem: "", channel: "" }),
    ]);
    expect(sent[0]).not.toHaveProperty("name");
  });

  for (const [code, status, words] of [
    ["REQUEST_REFUSED", 400, "No pudimos aceptar esta solicitud"],
    ["TOO_MANY_REQUESTS", 429, "varias solicitudes desde tu conexión"],
  ] as const) {
    test(`${code} renders its outcome with the contact address (FR-019)`, async ({ page }) => {
      await open(page);
      await stubLandingRefusal(page, code, status);
      const hero = page.locator('form[data-form="hero"]');
      await hero.locator('input[name="whatsapp"]').fill("55 1234 5678");
      await hero.locator('button[type="submit"]').click();
      const outcome = hero.locator(`[data-outcome-for="${code}"]`);
      await expect(outcome).toBeVisible();
      await expect(outcome).toContainText(words);
      await expect(outcome).toContainText(CONTACT_EMAIL);
      /* A refusal keeps the fields: the person can try again */
      await expect(hero.locator("[data-fields]")).toBeVisible();
    });
  }

  test("when the API is unreachable the page says so with the contact address, and still reads in full (FR-021, SC-009)", async ({ page }) => {
    await open(page);
    await page.route("**/landing/requests", (route) => (route.request().resourceType() === "document" ? route.fallback() : route.abort()));
    const hero = page.locator('form[data-form="hero"]');
    await hero.locator('input[name="whatsapp"]').fill("55 1234 5678");
    await hero.locator('button[type="submit"]').click();
    const outcome = hero.locator('[data-outcome-for="unavailable"]');
    await expect(outcome).toBeVisible();
    await expect(outcome).toContainText("No pudimos enviar tu WhatsApp");
    await expect(outcome).toContainText(CONTACT_EMAIL);
    await expect(page.getByText("Lo que seguro te preguntas")).toBeVisible();
  });

  test("a first visit transfers under 500 KB (SC-002)", async ({ browser }) => {
    const context = await browser.newContext({ viewport: PHONE });
    const page = await context.newPage();
    const sizes: Promise<number>[] = [];
    page.on("response", (r) => {
      if (!r.url().startsWith(LANDING)) return;
      sizes.push(r.body().then((b) => b.byteLength).catch(() => 0));
    });
    await stubLandingApi(page);
    await page.goto(`${LANDING}/`, { waitUntil: "networkidle" });
    const total = (await Promise.all(sizes)).reduce((a, b) => a + b, 0);
    expect(total, `first visit weighs ${Math.round(total / 1024)} KB`).toBeLessThan(500 * 1024);
    await context.close();
  });

  test("with scripts off every section, every claim and both forms are there and post to the API (FR-030)", async ({ browser }) => {
    const context = await browser.newContext({ viewport: PHONE, javaScriptEnabled: false });
    const page = await context.newPage();
    await page.goto(`${LANDING}/`);
    /* Hero, Proof, PaymentFlow, Benefits, HowItWorks, System, Doubts, Pricing, Arranca hoy */
    await expect(page.locator("main > section")).toHaveCount(9);
    expect(await page.locator("[data-claim]").count()).toBe(CLAIMS.length);
    for (const variant of ["hero", "full"]) {
      const form = page.locator(`form[data-form="${variant}"][method="post"][enctype="application/x-www-form-urlencoded"]`);
      await expect(form).toHaveAttribute("action", /\/landing\/requests$/);
      await expect(form.locator('input[name="whatsapp"][required][pattern]')).toHaveCount(1);
      await expect(form.locator(`input[name="form"][value="${variant}"]`)).toHaveCount(1);
      await expect(form.locator('input[name="channel"]')).toHaveValue("");
    }
    await context.close();
  });

  test("a visit that asks for nothing leaves nothing in the browser (SC-010, FR-023)", async ({ page }) => {
    await open(page);
    await page.mouse.wheel(0, 3000);
    await page.locator("#whatsapp-full").focus();
    expect(await page.evaluate(() => document.cookie)).toBe("");
    expect(await page.evaluate(() => localStorage.length)).toBe(0);
    expect(await page.evaluate(() => sessionStorage.length)).toBe(0);
  });

  test("while the request waits, the region breathes after the threshold and holds the minimum (D16)", async ({ page }) => {
    await open(page);
    const release = await holdApiRoute(page, "**/landing/requests", { id: "req-2", receivedAt: Date.now() });
    const hero = page.locator('form[data-form="hero"]');
    const region = hero.locator("[data-sending]");
    await hero.locator('input[name="whatsapp"]').fill("55 1234 5678");
    const started = Date.now();
    await hero.locator('button[type="submit"]').click();
    await expect(region).toHaveAttribute("aria-busy", "true");
    expect(Date.now() - started, "the breath waits out the flash threshold").toBeGreaterThanOrEqual(150);
    await expect(region).toHaveClass(/animate-breath/);
    await expect(region).toHaveAttribute("data-motion", "breath");
    await expect(hero.getByText("Enviando…")).toBeVisible();
    const shown = Date.now();
    release();
    await expect(region).not.toHaveAttribute("aria-busy", "true");
    expect(Date.now() - shown, "once shown, the breath stays the minimum").toBeGreaterThanOrEqual(400);
    await expect(hero.locator('[data-outcome-for="received"]')).toBeVisible();
  });

  test("under reduced motion the breath still runs and moves nothing (FR-028, D16)", async ({ browser }) => {
    const context = await browser.newContext({ viewport: PHONE, reducedMotion: "reduce" });
    const page = await context.newPage();
    await open(page);
    const release = await holdApiRoute(page, "**/landing/requests", { id: "req-3", receivedAt: Date.now() });
    const hero = page.locator('form[data-form="hero"]');
    await hero.locator('input[name="whatsapp"]').fill("55 1234 5678");
    await hero.locator('button[type="submit"]').click();
    const region = hero.locator("[data-sending]");
    await expect(region).toHaveAttribute("data-motion", "breath");
    const motion = await region.evaluate((el) => {
      const s = getComputedStyle(el);
      return { name: s.animationName, duration: s.animationDuration, transform: s.transform };
    });
    expect(motion.name).toBe("breath");
    expect(motion.duration).not.toBe("0.01ms");
    expect(motion.transform).toBe("none");
    release();
    await context.close();
  });
});

test.describe("landing-page US3: the page travels well", () => {
  test("the head carries the sharing metadata and the image exists at 1200×630 (FR-031)", async ({ page, request }) => {
    await open(page);
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", /^https:\/\/[^/]+\/$/);
    await expect(page.locator('meta[name="description"]')).toHaveAttribute("content", /SPEI/);
    await expect(page.locator('meta[property="og:title"]')).toHaveAttribute("content", /talacha/);
    await expect(page.locator('meta[property="og:description"]')).toHaveAttribute("content", /.+/);
    await expect(page.locator('meta[property="og:locale"]')).toHaveAttribute("content", "es_MX");
    await expect(page.locator('meta[name="twitter:card"]')).toHaveAttribute("content", "summary_large_image");
    const image = await page.locator('meta[property="og:image"]').getAttribute("content");
    expect(image).toMatch(/\/og\.png$/);
    const res = await request.get(`${LANDING}/og.png`);
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toContain("image/png");
    const png = await res.body();
    /* PNG: width and height are the big-endian ints at bytes 16 and 20 */
    expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([1200, 630]);
  });

  test("no page carries an inline script or style — the Worker's CSP admits only files from the page's own origin (FR-027, D12)", async ({ page }) => {
    for (const path of ["/", "/gracias", "/no-enviada?motivo=REQUEST_REFUSED", "/privacidad", "/404"]) {
      await page.goto(`${LANDING}${path}`);
      const inline = await page.evaluate(() => ({
        scripts: document.querySelectorAll("script:not([src])").length,
        styles: document.querySelectorAll("style, [style]").length,
        foreign: Array.from(document.querySelectorAll<HTMLElement>("script[src], link[rel=stylesheet][href]"))
          .map((el) => (el as HTMLScriptElement).src || (el as HTMLLinkElement).href)
          .filter((u) => !u.startsWith(location.origin)),
      }));
      expect(inline, path).toEqual({ scripts: 0, styles: 0, foreign: [] });
    }
    /* With a script running, /no-enviada narrows its sentence to the code */
    await page.goto(`${LANDING}/no-enviada?motivo=REQUEST_REFUSED`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("No pudimos aceptar esta solicitud.");
    await expect(page.getByText(CONTACT_EMAIL)).toBeVisible();
  });

  test("both channel inputs are present and empty in the built page — the Worker fills them (FR-025, D4)", async ({ page }) => {
    await open(page, "?ch=Grupo-ISP");
    const inputs = page.locator('input[name="channel"]');
    await expect(inputs).toHaveCount(2);
    for (const value of await inputs.evaluateAll((els) => els.map((el) => (el as HTMLInputElement).value))) expect(value).toBe("");
  });
});
