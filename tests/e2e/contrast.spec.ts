import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { ADMIN, PAGO, RED } from "../../playwright.config";
import {
  stubAdminApi,
  stubAdminStoreApi,
  stubCashPointsApi,
  stubOperatorReaderApi,
  stubOperatorStoresApi,
  stubPagoClosed,
  stubPorCobrarSearch,
  stubRedApi,
} from "./stubs";

/* docs/legacy/polish/dark-and-contrast.spec.md, the half a token file cannot
   prove. contrast-lint measures the palette; this measures the pixels —
   an ink can pass on paper and still land on a surface nobody predicted,
   and only a browser knows which colours actually met. */

const screens = [
  /* The admin's landing screen, the feed. It carried the name "Cobros"
     from before payments-and-classes D6; the Cobros section itself is
     gone (cobros-in-links FR-014), so it says what it opens. */
  { name: "Pagos", url: ADMIN, stub: stubAdminApi, ready: "Janely Guadalupe Reyes" },
  /* cobros-in-links US1 and US3 (T040): the Por cobrar list — Venció in
     its warning ink — and a search whose results carry the two new
     badges, Sin adeudo and Sin confirmar (D15) */
  { name: "Por cobrar", url: `${ADMIN}/links?view=receivables`, stub: stubAdminApi, ready: "Abraham Flores" },
  /* Both badges must be on screen before axe measures them: they come
     from two separate debt answers (review of 2026-09-28) */
  { name: "Por cobrar búsqueda", url: `${ADMIN}/links?view=receivables&q=wif`, stub: stubPorCobrarSearch, ready: ["Sin confirmar", "Sin adeudo"] },
  /* payment-method-per-channel T027: the methods block arrives on its own
     read, after the switch — both of its badges must be on screen before
     axe measures them */
  {
    name: "WispHub",
    url: `${ADMIN}/integrations/wisphub`,
    stub: stubAdminApi,
    ready: ["Ejecutar acciones automáticamente", "Creada", "Falta crearla"],
  },
  /* provider-address-per-isp US1 (T042): the installation picker and the
     two badges that mark a sandbox and an assumed default. A status told
     by colour alone fails the brief, and only a browser can say whether
     these met their surface in either theme. */
  { name: "WispHub instalación", url: `${ADMIN}/integrations/wisphub`, stub: stubAdminApi, ready: ["Instalación en uso:", "Creada"] },
  /* account-hub (US-A05): the rail, the identity card and the door */
  { name: "Cuenta", url: `${ADMIN}/settings`, stub: stubAdminApi, ready: "Cerrar sesión" },
  /* automated-collections-api US1 scenarios 3 and 4 (D6, FR-031): the
     payer's closed link — paid, and expired — the one new state the
     page gained, so the one that needs its own pixels measured */
  { name: "Link pagado", url: `${PAGO}/p/tok123`, stub: stubPagoClosed("paid"), ready: "ya fue utilizado" },
  { name: "Link vencido", url: `${PAGO}/p/tok123`, stub: stubPagoClosed("expired"), ready: "venció" },
  /* cep-bundle-match T049: the "Sin pago" list, and the proof dialog's
     decision and candidates — text on the dialog's surface and on the
     list's card, measured where they actually land */
  {
    name: "Sin pago",
    url: ADMIN,
    stub: stubAdminApi,
    open: async (page: Page) => {
      await page.getByRole("tab", { name: "Sin pago" }).click();
    },
    ready: "Transferencias recibidas que ningún pago ha usado.",
  },
  {
    name: "Coincidencias",
    url: ADMIN,
    stub: stubAdminApi,
    open: async (page: Page) => {
      await page.getByRole("button", { name: /Janely Guadalupe Reyes/ }).first().click();
      await page.getByRole("button", { name: "Ver comprobante" }).first().click();
    },
    ready: "Varias coincidencias · resuelta por cuenta y hora",
  },
] as const;

const WIDTHS = [
  { name: "phone", width: 360, height: 740 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "desktop", width: 1280, height: 900 },
] as const;

for (const theme of ["light", "dark"] as const) {
  test.describe(`US-P02/US-P04: real contrast in ${theme}`, () => {
    for (const screen of screens) {
      test(`${screen.name} has no contrast violations`, async ({ page }) => {
        await page.emulateMedia({ colorScheme: theme });
        await screen.stub(page);
        await page.goto(screen.url);
        if ("open" in screen) {
          await expect(page.getByText("Janely Guadalupe Reyes").first()).toBeVisible();
          await screen.open(page);
        }
        for (const ready of ([] as string[]).concat(screen.ready)) {
          await expect(page.getByText(ready).first()).toBeVisible();
        }

        const results = await new AxeBuilder({ page })
          /* Only the rules that need real rendering: the markup rules
             already run per-screen in the component layer. */
          .withRules(["color-contrast", "target-size"])
          .analyze();

        const readable = results.violations.map(
          (v) => `${v.id}: ${v.nodes.map((n) => n.failureSummary?.split("\n").slice(-1)[0]).join(" | ")}`,
        );
        expect(readable, `${screen.name} in ${theme}`).toEqual([]);
      });
    }
  });
}

/* Constitution IV and VI: the closed page holds at every width the
   floor sets, and never scrolls sideways — a payer who arrived late
   must read the whole sentence, not half of it. */
test.describe("automated-collections-api US1: the closed link at 360/768/1280", () => {
  for (const reason of ["paid", "expired"] as const) {
    for (const size of WIDTHS) {
      test(`${reason} link fits a ${size.name} without horizontal scroll`, async ({ page }) => {
        await page.setViewportSize({ width: size.width, height: size.height });
        await stubPagoClosed(reason)(page);
        await page.goto(`${PAGO}/p/tok123`);
        await expect(page.getByText(reason === "paid" ? "ya fue utilizado" : "venció")).toBeVisible();
        /* no CLABE on a closed link: a transfer against it would be applied to nobody */
        await expect(page.getByText("646180157000000004")).toHaveCount(0);
        const overflow = await page.evaluate(() => ({
          scrollWidth: document.documentElement.scrollWidth,
          clientWidth: document.documentElement.clientWidth,
        }));
        expect(overflow.scrollWidth, `page scrolls sideways: ${overflow.scrollWidth}px in ${overflow.clientWidth}px`).toBeLessThanOrEqual(
          overflow.clientWidth + 1,
        );
      });
    }
  }
});

/* receipt-reader-tuning US3 (D19): the Lector tab — the model card, the
   bench detail with its marks, the same-bank flag and a failed column,
   and the results — measured in both themes. The marks and the failure
   are icon + text; only a browser can say whether their inks met the
   surfaces they land on. */
for (const theme of ["light", "dark"] as const) {
  test(`receipt-reader-tuning US3: Lector has no contrast violations in ${theme}`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: theme });
    await stubOperatorReaderApi(page);
    await page.goto(`${ADMIN}/operador`);
    await page.getByRole("tab", { name: "Lector" }).click();
    await expect(page.getByText("Modelo que lee los comprobantes")).toBeVisible();
    await page.getByRole("button", { name: /Mistral Small 3\.1: leído/ }).click();
    await expect(page.getByText("Respuesta sin datos")).toBeVisible();

    const results = await new AxeBuilder({ page }).withRules(["color-contrast", "target-size"]).analyze();
    const readable = results.violations.map(
      (v) => `${v.id}: ${v.nodes.map((n) => n.failureSummary?.split("\n").slice(-1)[0]).join(" | ")}`,
    );
    expect(readable, `Lector in ${theme}`).toEqual([]);
  });
}

/* cash-at-stores US1–US5 (T033, T040, T051, T060, T083, T113): every new screen, measured where
   its inks land — the store app's counter and cash book on the phone, and
   the panel's Tiendas tab, cash rows in Pagos and Puntos de pago. The
   statuses there (Entrega pendiente, En disputa, Tienda suspendida, the
   correction's warning) are icon + text; only a browser can say whether
   their colours met the surfaces under them, in either theme. */
const storeScreens: {
  name: string;
  url: string;
  stub: (page: Page) => Promise<void>;
  open?: (page: Page) => Promise<void>;
  ready: string;
}[] = [
  {
    name: "Cobrar: búsqueda",
    url: `${RED}/`,
    stub: (page) => stubRedApi(page),
    open: async (page) => {
      await page.getByLabel("Buscar cliente").fill("guadalupe");
    },
    ready: "Guadalupe Reyes Hernández",
  },
  { name: "Cobrar: adeudo", url: `${RED}/cobro/greyes@wifiplus`, stub: (page) => stubRedApi(page), ready: "Total a cobrar" },
  { name: "Cobrar: pago registrado", url: `${RED}/cobros/pay-1`, stub: (page) => stubRedApi(page), ready: "DV-7K2Q9M" },
  { name: "Cobrar: avisando al negocio", url: `${RED}/cobros/pay-1`, stub: (page) => stubRedApi(page, { collection: "queued" }), ready: "Estamos avisando al negocio" },
  { name: "Entrar", url: `${RED}/entrar`, stub: async () => {}, ready: "Olvidé mi contraseña" },
  { name: "Recuperar", url: `${RED}/recuperar`, stub: async () => {}, ready: "Volver a entrar" },
  { name: "Invitación", url: `${RED}/invitacion/tok-1`, stub: (page) => stubRedApi(page), ready: "Abarrotes Lupita" },
  {
    name: "Tienda suspendida",
    url: `${RED}/`,
    stub: async (page) => {
      /* T096: the screen as the app reaches it — the session answers that
         the store is suspended (FR-014) */
      await page.route("**/auth/me", (route) =>
        route.request().resourceType() === "document"
          ? route.fallback()
          : route.fulfill({ status: 403, contentType: "application/json", body: JSON.stringify({ success: false, error: { code: "STORE_SUSPENDED" } }) }),
      );
    },
    ready: "Tu tienda está suspendida",
  },
  {
    name: "Cuenta de otro tipo",
    url: `${RED}/`,
    stub: async (page) => {
      /* T083: a business member signed in on the store app (FR-013) */
      await page.route("**/auth/me", (route) =>
        route.request().resourceType() === "document"
          ? route.fallback()
          : route.fulfill({ contentType: "application/json", body: JSON.stringify({ success: true, data: { type: "business" } }) }),
      );
    },
    ready: "Esta cuenta no es de una tienda",
  },
  { name: "Entregas", url: `${RED}/caja/entregas?businessId=business-1`, stub: (page) => stubRedApi(page), ready: "«Faltaron $200 en el sobre»" },
  { name: "Movimientos de un negocio", url: `${RED}/movimientos?businessId=business-1&kind=collection`, stub: (page) => stubRedApi(page), ready: "Ver todos" },
  /* At this suite's 1280px the store app is its desktop layout (D32): the
     side menu, and the hand-overs beside the cash */
  { name: "Mi caja", url: `${RED}/caja`, stub: (page) => stubRedApi(page), ready: "WiFi Plus dice:" },
  {
    /* T113: one screen on a phone, so the tab bar's inks stay measured */
    name: "Cobrar en el teléfono",
    url: `${RED}/`,
    stub: (page) => stubRedApi(page),
    open: async (page) => {
      await page.setViewportSize({ width: 375, height: 812 });
    },
    ready: "Cobras para",
  },
  { name: "Registrar entrega", url: `${RED}/caja/entrega?businessId=business-1`, stub: (page) => stubRedApi(page), ready: "La entrega quedará pendiente" },
  { name: "Movimientos", url: `${RED}/movimientos`, stub: (page) => stubRedApi(page), ready: "Corrección de Devolada" },
  {
    name: "Pagos con efectivo",
    url: ADMIN,
    stub: stubAdminStoreApi,
    open: async (page) => {
      await page.getByRole("button", { name: /Mario Pérez Castañeda/ }).click();
    },
    ready: "Cargo por servicio en tienda",
  },
  {
    name: "Tiendas",
    url: `${ADMIN}/operador`,
    stub: stubOperatorStoresApi,
    open: async (page) => {
      await page.getByRole("tab", { name: "Tiendas" }).click();
      await page.getByRole("button", { name: /WiFi Plus · tiene/ }).click();
    },
    ready: "Registrar corrección",
  },
  { name: "Reglas de tiendas", url: `${ADMIN}/operador`, stub: stubOperatorStoresApi, ready: "Vista previa con datos de ejemplo" },
  {
    name: "Puntos de pago",
    url: `${ADMIN}/puntos-de-pago`,
    stub: stubCashPointsApi,
    open: async (page) => {
      await page.getByRole("button", { name: "Ver entregas" }).first().click();
    },
    ready: "«Faltaron $200 en el sobre»",
  },
  {
    name: "Confirmar entrega",
    url: `${ADMIN}/puntos-de-pago`,
    stub: stubCashPointsApi,
    open: async (page) => {
      await page.getByRole("button", { name: "Confirmar" }).click();
    },
    ready: "Sí, lo recibí",
  },
];

for (const theme of ["light", "dark"] as const) {
  test.describe(`cash-at-stores: real contrast in ${theme}`, () => {
    for (const screen of storeScreens) {
      test(`${screen.name} has no contrast violations`, async ({ page }) => {
        await page.emulateMedia({ colorScheme: theme });
        await screen.stub(page);
        await page.goto(screen.url);
        await screen.open?.(page);
        await expect(page.getByText(screen.ready).first()).toBeVisible();
        /* T084: an outcome fades in (`reveal`, opacity only); its inks are
           measured once it has landed, not halfway. A waiting region's
           breath dips to `--opacity-breath` and back for as long as it
           waits (design-foundations D16); axe would read whichever instant
           it landed on, so the breath is held at its first frame, full ink,
           as every breathing screen is measured before its breath starts. */
        await page.evaluate(() => {
          for (const a of document.getAnimations()) {
            if (a.effect?.getComputedTiming().iterations === Infinity) {
              a.pause();
              a.currentTime = 0;
            } else a.finish();
          }
        });

        const results = await new AxeBuilder({ page }).withRules(["color-contrast", "target-size"]).analyze();
        const readable = results.violations.map(
          (v) => `${v.id}: ${v.nodes.map((n) => n.failureSummary?.split("\n").slice(-1)[0]).join(" | ")}`,
        );
        expect(readable, `${screen.name} in ${theme}`).toEqual([]);
      });
    }
  });
}
