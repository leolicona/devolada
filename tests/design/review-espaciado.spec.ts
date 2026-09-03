import { expect, test, type Page } from "@playwright/test";
import { ADMIN } from "../../playwright.config";
import { businessActor, cobros, feed, integrationsHub, linksRoster } from "../e2e/stubs";

/* Captures and measurements for the espaciado-y-tipografía review
   (2026-09-03, `.design/devolada/DESIGN_REVIEW-espaciado-y-tipografia.md`):
   how Pagos, Cobros and Links space their components, and what size the
   type and the icons are across Cuenta.

   Unlike the other review specs this one also *measures*: a Tailwind class
   is a promise and `getComputedStyle` is the answer — finding T9 is a class
   that compiles to nothing, which reading the JSX would never have caught.
   The probes print a compact table per route; nothing is asserted beyond
   the screen having rendered, because the numbers are the finding.

   Run just this file:
   pnpm exec playwright test --config playwright.review.config.ts tests/design/review-espaciado.spec.ts */

const OUT = ".design/devolada/screenshots";

const envelope = (data: unknown) => ({
  status: 200,
  contentType: "application/json",
  body: JSON.stringify({ success: true, data }),
});

/* Documents always pass through: the app is served from the origin it
   calls, so a glob for an endpoint also matches the navigation to a page
   of the same name (same rule as tests/e2e/stubs.ts). */
async function apiRoute(page: Page, pattern: string, data: unknown, delayMs = 0) {
  await page.route(pattern, async (route) => {
    if (route.request().resourceType() === "document") return route.fallback();
    if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
    return route.fulfill(envelope(data));
  });
}

/* The shared cobros stub has no link (the roster was never visited), and
   the expansion's action row is one of the things being measured. */
const cobrosLinked = {
  ...cobros,
  cobros: [
    { ...cobros.cobros[0], linkUrl: "https://link.dev/p/tok", waLink: "https://wa.me/525551234567?text=hola" },
    {
      externalId: 43,
      customerUsuario: "amora@wifiplus",
      customerName: "Ana María Mora",
      amountCents: 30000,
      invoiceDate: "2026-08-05",
      dueDate: "2026-09-30",
      linkUrl: "https://link.dev/p/tok2",
      waLink: "https://wa.me/525551234568?text=hola",
    },
  ],
};

const settings = {
  spei: {
    clabe: "012180001234567895",
    bank: "BBVA MEXICO",
    bankUnknown: false,
    beneficiaryName: "ISP Demo SA de CV",
    configured: true,
    effectiveServiceFeeCents: 1500,
  },
  reconciliationPolicy: { toleranceCents: 0, overTreatment: "flag", effectiveOverTreatment: "flag" },
  timezone: "America/Mexico_City",
  timeFormat: "12h",
};

const members = {
  members: [
    { id: "m1", userId: "user-1", name: "Leo Licona", email: "leo@wifiplus.mx", role: "owner" },
    { id: "m2", userId: "user-2", name: "Ana Mora", email: "ana@wifiplus.mx", role: "operator" },
  ],
  pending: [
    { id: "i1", email: "nuevo@wifiplus.mx", role: "viewer", expiresAt: Date.now() + 86_400_000, expired: false },
  ],
  grantable: ["operator", "viewer"],
};

async function stubAdmin(page: Page, opts: { observing?: boolean; delay?: number } = {}) {
  await apiRoute(page, "**/auth/me", { ...businessActor, observing: opts.observing ?? false });
  await apiRoute(page, "**/payments/feed*", feed, opts.delay);
  await apiRoute(page, "**/payment-requests", cobrosLinked, opts.delay);
  await apiRoute(page, "**/direct-payments/links/roster", linksRoster, opts.delay);
  await apiRoute(page, "**/integrations", integrationsHub);
  await apiRoute(page, "**/settings", settings);
  await apiRoute(page, "**/businesses/members", members);
  await apiRoute(page, "**/credit/entries", {
    entries: [{ id: "e1", kind: "top_up", cents: 20000, reason: null, createdAt: Date.UTC(2026, 7, 14, 20, 30) }],
  });
  await apiRoute(page, "**/credit/top-ups", { topUps: [] });
  await apiRoute(page, "**/credit", {
    balanceCents: 10000,
    step: "ok",
    feeCents: 200,
    minTopUpCents: 20000,
    topUp: { clabe: "646180000000000000", bank: "STP", beneficiary: "Devolada SAPI de CV" },
  });
  await apiRoute(page, "**/auth/passkey/list-user-passkeys", []);
}

/* Everything the review needs off one render: the page frame's padding,
   the gap between consecutive top-level blocks, the type ramp (one row per
   distinct size/weight/tracking/colour), every rendered icon box, every
   control's height, and every bordered panel's radius and overflow. */
function probe() {
  const main = document.querySelector("main");
  const px = (v: string) => Math.round(parseFloat(v) * 100) / 100;
  const label = (el: Element | null) => {
    if (!el) return "?";
    const cls = typeof el.className === "string" ? el.className.split(" ").slice(0, 4).join(".") : "";
    return `${el.tagName.toLowerCase()}${cls ? `.${cls}` : ""} · ${(el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 40)}`;
  };
  const box = (el: Element) => {
    const r = el.getBoundingClientRect();
    return { top: Math.round(r.top + scrollY), bottom: Math.round(r.bottom + scrollY), h: Math.round(r.height), w: Math.round(r.width) };
  };

  const blocks = main ? [...main.children].map((el) => ({ label: label(el), box: box(el) })).filter((b) => b.box.h > 0) : [];
  const gaps = blocks.slice(1).map((b, i) => ({ gap: b.box.top - blocks[i].box.bottom, from: blocks[i].label, to: b.label }));

  const text: Array<Record<string, unknown>> = [];
  const icons: Array<Record<string, unknown>> = [];
  const seen = new Set<string>();
  document.querySelectorAll("main *, aside *").forEach((el) => {
    const s = getComputedStyle(el);
    if (el.tagName.toLowerCase() === "svg") {
      const r = el.getBoundingClientRect();
      if (r.width) icons.push({ size: Math.round(r.width), cls: el.getAttribute("class") || "", where: label(el.parentElement) });
      return;
    }
    if (el.children.length > 0) return;
    const t = (el.textContent || "").trim();
    if (!t || !el.getBoundingClientRect().width) return;
    const key = [px(s.fontSize), s.fontWeight, s.letterSpacing, s.textTransform, s.color].join("|");
    if (seen.has(key)) return;
    seen.add(key);
    text.push({ fontSize: px(s.fontSize), weight: s.fontWeight, tracking: s.letterSpacing, color: s.color, tag: el.tagName.toLowerCase(), sample: t.slice(0, 34) });
  });

  const controls = [...document.querySelectorAll("main button, main input, main a, aside button, aside a")]
    .map((el) => ({ tag: el.tagName.toLowerCase(), h: Math.round(el.getBoundingClientRect().height), text: (el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 24) }))
    .filter((c) => c.h > 0);

  const panels = [...document.querySelectorAll("main div, main section, aside div")]
    .filter((el) => {
      const s = getComputedStyle(el);
      return s.borderTopLeftRadius !== "0px" && s.borderTopWidth !== "0px" && el.getBoundingClientRect().height > 40;
    })
    .slice(0, 14)
    .map((el) => {
      const s = getComputedStyle(el);
      return { radius: s.borderTopLeftRadius, overflow: s.overflow, padding: s.padding, label: label(el) };
    });

  const mainStyle = main ? getComputedStyle(main) : null;
  return {
    mainPadding: mainStyle ? [px(mainStyle.paddingTop), px(mainStyle.paddingRight), px(mainStyle.paddingBottom), px(mainStyle.paddingLeft)] : null,
    blocks, gaps, text, icons, controls, panels,
  };
}

/* Icon → label distance inside a button: `gap` plus whatever margin the
   call site put on the glyph (finding E6). */
function buttonGaps(scope: string) {
  return [...document.querySelectorAll(scope)].map((b) => {
    const svg = b.querySelector("svg");
    const node = [...b.childNodes].find((n) => n.nodeType === 3 && (n.textContent || "").trim());
    if (!svg) return null;
    const range = document.createRange();
    if (node) range.selectNode(node);
    const tr = node ? range.getBoundingClientRect() : null;
    const sr = svg.getBoundingClientRect();
    return {
      text: (b.textContent || "").trim().slice(0, 16),
      iconToLabel: tr ? Math.round(tr.left - sr.right) : null,
      flexGap: getComputedStyle(b).gap,
      svgMarginRight: getComputedStyle(svg).marginRight,
      width: Math.round(b.getBoundingClientRect().width),
    };
  });
}

const report = (name: string, data: unknown) => console.log(`\n### ${name}\n${JSON.stringify(data, null, 1)}`);

/* --- The three list pages, and the five Cuenta routes --- */

const ROUTES = [
  { slug: "espaciado-pagos", path: "/payments", heading: "Pagos" },
  { slug: "espaciado-cobros", path: "/payment-requests", heading: "Cobros" },
  { slug: "espaciado-links", path: "/links", heading: "Links de pago" },
  { slug: "tipografia-hub", path: "/settings", heading: "Cuenta" },
  { slug: "tipografia-pago-directo", path: "/settings/direct-payment", heading: "Cuenta" },
  { slug: "tipografia-preferencias", path: "/settings/preferences", heading: "Cuenta" },
  { slug: "tipografia-usuarios", path: "/settings/users", heading: "Cuenta" },
  { slug: "tipografia-seguridad", path: "/settings/security", heading: "Cuenta" },
  { slug: "tipografia-saldo", path: "/settings/credit", heading: "Cuenta" },
] as const;

for (const route of ROUTES) {
  for (const width of [360, 768, 1280] as const) {
    test(`${route.slug} ${width}`, async ({ page }) => {
      await stubAdmin(page);
      await page.setViewportSize({ width, height: width < 500 ? 780 : 900 });
      await page.goto(ADMIN + route.path);
      await expect(page.getByRole("heading", { name: route.heading, level: 1 })).toBeAttached({ timeout: 15_000 });
      await page.waitForTimeout(600);
      report(`${route.slug} @ ${width}`, await page.evaluate(probe));
      const suffix = width === 360 ? "mobile-360" : width === 768 ? "tablet-768" : "desktop-1280";
      await page.screenshot({ path: `${OUT}/review-${route.slug}-${suffix}.png`, fullPage: true });
    });
  }
}

/* --- The measurements a static render does not show --- */

test("expansions: Pagos pads four sides, Cobros three", async ({ page }) => {
  await stubAdmin(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  const panels = () =>
    page.evaluate(() =>
      [...document.querySelectorAll("li [data-state='open'] > *")].map((el) => {
        const s = getComputedStyle(el);
        return { cls: (el.getAttribute("class") || "").slice(0, 70), padding: s.padding, gap: s.gap, h: Math.round(el.getBoundingClientRect().height) };
      }),
    );

  await page.goto(`${ADMIN}/payments`);
  await expect(page.getByText("Janely Guadalupe Reyes")).toBeVisible({ timeout: 15_000 });
  await page.locator("main ul li button").first().click();
  await page.waitForTimeout(400);
  report("pagos expansion", await panels());
  await page.screenshot({ path: `${OUT}/review-espaciado-pagos-expandido-desktop-1280.png`, fullPage: true });

  await page.goto(`${ADMIN}/payment-requests`);
  await expect(page.getByText("Janely Guadalupe Reyes")).toBeVisible({ timeout: 15_000 });
  await page.locator("main ul li button").first().click();
  await page.waitForTimeout(400);
  report("cobros expansion", await panels());
  report("cobros button gaps", await page.evaluate(buttonGaps, "li [data-state='open'] button"));
  await page.screenshot({ path: `${OUT}/review-espaciado-cobros-expandido-desktop-1280.png`, fullPage: true });
});

test("the same two buttons, spaced differently on Links", async ({ page }) => {
  await stubAdmin(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`${ADMIN}/links`);
  await expect(page.getByText("Janely Guadalupe Reyes")).toBeVisible({ timeout: 15_000 });
  report("links button gaps", await page.evaluate(buttonGaps, "main li button"));
});

test("the copy button grows 70px when pressed", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await stubAdmin(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`${ADMIN}/links`);
  await expect(page.getByText("Janely Guadalupe Reyes")).toBeVisible({ timeout: 15_000 });
  const boxes = () =>
    page.evaluate(() =>
      [...document.querySelectorAll("main li button")].map((b) => {
        const r = b.getBoundingClientRect();
        return { text: (b.textContent || "").trim().slice(0, 14), w: Math.round(r.width), left: Math.round(r.left) };
      }),
    );
  report("links copy button — before", await boxes());
  await page.locator("main li button").first().click();
  await page.waitForTimeout(250);
  report("links copy button — after", await boxes());
  await page.screenshot({ path: `${OUT}/review-espaciado-links-copiado-desktop-1280.png`, fullPage: true });
});

test("the skeleton is a different shape from the list", async ({ page }) => {
  await stubAdmin(page, { delay: 2500 });
  await page.setViewportSize({ width: 1280, height: 900 });
  const shape = () =>
    page.evaluate(() => {
      const main = document.querySelector("main");
      return {
        blocks: main ? [...main.children].map((el) => ({ top: Math.round(el.getBoundingClientRect().top + scrollY), h: Math.round(el.getBoundingClientRect().height), cls: (el.getAttribute("class") || "").slice(0, 30) })) : [],
        rows: [...document.querySelectorAll("main ul li, main .rounded-md > div")].slice(0, 4).map((el) => Math.round(el.getBoundingClientRect().height)),
      };
    });

  for (const [name, path] of [["pagos", "/payments"], ["cobros", "/payment-requests"], ["links", "/links"]] as const) {
    await page.goto(ADMIN + path);
    await page.waitForTimeout(900);
    report(`${name} — loading`, await shape());
    if (name === "pagos") await page.screenshot({ path: `${OUT}/review-espaciado-pagos-skeleton-desktop-1280.png`, fullPage: true });
    await page.waitForTimeout(2600);
    report(`${name} — loaded`, await shape());
  }
});

test("one state, two icon sizes: Modo observación", async ({ page }) => {
  await stubAdmin(page, { observing: true });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`${ADMIN}/settings`);
  await expect(page.getByRole("heading", { name: "Cuenta", level: 1 })).toBeVisible({ timeout: 15_000 });
  report(
    "observación icons",
    await page.evaluate(() =>
      [...document.querySelectorAll("aside svg, main svg")]
        .map((s) => ({ size: Math.round(s.getBoundingClientRect().width), cls: (s.getAttribute("class") || "").slice(0, 40), where: (s.parentElement?.textContent || "").trim().slice(0, 26) }))
        .filter((s) => /eye/.test(s.cls)),
    ),
  );
  await page.screenshot({ path: `${OUT}/review-tipografia-hub-observando-desktop-1280.png`, fullPage: true });
});

test("a sub-page with a title, and one without", async ({ page }) => {
  await stubAdmin(page);
  const heads = () =>
    page.evaluate(() => {
      const column = document.querySelectorAll("main > div > *")[1];
      return [...(column?.querySelectorAll(":scope > div > *") ?? [])].map((el) => ({
        tag: el.tagName.toLowerCase(),
        fontSize: getComputedStyle(el).fontSize,
        top: Math.round(el.getBoundingClientRect().top + scrollY),
        cls: (el.getAttribute("class") || "").slice(0, 44),
      }));
    });

  await page.setViewportSize({ width: 1280, height: 900 });
  for (const path of ["/settings/direct-payment", "/settings/preferences", "/settings/users", "/settings/security", "/settings/credit"]) {
    await page.goto(ADMIN + path);
    await page.waitForTimeout(700);
    report(`sub-page ${path} @ 1280`, await heads());
  }

  await page.setViewportSize({ width: 360, height: 780 });
  for (const [slug, path] of [["pago-directo", "/settings/direct-payment"], ["usuarios", "/settings/users"]] as const) {
    await page.goto(ADMIN + path);
    await page.waitForTimeout(700);
    report(`sub-page ${path} @ 360`, await heads());
    await page.screenshot({ path: `${OUT}/review-tipografia-${slug}-mobile-360.png`, fullPage: true });
  }
});
