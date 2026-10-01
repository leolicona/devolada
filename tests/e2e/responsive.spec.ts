import { expect, test, type Page } from "@playwright/test";
import { ADMIN, RED } from "../../playwright.config";
import {
  stubAdminApi,
  stubAdminStoreApi,
  stubCashPointsApi,
  stubOperatorReaderApi,
  stubOperatorStoresApi,
  stubRedApi,
} from "./stubs";

/* docs/legacy/polish/responsive.spec.md — US-P03.

   Every assertion here is about real layout: the browser has the
   stylesheet, so a 48px touch target is measured rather than assumed. */

const PHONE = { width: 360, height: 740 }; /* the floor FRONTEND.md sets */
const TABLET = { width: 768, height: 1024 };
const DESKTOP = { width: 1280, height: 900 };

/* A page that scrolls sideways on a phone is broken, whatever it looks
   like in a screenshot: the shopkeeper loses half the amount off-screen. */
async function expectNoHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => {
    const el = document.documentElement;
    return { scrollWidth: el.scrollWidth, clientWidth: el.clientWidth };
  });
  expect(
    overflow.scrollWidth,
    `page scrolls sideways: ${overflow.scrollWidth}px of content in ${overflow.clientWidth}px`,
  ).toBeLessThanOrEqual(overflow.clientWidth + 1);
}

/* FRONTEND.md: touch targets ≥ 48px, and the charge path's decisive
   actions at 64px. Anything interactive and visible has to clear it. */
async function expectTouchTargets(page: Page, min = 44, within = "body") {
  const small = await page.evaluate(([minSize, scope]) => {
    const offenders: string[] = [];
    const root = document.querySelector(scope as string);
    if (!root) return [`scope "${scope}" not found`];
    for (const el of root.querySelectorAll("a, button, input, select, textarea")) {
      const box = el.getBoundingClientRect();
      if (box.width === 0 || box.height === 0) continue; /* not rendered */
      if (box.height < minSize) {
        offenders.push(`${el.tagName.toLowerCase()} "${el.textContent?.trim().slice(0, 30)}" ${Math.round(box.height)}px`);
      }
    }
    return offenders;
  }, [min, within] as const);
  expect(small, `controls under ${min}px tall`).toEqual([]);
}

/* design-review.spec.md D1: the two assertions above both pass on a row
   that says nothing. A `min-w-0 flex-1` column beside fixed-width siblings
   collapses to zero, and `truncate` hides the collapse behind an ellipsis
   — the page does not scroll, the targets are big, and the store's name is
   gone. Clipping is measurable: an element that hides its overflow and
   needs more width than it has is cutting text off. */
async function expectNothingClipped(page: Page) {
  const clipped = await page.evaluate(() => {
    const bad: string[] = [];
    for (const el of document.querySelectorAll("main *")) {
      const node = el as HTMLElement;
      if (node.children.length > 0) continue; /* leaves hold the text */
      const text = node.textContent?.trim();
      if (!text) continue;
      /* design-review 2026-08-25 finding 7: a stub that drifts from the
         wire shape makes `formatMoney(undefined)` render "$NaN" without
         throwing, and every geometry assertion passes over it. Same
         class as clipping: the page renders and says nothing. */
      if (/\bNaN\b/.test(text)) {
        bad.push(`"${text.slice(0, 40)}" contains NaN — a number failed to render`);
        continue;
      }
      const style = getComputedStyle(node);
      /* sr-only clips on purpose: an absolute 1px box for assistive tech.
         A collapsed row column is neither absolute nor 1px tall. */
      if (style.position === "absolute" && node.clientHeight <= 1) continue;
      if (style.overflow !== "hidden" && style.overflowX !== "hidden") continue;
      if (node.scrollWidth > node.clientWidth + 1) {
        bad.push(`"${text.slice(0, 40)}" needs ${node.scrollWidth}px, has ${node.clientWidth}px`);
      }
    }
    return bad;
  });
  expect(clipped, "text cut off by its own container").toEqual([]);
}

test.describe("US-P05: every list row says what it is about at 360px", () => {
  test.use({ viewport: PHONE });

  test("the charge feed shows customer and store", async ({ page }) => {
    await stubAdminApi(page);
    await page.goto(ADMIN);
    await expect(page.getByText("Janely Guadalupe Reyes")).toBeVisible();
    await expectNothingClipped(page);
  });

});

test.describe("US-P03: the admin follows the ISP to a phone", () => {
  test("the sidebar becomes a bottom bar under lg", async ({ page }) => {
    await stubAdminApi(page);
    await page.setViewportSize(PHONE);
    await page.goto(ADMIN);
    await expect(page.getByText("Janely Guadalupe Reyes")).toBeVisible();

    /* Both navs are in the DOM; only one may be visible (a11y D5) */
    await expect(page.getByRole("navigation", { name: "Secciones, barra inferior" })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Secciones", exact: true })).toBeHidden();
    await expectNoHorizontalScroll(page);
  });

  test("the sidebar returns on desktop", async ({ page }) => {
    await stubAdminApi(page);
    await page.setViewportSize(DESKTOP);
    await page.goto(ADMIN);
    await expect(page.getByText("Janely Guadalupe Reyes")).toBeVisible();

    await expect(page.getByRole("navigation", { name: "Secciones", exact: true })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Secciones, barra inferior" })).toBeHidden();
  });

  test("the charge feed does not scroll sideways at tablet width", async ({ page }) => {
    await stubAdminApi(page);
    await page.setViewportSize(TABLET);
    await page.goto(ADMIN);
    await expect(page.getByText("Janely Guadalupe Reyes")).toBeVisible();
    await expectNoHorizontalScroll(page);
  });

  /* pagos-filtros review (2026-09-02): `expectTouchTargets` had never
     been called by anyone, while two specs claimed it proved the floor.
     It is wired here for the one region that round fixed; the rest of
     the admin is TD-019. The chip rail is a scroll container, and
     `overflow-x: auto` forces `overflow-y: auto`, which was slicing the
     3px focus ring off the top of every chip — the ring's room is a
     measurement, not a screenshot. */
  test("the Pagos filter bar clears 44px, and a focused chip keeps its ring", async ({ page }) => {
    await stubAdminApi(page);
    await page.setViewportSize(PHONE);
    await page.goto(ADMIN);
    await expect(page.getByText("Janely Guadalupe Reyes")).toBeVisible();

    await expectTouchTargets(page, 44, 'section[aria-label="Filtros"]');

    const rail = page.getByRole("tablist", { name: "Filtrar por estado" });
    await rail.getByRole("tab", { name: "En cola" }).focus();
    const room = await rail.evaluate((list) => {
      const chip = list.querySelector('[role="tab"][data-state], [role="tab"]:focus') as HTMLElement | null;
      const focused = (document.activeElement as HTMLElement) ?? chip;
      const a = list.getBoundingClientRect();
      const b = focused.getBoundingClientRect();
      return { above: b.top - a.top, below: a.bottom - b.bottom, overflowY: getComputedStyle(list).overflowY };
    });
    /* the ring is 3px (`--shadow-focus`); the rail clips at its padding box */
    expect(room.overflowY, "the rail is a scroll container, so it clips").not.toBe("visible");
    expect(room.above, "room above the chip for the focus ring").toBeGreaterThanOrEqual(3);
    expect(room.below, "room below the chip for the focus ring").toBeGreaterThanOrEqual(3);
    await expectNoHorizontalScroll(page);
  });
});

/* provider-address-per-isp US1 (T042) — the three questions happy-dom
   cannot answer about the installation picker (constitution IV). The
   component layer already proves it renders the right entries and marks
   the test one; only a browser can say whether an ISP can actually hit
   it on a phone, and whether the badge that marks a sandbox is legible
   once the real stylesheet is applied. */
test.describe("provider-address-per-isp US1: the installation picker in a real browser", () => {
  for (const size of [PHONE, TABLET, DESKTOP]) {
    test(`does not scroll sideways at ${size.width}px, open or closed`, async ({ page }) => {
      await stubAdminApi(page);
      await page.setViewportSize(size);
      await page.goto(`${ADMIN}/integrations/wisphub`);
      await expect(page.getByText("Instalación en uso:")).toBeVisible();
      await expectNoHorizontalScroll(page);

      /* The listbox is the part that can overflow: it is as wide as its
         trigger plus whatever the longest label and its badge need. */
      await page.getByLabel("¿Dónde entras a WispHub?").click();
      await expect(page.getByRole("option", { name: "Pruebas (sandbox)" })).toBeVisible();
      await expectNoHorizontalScroll(page);
      await expectNothingClipped(page);
    });
  }

  test("the picker and its options clear the touch floor on a phone", async ({ page }) => {
    await stubAdminApi(page);
    await page.setViewportSize(PHONE);
    await page.goto(`${ADMIN}/integrations/wisphub`);
    await expect(page.getByText("Instalación en uso:")).toBeVisible();

    /* Choosing the wrong installation is a mis-tap that costs an ISP a
       failed connection and a support message, so the control has to be
       aimable — measured, not assumed. */
    const trigger = page.getByLabel("¿Dónde entras a WispHub?");
    expect((await trigger.boundingBox())!.height).toBeGreaterThanOrEqual(40);

    await trigger.click();
    for (const label of ["wisphub.net", "wisphub.io", "Pruebas (sandbox)"]) {
      const option = page.getByRole("option", { name: label });
      expect((await option.boundingBox())!.height, `${label} is too small to hit`).toBeGreaterThanOrEqual(32);
    }
  });
});

/* receipt-reader-tuning US3 (D19): the Lector tab and a bench receipt's
   side-by-side detail hold at the three widths — the columns stack under
   the picture below 768px, and nothing scrolls sideways. */
test.describe("receipt-reader-tuning US3: Lector at 360/768/1280", () => {
  for (const size of [PHONE, TABLET, DESKTOP]) {
    test(`Lector and the bench detail fit ${size.width}px`, async ({ page }) => {
      await stubOperatorReaderApi(page);
      await page.setViewportSize(size);
      await page.goto(`${ADMIN}/operador`);
      await page.getByRole("tab", { name: "Lector" }).click();
      await expect(page.getByText("Modelo que lee los comprobantes")).toBeVisible();
      await expectNoHorizontalScroll(page);
      await expectNothingClipped(page);

      await page.getByRole("button", { name: /Mistral Small 3\.1: leído/ }).click();
      await expect(page.getByRole("region", { name: "Mistral Small 3.1 · v2" })).toBeVisible();
      await expect(page.getByAltText("El comprobante de prueba")).toBeVisible();
      await expectNoHorizontalScroll(page);
      await expectNothingClipped(page);
    });
  }
});

/* cep-bundle-match T049: the two surfaces the feature added to the panel,
   in a real browser — the "Sin pago" list and the proof dialog's
   candidates, whose claves are long unbroken strings — at the three
   widths the floor sets */
test.describe("cep-bundle-match US1/US4: the decision and the unmatched list hold at 360/768/1280", () => {
  for (const size of [PHONE, TABLET, DESKTOP]) {
    test(`the 'Sin pago' list neither scrolls sideways nor clips at ${size.width}px`, async ({ page }) => {
      await stubAdminApi(page);
      await page.setViewportSize(size);
      await page.goto(ADMIN);
      await expect(page.getByText("Janely Guadalupe Reyes")).toBeVisible();
      await page.getByRole("tab", { name: "Sin pago" }).click();
      await expect(page.getByRole("list", { name: "Transferencias sin pago" })).toBeVisible();
      await expectNoHorizontalScroll(page);
      await expectNothingClipped(page);
    });

    test(`the proof dialog's candidates fit at ${size.width}px`, async ({ page }) => {
      await stubAdminApi(page);
      await page.setViewportSize(size);
      await page.goto(ADMIN);
      await page.getByRole("button", { name: /Janely Guadalupe Reyes/ }).first().click();
      await page.getByRole("button", { name: "Ver comprobante" }).first().click();
      const region = page.getByRole("region", { name: "Coincidencias" });
      await expect(region.getByText("Varias coincidencias · resuelta por cuenta y hora")).toBeVisible();
      await expectNoHorizontalScroll(page);
      const dialog = await page.getByRole("dialog").evaluate((d) => ({ scrollWidth: d.scrollWidth, clientWidth: d.clientWidth }));
      expect(dialog.scrollWidth, "the dialog scrolls sideways").toBeLessThanOrEqual(dialog.clientWidth + 1);
    });
  }
});

/* cash-at-stores US1, US3, US5 (T033, T060, T083; constitution VI; research D26): the store app
   is a counter on a shopkeeper's phone. At every width the floor sets it
   never scrolls sideways, never cuts a customer's name, every control
   clears 48px, and the decisive *Cobrar* clears 64px. */
const redScreens: { name: string; url: string; stub?: (page: Page) => Promise<void>; open?: (page: Page) => Promise<void>; ready: string }[] = [
  {
    name: "the search",
    url: `${RED}/`,
    open: async (page) => {
      await page.getByLabel("Buscar cliente").fill("guadalupe");
    },
    ready: "Guadalupe Reyes Hernández",
  },
  { name: "the debt", url: `${RED}/cobro/greyes@wifiplus`, ready: "Total a cobrar" },
  { name: "the result", url: `${RED}/cobros/pay-1`, ready: "DV-7K2Q9M" },
  { name: "Mi caja", url: `${RED}/caja`, ready: "WiFi Plus dice:" },
  { name: "the hand-over", url: `${RED}/caja/entrega?businessId=business-1`, ready: "La entrega quedará pendiente" },
  { name: "Movimientos", url: `${RED}/movimientos`, ready: "Corrección de Devolada" },
  /* T083: the ways in, the screens a session ends on, and the narrowed
     cash book — their links clear 48px too */
  { name: "Movimientos of one business", url: `${RED}/movimientos?businessId=business-1&kind=collection`, ready: "Ver todos" },
  { name: "the hand-overs", url: `${RED}/caja/entregas?businessId=business-1`, ready: "«Faltaron $200 en el sobre»" },
  { name: "the sign-in", url: `${RED}/entrar`, ready: "Olvidé mi contraseña" },
  { name: "the recovery", url: `${RED}/recuperar`, ready: "Volver a entrar" },
  { name: "the invitation", url: `${RED}/invitacion/tok-1`, ready: "Abarrotes Lupita" },
  {
    name: "the suspended store",
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
    name: "the wrong account",
    url: `${RED}/`,
    stub: async (page) => {
      await page.route("**/auth/me", (route) =>
        route.request().resourceType() === "document"
          ? route.fallback()
          : route.fulfill({ contentType: "application/json", body: JSON.stringify({ success: true, data: { type: "business" } }) }),
      );
    },
    ready: "Esta cuenta no es de una tienda",
  },
];

test.describe("cash-at-stores US1/US5: the store app at 360/768/1280", () => {
  for (const size of [PHONE, TABLET, DESKTOP]) {
    for (const screen of redScreens) {
      test(`${screen.name} fits ${size.width}px with 48px targets`, async ({ page }) => {
        await page.setViewportSize(size);
        await stubRedApi(page);
        await screen.stub?.(page);
        await page.goto(screen.url);
        await screen.open?.(page);
        await expect(page.getByText(screen.ready).first()).toBeVisible();
        await expectNoHorizontalScroll(page);
        await expectNothingClipped(page);
        await expectTouchTargets(page, 48);
      });
    }
  }

  test("Cobrar is the decisive action: 64px on a phone", async ({ page }) => {
    await page.setViewportSize(PHONE);
    await stubRedApi(page);
    await page.goto(`${RED}/cobro/greyes@wifiplus`);
    const collect = page.getByRole("button", { name: /^Cobrar \$/ });
    await expect(collect).toBeVisible();
    const box = await collect.boundingBox();
    expect(box!.height, "Cobrar's height").toBeGreaterThanOrEqual(64);
    /* the tabs a thumb reaches carry the same weight */
    const tab = await page.getByRole("navigation", { name: "Secciones" }).getByRole("link", { name: "Caja" }).boundingBox();
    expect(tab!.height, "a tab's height").toBeGreaterThanOrEqual(64);
  });
});

/* cash-at-stores T040, T051, T060: the panel's new screens hold at the
   widths they are used at — Tiendas on the operator's desktop and tablet,
   Pagos with a cash row and Puntos de pago down to the phone. */
test.describe("cash-at-stores US2/US4/US5: the panel's new screens", () => {
  for (const size of [TABLET, DESKTOP]) {
    test(`Tiendas and a store's cash book fit ${size.width}px`, async ({ page }) => {
      await page.setViewportSize(size);
      await stubOperatorStoresApi(page);
      await page.goto(`${ADMIN}/operador`);
      await page.getByRole("tab", { name: "Tiendas" }).click();
      await page.getByRole("button", { name: /WiFi Plus · tiene/ }).click();
      await expect(page.getByText("Registrar corrección").first()).toBeVisible();
      await expectNoHorizontalScroll(page);
      await expectNothingClipped(page);
    });
  }

  for (const size of [PHONE, TABLET, DESKTOP]) {
    test(`Puntos de pago fits ${size.width}px`, async ({ page }) => {
      await page.setViewportSize(size);
      await stubCashPointsApi(page);
      await page.goto(`${ADMIN}/puntos-de-pago`);
      await page.getByRole("button", { name: "Ver entregas" }).first().click();
      await expect(page.getByText("«Faltaron $200 en el sobre»")).toBeVisible();
      await expectNoHorizontalScroll(page);
      await expectNothingClipped(page);
    });

    test(`a cash row in Pagos fits ${size.width}px`, async ({ page }) => {
      await page.setViewportSize(size);
      await stubAdminStoreApi(page);
      await page.goto(ADMIN);
      await page.getByRole("button", { name: /Mario Pérez Castañeda/ }).click();
      await expect(page.getByText("Cargo por servicio en tienda")).toBeVisible();
      await expectNoHorizontalScroll(page);
      await expectNothingClipped(page);
    });
  }

  test("the channel filter clears 44px on a phone", async ({ page }) => {
    await page.setViewportSize(PHONE);
    await stubAdminStoreApi(page);
    await page.goto(ADMIN);
    await expect(page.getByRole("group", { name: "Canal" })).toBeVisible();
    await expectTouchTargets(page, 44, 'section[aria-label="Filtros"]');
  });
});
