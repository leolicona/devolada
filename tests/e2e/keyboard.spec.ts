import { expect, test, type Page } from "@playwright/test";
import { ADMIN, RED } from "../../playwright.config";
import { stubAdminApi, stubCashPointsApi, stubOperatorStoresApi, stubRedApi } from "./stubs";

/* docs/legacy/polish/accessibility.spec.md — US-P04, paying TD-010.

   The tab order needs a browser and a written expectation of the order.
   This is both: each flow's stops are spelled out, and every stop must
   show a visible focus indicator. "Visible" is measured, not assumed —
   the indicator has to APPEAR with the focus (an outline, a box-shadow
   or a border colour that differs from the element's resting state), so
   a static card shadow can never pass as a focus style.

   One browser quirk shapes the walks: blurring an element does not
   reset Chromium's sequential-navigation starting point, so a walk
   "from the top" is not a thing after the app has focused anything.
   Each walk therefore starts from a stop the flow really visits. */

type Stop = { label: string; focusVisible: boolean; indicator: boolean };

/* Snapshot every tabbable's resting styles so a focus indicator is
   recognizable as a change. Call with nothing focused. */
async function snapshotRestingStyles(page: Page): Promise<void> {
  await page.evaluate(() => {
    const all = document.querySelectorAll<HTMLElement>(
      "a, button, input, select, textarea, [tabindex]",
    );
    for (const el of all) {
      const s = getComputedStyle(el);
      el.dataset.restingShadow = s.boxShadow;
      el.dataset.restingBorder = s.borderColor;
    }
  });
}

const readStop = (page: Page): Promise<Stop | null> =>
  page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    if (!el || el === document.body) return null;
    const s = getComputedStyle(el);
    const outlineVisible = s.outlineStyle !== "none" && parseFloat(s.outlineWidth) > 0;
    const ringAppeared = s.boxShadow !== "none" && s.boxShadow !== el.dataset.restingShadow;
    const borderChanged =
      el.dataset.restingBorder !== undefined && s.borderColor !== el.dataset.restingBorder;
    return {
      label: (
        el.getAttribute("aria-label") ??
        el.getAttribute("placeholder") ??
        el.textContent ??
        ""
      ).trim(),
      focusVisible: el.matches(":focus-visible"),
      indicator: outlineVisible || ringAppeared || borderChanged,
    };
  });

/* One Tab press; null once focus falls back to the body (end of page). */
async function nextStop(page: Page): Promise<Stop | null> {
  await page.keyboard.press("Tab");
  return readStop(page);
}

function expectRinged(stop: Stop | null, what: string): void {
  expect(stop, `${what}: nothing focused`).not.toBeNull();
  expect(stop!.focusVisible, `${what} ("${stop!.label}") is not :focus-visible`).toBe(true);
  expect(stop!.indicator, `${what} ("${stop!.label}") has no visible focus indicator`).toBe(true);
}

/* Walk the rest of the page and hold it against the written order. The
   BODY sentinel at the end is part of the claim: the screen is exactly
   these stops — an unreachable control or a stray extra one fails. */
async function expectTabOrder(page: Page, expected: RegExp[]): Promise<void> {
  const stops: Stop[] = [];
  for (let i = 0; i < expected.length + 5; i++) {
    const stop = await nextStop(page);
    if (stop === null) break;
    stops.push(stop);
  }
  expect(
    stops.map((s) => s.label),
    `tab order does not match the written expectation`,
  ).toHaveLength(expected.length);
  for (const [i, pattern] of expected.entries()) {
    expect(stops[i].label, `stop ${i + 1} should match ${pattern}`).toMatch(pattern);
    expectRinged(stops[i], `stop ${i + 1}`);
  }
}

test.describe("US-P04: the admin's links flow is walkable by keyboard (TD-010)", () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test("Links: sections, session, then the search — the flow's first decision", async ({ page }) => {
    await stubAdminApi(page);
    await page.goto(`${ADMIN}/links`);
    await expect(page.getByPlaceholder(/buscar por nombre/i)).toBeVisible();
    /* links-on-demand-search FR-001: the first block is a provider read,
       so it does NOT arrive with the page — the walk waits for the rows
       rather than racing them */
    await expect(page.getByRole("button", { name: /whatsapp/i }).first()).toBeVisible();

    /* Sidebar first (the dashboard's spine), then the screen's controls
       in reading order: the search box is the first control on the
       screen — "Actualizar" retired with presence-freshness D1
       (2026-09-03), and the freshness label retired with it
       (links-on-demand-search FR-027 / D15), so nothing stands between
       the box and the first customer's actions. (The store-era walk
       retired with the network, 2026-08-31.) */
    await snapshotRestingStyles(page);
    await expectTabOrder(page, [
      /^Saldo:/ /* the credit chip (prepaid-credit D7) sits under the business name, before the spine */,
      /^Pagos$/,
      /* cobros-in-links FR-014: Cobros is no longer a section — its view is
         Links' Por cobrar chip, below */
      /^Links$/,
      /^Integraciones$/ /* the hub (integrations-hub D1), owner-only */,
      /Cuenta$/ /* the account hub (US-A05): the avatar (its initials precede the word) is the fifth section; the sidebar's Cerrar sesión lives inside it now */,
      /Todos/ /* cobros-in-links D14: the chip is one tab stop — the chosen tab; the arrow keys move between Todos and Por cobrar, as tabs do */,
      /Buscar por nombre/,
      /Copiar/ /* the first customer's actions — shown whether or not their link exists yet (FR-008) */,
      /WhatsApp/ /* one word for the channel (pilot-UX review) */,
      /Copiar/ /* automated-collections-api FR-011 (T076): the API link joins the same block, with the same two actions */,
      /WhatsApp/,
    ]);
  });
});

/* One Tab press, then the stop must be the expected control, ringed */
async function tabTo(page: Page, target: ReturnType<Page["getByRole"]>, what: string): Promise<void> {
  await page.keyboard.press("Tab");
  await expect(target, `${what} should hold the focus`).toBeFocused();
  expectRinged(await readStop(page), what);
}

/* cash-at-stores T033 (constitution IV, VI): the counter is walkable by
   keyboard — a shopkeeper with a hardware keyboard, or a screen reader's
   user, reaches the search, a result, the amount and *Cobrar* in reading
   order, each with a visible ring. */
test.describe("cash-at-stores US1: the counter by keyboard", () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test("search, then each result, then the tabs", async ({ page }) => {
    await stubRedApi(page);
    await page.goto(`${RED}/`);
    const search = page.getByLabel("Buscar cliente");
    /* the counter opens ready to type */
    await expect(search).toBeFocused();
    await page.keyboard.type("guadalupe");
    await expect(page.getByText("Guadalupe Reyes Hernández")).toBeVisible();
    await snapshotRestingStyles(page);
    await expectTabOrder(page, [/Guadalupe Reyes Hernández/, /Gabriel Ruiz/, /^Cobrar$/, /^Caja$/, /^Movimientos$/]);
  });

  test("the debt: back, the amount, Cobrar, then the tabs", async ({ page }) => {
    await stubRedApi(page);
    await page.goto(`${RED}/cobro/greyes@wifiplus`);
    await expect(page.getByText("Total a cobrar")).toBeVisible();
    await snapshotRestingStyles(page);
    await tabTo(page, page.getByRole("link", { name: "Buscar otro cliente" }), "the way back");
    await tabTo(page, page.getByRole("textbox", { name: "Monto a cobrar del adeudo" }), "the amount");
    await tabTo(page, page.getByRole("button", { name: /^Cobrar \$/ }), "Cobrar");
    await tabTo(page, page.getByRole("navigation", { name: "Secciones, barra inferior" }).getByRole("link", { name: "Cobrar" }), "the Cobrar tab");
  });
});

/* cash-at-stores T040 (/speckit-analyze M3): the operator creates a store
   and reaches the invitation without a mouse; every stop is ringed, the
   focus stays inside the dialog, and closing it returns the focus to the
   button that opened it. */
test.describe("cash-at-stores US2: the create dialog and the invitation by keyboard", () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test("walks the form, reaches the invitation, and returns to Nueva tienda", async ({ page }) => {
    await stubOperatorStoresApi(page);
    await page.route("**/platform/stores", async (route) => {
      if (route.request().method() !== "POST") return route.fallback();
      return route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({
          success: true,
          data: {
            store: { id: "s9", name: "Tienda Nueva", address: "Calle Hidalgo 3", shopkeeperName: "Rosa Díaz", phone: "5512340000", status: "invited", createdAt: 1, collectsFor: [] },
            invitation: { url: "https://red.devoladapago.com/invitacion/tok123", expiresAt: 2, waLink: "https://wa.me/525512340000?text=hola" },
          },
        }),
      });
    });
    await page.goto(`${ADMIN}/operador`);
    await page.getByRole("tab", { name: "Tiendas" }).click();
    const trigger = page.getByRole("button", { name: "Nueva tienda" });
    await trigger.focus();
    await page.keyboard.press("Enter");

    const dialog = page.getByRole("dialog");
    const first = dialog.getByRole("textbox", { name: "Nombre de la tienda" });
    /* Radix opens on the first field */
    await expect(first).toBeFocused();
    /* The resting styles are read with nothing focused — read with the
       first field focused, its ring would count as its resting look and
       the return to it below could never show a change */
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await snapshotRestingStyles(page);
    await first.focus();
    await page.keyboard.type("Tienda Nueva");
    await tabTo(page, dialog.getByRole("textbox", { name: "Dirección" }), "Dirección");
    await page.keyboard.type("Calle Hidalgo 3");
    await tabTo(page, dialog.getByRole("textbox", { name: "Nombre del tendero" }), "Nombre del tendero");
    await page.keyboard.type("Rosa Díaz");
    await tabTo(page, dialog.getByRole("textbox", { name: "Celular del tendero" }), "Celular del tendero");
    await page.keyboard.type("5512340000");
    await tabTo(page, dialog.getByRole("button", { name: "Crear e invitar" }), "Crear e invitar");
    await tabTo(page, dialog.getByRole("button", { name: "Cerrar" }), "Cerrar");
    /* the trap: Tab past the last stop comes back to the first */
    await tabTo(page, first, "back to the first field");

    await dialog.getByRole("button", { name: "Crear e invitar" }).focus();
    await page.keyboard.press("Enter");
    await expect(dialog.getByText("Tienda creada")).toBeVisible();
    await snapshotRestingStyles(page);
    const link = dialog.getByRole("textbox", { name: "Enlace de la invitación" });
    await link.focus();
    await tabTo(page, dialog.getByRole("button", { name: "Copiar" }), "Copiar");
    await tabTo(page, dialog.getByRole("link", { name: "Enviar por WhatsApp" }), "Enviar por WhatsApp");

    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(trigger, "closing returns the focus to Nueva tienda").toBeFocused();
    expectRinged(await readStop(page), "Nueva tienda after closing");
  });
});

/* cash-at-stores T060 (/speckit-analyze M3): on Puntos de pago the owner
   confirms or disputes a hand-over by keyboard — the confirmation names
   the store and the amount, Cancelar is where the focus lands first (the
   write cannot be undone), and the dispute's note is reachable. */
test.describe("cash-at-stores US5: Puntos de pago by keyboard", () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test("the confirm dialog opens on Cancelar and returns the focus to Confirmar", async ({ page }) => {
    await stubCashPointsApi(page);
    await page.goto(`${ADMIN}/puntos-de-pago`);
    const confirm = page.getByRole("button", { name: "Confirmar" });
    await confirm.focus();
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("alertdialog");
    await expect(dialog).toContainText("¿Recibiste $2,000.00 de Abarrotes Lupita?");
    await snapshotRestingStyles(page);
    /* Radix's alert dialog focuses the cancel: an Enter by habit undoes nothing */
    await expect(dialog.getByRole("button", { name: "Cancelar" })).toBeFocused();
    await tabTo(page, dialog.getByRole("button", { name: "Sí, lo recibí" }), "Sí, lo recibí");
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(confirm).toBeFocused();
    expectRinged(await readStop(page), "Confirmar after closing");
  });

  test("the dispute: the note, then Disputar entrega, ringed", async ({ page }) => {
    await stubCashPointsApi(page);
    await page.goto(`${ADMIN}/puntos-de-pago`);
    const open = page.getByRole("button", { name: "Disputar" });
    await open.focus();
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("textbox", { name: /Nota/ })).toBeFocused();
    await snapshotRestingStyles(page);
    await page.keyboard.type("Faltaron $200 en el sobre");
    await tabTo(page, dialog.getByRole("button", { name: "Disputar entrega" }), "Disputar entrega");
    await tabTo(page, dialog.getByRole("button", { name: "Cerrar" }), "Cerrar");
    await page.keyboard.press("Escape");
    await expect(open).toBeFocused();
  });
});
