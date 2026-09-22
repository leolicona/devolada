import { expect, test, type Page } from "@playwright/test";
import { ADMIN } from "../../playwright.config";
import { stubAdminApi } from "../e2e/stubs";

/* Design-review captures for the Links screen
   (links-on-demand-search US1): the resting state, a result list with
   and without phone, the no-results answer and the missing-WispHub-key
   wall. Run just this file:
   pnpm exec playwright test --config playwright.review.config.ts tests/design/review-links.spec.ts

   D12: this used to stub `/direct-payments/links/search`, an endpoint
   the pilot-UX round removed — the stub outlived it by two features and
   fulfilled nothing. The shots point at the customers door now, which
   is what the screen actually reads. */

const OUT = ".design/screenshots";

/* The Copiado shot writes to the real clipboard */
test.use({ permissions: ["clipboard-write"] });

const results = [
  {
    channel: "panel",
    usuario: "greyes",
    wisphubId: 101,
    customerRef: null,
    label: null,
    askCents: null,
    linkState: null,
    name: "Janely Reyes",
    phone: "5551234567",
    hasLink: true,
    url: "https://link.dev.devoladapago.com/p/tok-greyes",
    waLink: "https://wa.me/525551234567?text=hola",
  },
  {
    channel: "panel",
    usuario: "mreyesf",
    wisphubId: 102,
    customerRef: null,
    label: null,
    askCents: null,
    linkState: null,
    name: "Mario Reyes Flores",
    phone: null,
    /* FR-008: no link yet, and the buttons show all the same */
    hasLink: false,
    url: null,
    waLink: null,
  },
  {
    channel: "panel",
    usuario: "reyna01",
    wisphubId: 103,
    customerRef: null,
    label: null,
    askCents: null,
    linkState: null,
    name: "Reyna Domínguez",
    phone: "5559876543",
    hasLink: true,
    url: "https://link.dev.devoladapago.com/p/tok-reyna01",
    waLink: "https://wa.me/525559876543?text=hola",
  },
];

/* One customers stub for every shot: a browse hands back the trio,
   "reyes" finds them, anything else finds nobody. Registered after
   stubAdminApi so it wins. */
async function stubLinks(page: Page, opts: { fail?: boolean } = {}) {
  await stubAdminApi(page);
  await page.route(
    (url) => url.pathname.endsWith("/direct-payments/customers"),
    (route) => {
      if (route.request().resourceType() === "document") return route.fallback();
      if (opts.fail) {
        return route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({ success: false, error: { code: "WISPHUB_NOT_CONFIGURED" } }),
        });
      }
      const q = new URL(route.request().url()).searchParams.get("q");
      const rows = q === null || q.toLowerCase().includes("reyes") ? results : [];
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          success: true,
          data: {
            results: rows,
            nextCursor: null,
            matched: q === null ? null : rows.length,
            total: q === null ? 6513 : null,
            wisphub: "ok",
          },
        }),
      });
    },
  );
}

type Shot = {
  slug: string;
  fail?: boolean;
  act?: (page: Page) => Promise<void>;
  widths: number[];
};

const shots: Shot[] = [
  {
    /* The resting state: the search bar and the sentence that says
       what the screen is for */
    slug: "admin-links-inicial",
    widths: [1280, 375],
  },
  {
    /* Three results, one of them phoneless — its share button still
       works through the picker (D3) */
    slug: "admin-links-resultados",
    widths: [1280, 768, 375],
    act: async (page) => {
      await page.getByPlaceholder(/Buscar por nombre/).fill("reyes");
      await expect(page.getByText("Janely Reyes")).toBeVisible({ timeout: 10_000 });
    },
  },
  {
    /* The copy button answering: check + "Copiado" for two seconds */
    slug: "admin-links-copiado",
    widths: [1280],
    act: async (page) => {
      await page.getByPlaceholder(/Buscar por nombre/).fill("reyes");
      await expect(page.getByText("Janely Reyes")).toBeVisible({ timeout: 10_000 });
      await page.getByRole("button", { name: "Copiar" }).first().click();
      await expect(page.getByText("Copiado")).toBeVisible();
    },
  },
  {
    slug: "admin-links-sin-resultados",
    widths: [1280, 375],
    act: async (page) => {
      await page.getByPlaceholder(/Buscar por nombre/).fill("zzz");
      await expect(page.getByText(/No se encontraron clientes/)).toBeVisible({ timeout: 10_000 });
    },
  },
  {
    /* The 503 wall: the key is missing and the screen says where to
       fix it */
    slug: "admin-links-sin-conexion",
    fail: true,
    widths: [1280, 375],
    act: async (page) => {
      await page.getByPlaceholder(/Buscar por nombre/).fill("reyes");
      await expect(page.getByText(/Sin conexión a WispHub/)).toBeVisible({ timeout: 10_000 });
    },
  },
];

for (const shot of shots) {
  const primary = shot.widths[0];
  for (const width of shot.widths) {
    for (const theme of width === primary ? (["light", "dark"] as const) : (["light"] as const)) {
      test(`${shot.slug} ${width} ${theme}`, async ({ page }) => {
        await page.setViewportSize({ width, height: width < 500 ? 812 : width < 1000 ? 900 : 800 });
        await page.emulateMedia({ colorScheme: theme });
        await stubLinks(page, { fail: shot.fail });
        await page.goto(`${ADMIN}/links`);
        await expect(page.getByRole("heading", { name: "Links de pago" })).toBeVisible({
          timeout: 15_000,
        });
        await shot.act?.(page);
        await page.waitForTimeout(400);
        const suffix = theme === "dark" ? "-dark" : "";
        await page.screenshot({
          path: `${OUT}/review-${shot.slug}-${width}${suffix}.png`,
          fullPage: true,
        });
      });
    }
  }
}
