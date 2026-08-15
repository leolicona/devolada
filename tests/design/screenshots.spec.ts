import { expect, test, type Page } from "@playwright/test";
import { ADMIN, TIENDA } from "../../playwright.config";
import {
  cashbox,
  feed,
  ispActor,
  ledger,
  pendingDrops,
  storeActor,
  stores,
} from "../e2e/stubs";

/* Design review captures. Not part of `pnpm e2e`: run with
   `pnpm exec playwright test --config playwright.review.config.ts`.
   Images land in .design/devolada/screenshots/. */

const OUT = ".design/devolada/screenshots";

const envelope = (data: unknown) => ({
  status: 200,
  contentType: "application/json",
  body: JSON.stringify({ success: true, data }),
});

const unauthorized = {
  status: 401,
  contentType: "application/json",
  body: JSON.stringify({ success: false, error: { code: "UNAUTHENTICATED" } }),
};

/* Documents always pass through: the apps are served from the origin they
   call, so a path matcher hits the page navigation too (e2e stubs D2). */
function json(page: Page, match: (url: URL) => boolean, data: unknown) {
  return page.route(
    (url) => match(url),
    (route) => (route.request().resourceType() === "document" ? route.fallback() : route.fulfill(envelope(data))),
  );
}

const customers = {
  customers: [
    {
      wisphubId: 6,
      usuario: "greyes@wifiplus",
      name: "Janely Guadalupe Reyes",
      zone: "Zona dia 15",
      serviceStatus: "suspended",
      billingStatus: "due",
      monthlyFeeCents: 49900,
    },
    {
      wisphubId: 9,
      usuario: "aflores@wifiplus",
      name: "Abraham Flores Montiel",
      zone: "Col. El Mirador",
      serviceStatus: "active",
      billingStatus: "paid",
      monthlyFeeCents: 39900,
    },
  ],
};

const quote = {
  customer: customers.customers[0],
  quote: { monthlyFeeCents: 49900, serviceFeeCents: 1500, totalCents: 51400 },
  cap: { balanceCents: 91000, capCents: 500000, blocked: false },
};

const charge = {
  id: "ch-1",
  folio: "DV-A1B2C3",
  reconnectionStatus: "queued",
  totalCents: 51400,
  customerName: "Janely Guadalupe Reyes",
};

const receipt = {
  folio: "DV-A1B2C3",
  customerName: "Janely Guadalupe Reyes",
  totalCents: 51400,
  monthlyFeeCents: 49900,
  serviceFeeCents: 1500,
  reconnectionStatus: "queued",
  text: "Devolada · Comprobante DV-A1B2C3\nJanely Guadalupe Reyes\nMensualidad $499.00\nServicio $15.00\nTotal $514.00",
  waLink: "https://wa.me/525512345678?text=Devolada",
  phone: "5512345678",
};

const settings = {
  serviceFeeCents: 1500,
  storeCommissionCents: 900,
  platformShareCents: 600,
  timezone: "America/Mexico_City",
  timeFormat: "12h",
  wisphub: { configured: true, keyTail: "9f3a" },
};

const storeDetail = {
  ...stores.stores[0],
};

async function stubStore(page: Page) {
  await json(page, (u) => u.pathname.endsWith("/auth/me"), storeActor);
  await json(page, (u) => u.pathname.endsWith("/cashbox"), cashbox);
  await json(page, (u) => u.pathname.endsWith("/ledger"), ledger);
  await json(page, (u) => /\/charges\/[^/]+$/.test(u.pathname) && !u.pathname.includes("customers"), charge);
  await json(page, (u) => u.pathname.endsWith("/receipt"), receipt);
  await json(page, (u) => /\/charges\/customers\/[^/]+$/.test(u.pathname), quote);
  await json(page, (u) => u.pathname.endsWith("/charges/customers"), customers);
}

async function stubAdmin(page: Page) {
  await json(page, (u) => u.pathname.endsWith("/auth/me"), ispActor);
  await json(page, (u) => u.pathname.includes("/charges/feed"), feed);
  await json(page, (u) => u.pathname.endsWith("/stores"), stores);
  await json(page, (u) => /\/stores\/[^/]+$/.test(u.pathname), storeDetail);
  await json(page, (u) => u.pathname.endsWith("/cash-drops"), pendingDrops);
  await json(page, (u) => u.pathname.endsWith("/settings"), settings);
}

type Shot = {
  slug: string;
  url: string;
  app: "tienda" | "admin";
  ready: string | RegExp;
  act?: (page: Page) => Promise<void>;
  widths?: number[];
  dark?: boolean;
  anon?: boolean;
};

const TIENDA_WIDTHS = [375, 768, 1280];
const ADMIN_WIDTHS = [1280, 768, 375];

const shots: Shot[] = [
  {
    slug: "tienda-buscar",
    url: TIENDA,
    app: "tienda",
    ready: "Buscar cliente",
    act: async (page) => {
      await page.getByLabel("Buscar cliente").fill("Janely");
      await expect(page.getByText("Janely Guadalupe Reyes")).toBeVisible();
    },
  },
  { slug: "tienda-buscar-vacio", url: TIENDA, app: "tienda", ready: "Buscar cliente", widths: [375] },
  {
    slug: "tienda-confirmar",
    url: `${TIENDA}/charge/greyes%40wifiplus`,
    app: "tienda",
    ready: "Janely Guadalupe Reyes",
  },
  { slug: "tienda-resultado", url: `${TIENDA}/charges/ch-1`, app: "tienda", ready: /DV-A1B2C3/ },
  { slug: "tienda-caja", url: `${TIENDA}/cashbox`, app: "tienda", ready: "Abarrotes La Esquina" },
  { slug: "tienda-entrega", url: `${TIENDA}/cashbox/drop`, app: "tienda", ready: "Monto a entregar", widths: [375] },
  { slug: "tienda-movimientos", url: `${TIENDA}/ledger`, app: "tienda", ready: /Cobro/, widths: [375] },
  { slug: "tienda-login", url: `${TIENDA}/login`, app: "tienda", ready: /Entrar|Iniciar/, widths: [375], anon: true },

  { slug: "admin-cobros", url: ADMIN, app: "admin", ready: "Janely Guadalupe Reyes" },
  { slug: "admin-entregas", url: `${ADMIN}/cash-drops`, app: "admin", ready: "Confirmar entrega" },
  { slug: "admin-tiendas", url: `${ADMIN}/stores`, app: "admin", ready: /Cerca del límite/ },
  { slug: "admin-ajustes", url: `${ADMIN}/settings`, app: "admin", ready: /Comisión|WispHub/ },
  { slug: "admin-login", url: `${ADMIN}/login`, app: "admin", ready: /Entrar|Iniciar/, widths: [1280], anon: true },
];

for (const shot of shots) {
  const widths = shot.widths ?? (shot.app === "tienda" ? TIENDA_WIDTHS : ADMIN_WIDTHS);
  const primary = widths[0];

  for (const width of widths) {
    for (const theme of width === primary ? (["light", "dark"] as const) : (["light"] as const)) {
      test(`${shot.slug} ${width} ${theme}`, async ({ page }) => {
        await page.setViewportSize({ width, height: width < 500 ? 812 : 900 });
        await page.emulateMedia({ colorScheme: theme });
        if (shot.anon) {
          await page.route(
            (u) => u.pathname.endsWith("/auth/me"),
            (route) => (route.request().resourceType() === "document" ? route.fallback() : route.fulfill(unauthorized)),
          );
        } else if (shot.app === "tienda") {
          await stubStore(page);
        } else {
          await stubAdmin(page);
        }
        await page.goto(shot.url);
        await expect(page.getByText(shot.ready).first()).toBeVisible({ timeout: 15_000 });
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
