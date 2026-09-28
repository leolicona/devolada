import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { ADMIN, PAGO } from "../../playwright.config";
import { stubAdminApi, stubOperatorReaderApi, stubPagoClosed, stubPorCobrarSearch } from "./stubs";

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
  { name: "Por cobrar búsqueda", url: `${ADMIN}/links?view=receivables&q=wif`, stub: stubPorCobrarSearch, ready: "Sin confirmar" },
  { name: "WispHub", url: `${ADMIN}/integrations/wisphub`, stub: stubAdminApi, ready: "Ejecutar acciones automáticamente" },
  /* provider-address-per-isp US1 (T042): the installation picker and the
     two badges that mark a sandbox and an assumed default. A status told
     by colour alone fails the brief, and only a browser can say whether
     these met their surface in either theme. */
  { name: "WispHub instalación", url: `${ADMIN}/integrations/wisphub`, stub: stubAdminApi, ready: "Instalación en uso:" },
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
        await expect(page.getByText(screen.ready).first()).toBeVisible();

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
