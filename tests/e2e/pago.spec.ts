import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { PAGO } from "../../playwright.config";
import {
  longTrackingKey,
  stubPagoApi,
  stubPagoConfirmedOwn,
  stubPagoKeylessReading,
  stubPagoReference,
  stubPagoSurplusReading,
} from "./stubs";

/* docs/legacy/direct-payment/direct-payment.spec.md (D16, D18, D19) — the
   customer's page in a real browser.

   happy-dom applies no stylesheet and reports no layout, so everything
   here is a question the component tests cannot answer: whether the
   values this page asks people to proofread actually fit on a phone,
   and whether the two steps hold up at the 360px floor. */

const PHONE = { width: 360, height: 740 }; /* the floor FRONTEND.md sets */

async function open(page: Page) {
  await stubPagoApi(page);
  await page.setViewportSize(PHONE);
  await page.goto(`${PAGO}/p/tok123`);
  await page.getByRole("heading", { name: /haz tu transferencia/i }).waitFor();
}

/* A field whose content runs past its own box shows the payer a prefix
   and hides the rest behind a caret they have to drag. */
async function expectFullyVisible(page: Page, selector: string, what: string) {
  const overflow = await page.locator(selector).evaluate((el: HTMLInputElement) => ({
    scroll: el.scrollWidth,
    client: el.clientWidth,
    value: el.value,
  }));
  expect(
    overflow.scroll,
    `${what} is clipped: ${overflow.scroll}px of "${overflow.value}" in ${overflow.client}px`,
  ).toBeLessThanOrEqual(overflow.client + 1);
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

test.describe("US-D09: the payer can read what they are asked to confirm", () => {
  /* BUG-009. D18's whole point is that the human checks the machine's
     reading — and the field was showing about 24 of the 28 characters,
     so the tail nobody could see was the part most likely to be wrong.

     The door changed under this test, so the test moved to the door
     rather than the other way round. Until two-eyes-receipt D13 any
     reading with a hole in it opened the confirmation screen, and a
     plain upload landed here. It does not any more: a hole goes to the
     provider and nobody is asked (FR-005), so an upload now reaches
     `validating` with no field on screen at all — which is what made
     this test fail on main rather than any change to the field.

     One door is left, and it is the one that matters most: a reading
     above the debt, where claimed-amount D2 shows the payer both
     numbers and asks for consent instead of refusing. "Corregir los
     datos" is what opens the machine's reading for proofreading there,
     and the clave it pre-fills is still 28 characters on a 360px
     phone. */
  test("the clave de rastreo fits its field at the 360px floor", async ({ page }) => {
    await open(page);
    await stubPagoSurplusReading(page);

    await page.getByRole("button", { name: /ya hice mi transferencia/i }).click();
    await page.locator('input[type="file"]').setInputFiles({
      name: "cep.png",
      mimeType: "image/png",
      buffer: Buffer.alloc(120),
    });
    await page.getByRole("button", { name: /enviar comprobante/i }).click();

    await page.getByRole("button", { name: /corregir los datos/i }).click();

    const field = page.getByLabel(/clave de rastreo/i);
    await expect(field).toHaveValue(longTrackingKey);
    await expectFullyVisible(page, "#" + (await field.getAttribute("id"))!, "the clave de rastreo");
  });

  test("the same field fits when the payer types it by hand", async ({ page }) => {
    await open(page);

    await page.getByRole("button", { name: /ya hice mi transferencia/i }).click();
    await page.getByRole("button", { name: /no tengo el comprobante/i }).click();
    const field = page.getByLabel(/clave de rastreo/i);
    await field.fill(longTrackingKey);
    await expectFullyVisible(page, "#" + (await field.getAttribute("id"))!, "the clave de rastreo");
  });
});

test.describe("US-D01: the two steps hold at the phone floor (D19)", () => {
  test("step 1 does not scroll sideways, and every control is thumb-sized", async ({ page }) => {
    await open(page);
    await expectNoHorizontalScroll(page);
    /* The CLABE is 18 digits next to a copy button on a 360px screen */
    await expect(page.getByText("646180157000000004")).toBeVisible();

    await page.getByRole("button", { name: /ver los demás datos/i }).click();
    await expect(page.getByText("WifiPlus SA de CV")).toBeVisible();
    await expectNoHorizontalScroll(page);
  });

  test("step 2's upload target is a real tap area, not the platform's control", async ({ page }) => {
    await open(page);
    await page.getByRole("button", { name: /ya hice mi transferencia/i }).click();

    /* The input is visually hidden; the label is what the thumb hits, and
       the native "Choose File" is what it exists to replace (D10). */
    const dropzone = page.locator('label[for]', { hasText: /toca para subir/i });
    const box = (await dropzone.boundingBox())!;
    expect(box.height).toBeGreaterThanOrEqual(64);
    await expectNoHorizontalScroll(page);
  });
});

/* design-foundations US1 (converge F4). The payer had no width coverage above
   360: this file checked the phone floor and tests/e2e/responsive.spec.ts
   imports ADMIN only. That was survivable until 001 wrapped every outcome
   branch in a Reveal carrying its own spacing — changing the DOM inside the
   status Card is exactly the edit that shifts layout at a width nobody looks
   at. FRONTEND floor 360, designed at 375, and the two widths above it. */
const WIDTHS = [
  { name: "375 (design width)", width: 375, height: 812 },
  { name: "768 (tablet)", width: 768, height: 1024 },
  { name: "1280 (desktop)", width: 1280, height: 900 },
] as const;

const envelope = (data: unknown) => ({
  status: 200,
  contentType: "application/json",
  body: JSON.stringify({ success: true, data }),
});

/* Park the payer on the validating screen: the one 001 rebuilt. */
async function openWaiting(page: Page) {
  await stubPagoApi(page);
  await page.route("**/direct-payments/links/*/read", (route) =>
    route.fulfill(
      envelope({
        source: "reader",
        isReceipt: true,
        amountCents: 51400,
        trackingKey: longTrackingKey,
        senderBank: "STP",
        date: "2026-08-19",
        receiptStatus: "Aceptada",
        gate: { trackingKey: "ok", senderBank: "ok", amount: "ok" },
      }),
    ),
  );
  await page.route("**/direct-payments/links/*/pay", (route) =>
    route.fulfill(envelope({ directPaymentId: "dp-1", status: "validating", error: null })),
  );
  await page.route("**/direct-payments/*/status", (route) =>
    route.fulfill(
      envelope({
        status: "validating",
        validationAttempts: 1,
        nextValidationAt: null,
        error: null,
        receiptStatus: "Aceptada",
      }),
    ),
  );
  await page.goto(`${PAGO}/p/tok123`);
  await page.getByRole("button", { name: /ya hice mi transferencia/i }).click();
  await page.locator('input[type="file"]').setInputFiles({
    name: "cep.png",
    mimeType: "image/png",
    buffer: Buffer.alloc(120),
  });
  await page.getByRole("button", { name: /enviar comprobante/i }).click();
  await expect(page.getByText(/estamos verificando tu transferencia/i)).toBeVisible();
}

test.describe("design-foundations US1: the payer's page holds at all three widths", () => {
  for (const size of WIDTHS) {
    test(`the transfer step does not scroll sideways at ${size.name}`, async ({ page }) => {
      await stubPagoApi(page);
      await page.setViewportSize({ width: size.width, height: size.height });
      await page.goto(`${PAGO}/p/tok123`);
      await page.getByRole("heading", { name: /haz tu transferencia/i }).waitFor();
      await expectNoHorizontalScroll(page);
    });

    test(`the waiting screen does not scroll sideways at ${size.name}`, async ({ page }) => {
      await page.setViewportSize({ width: size.width, height: size.height });
      await openWaiting(page);
      await expectNoHorizontalScroll(page);
    });
  }
});

/* receipt-triage US4 (D8, D20; FR-023, FR-026): the capture guide in a real
   browser — the questions happy-dom cannot answer. Width at the floor and
   above it, real contrast in both themes, the breath's computed duration
   under reduced motion, no transform anywhere in the guide, and a keyboard
   that reaches the upload control with a focus ring it can see. */
test.describe("receipt-triage US4: the capture guide", () => {
  async function openUpload(page: Page, width = 360, height = 740) {
    await stubPagoApi(page);
    await page.setViewportSize({ width, height });
    await page.goto(`${PAGO}/p/tok123`);
    await page.getByRole("button", { name: /ya hice mi transferencia/i }).click();
    await page.getByRole("heading", { name: "Tu captura debe mostrar" }).waitFor();
  }

  for (const width of [360, 768, 1280]) {
    test(`the upload step with the guide does not scroll sideways at ${width}px`, async ({ page }) => {
      await openUpload(page, width, 900);
      await expectNoHorizontalScroll(page);
    });
  }

  for (const theme of ["light", "dark"] as const) {
    test(`the guide and the ask have no contrast violations in ${theme}`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: theme });
      await openUpload(page);
      await stubPagoKeylessReading(page);
      await page.locator('input[type="file"]').setInputFiles({ name: "cep.png", mimeType: "image/png", buffer: Buffer.alloc(120) });
      await page.getByRole("button", { name: /enviar comprobante/i }).click();
      await page.getByRole("heading", { name: "Lo que vimos en tu captura" }).waitFor();
      /* measured at rest: mid-fade, every ink reads lighter than it is */
      await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== "running" || a.effect?.getTiming().iterations === Infinity));
      const results = await new AxeBuilder({ page }).withRules(["color-contrast", "target-size"]).analyze();
      expect(
        results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => `${n.html.slice(0, 90)} → ${n.failureSummary?.split("\n").slice(-1)[0]}`).join(" | ")}`),
        theme,
      ).toEqual([]);
    });
  }

  test("under reduced motion the reading still breathes, and nothing in the guide moves", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await openUpload(page);
    /* the reading never answers, so the guide stays in its waiting state */
    await page.route("**/direct-payments/links/*/read", () => new Promise(() => {}));
    await page.locator('input[type="file"]').setInputFiles({ name: "cep.png", mimeType: "image/png", buffer: Buffer.alloc(120) });
    await page.getByRole("button", { name: /enviar comprobante/i }).click();
    const tile = page.locator("[data-item] [data-motion='breath']").first();
    await expect(tile).toBeVisible();
    const duration = await tile.evaluate((el) => getComputedStyle(el).animationDuration);
    expect(duration).toBe("2.4s");
    const transforms = await page
      .locator("[data-item]")
      .evaluateAll((els) =>
        els.flatMap((el) => [el, ...el.querySelectorAll("*")]).map((el) => getComputedStyle(el).transform),
      );
    expect(transforms.filter((t) => t !== "none")).toEqual([]);
  });

  test("the upload control is reached by keyboard, with a focus ring the eye can see", async ({ page }) => {
    await openUpload(page);
    const dropzone = page.locator("label[for]", { hasText: /toca para subir/i });
    const resting = await dropzone.evaluate((el) => getComputedStyle(el).boxShadow);
    for (let i = 0; i < 20; i++) {
      await page.keyboard.press("Tab");
      if (await page.evaluate(() => (document.activeElement as HTMLInputElement | null)?.type === "file")) break;
    }
    expect(await page.evaluate(() => (document.activeElement as HTMLInputElement | null)?.type)).toBe("file");
    const focused = await dropzone.evaluate((el) => getComputedStyle(el).boxShadow);
    expect(focused).not.toBe("none");
    expect(focused).not.toBe(resting);
  });
});

/* payment-without-receipt US2 (T051; contracts/payment-page.md,
   "Constitution VI"): the reference on step 1 and "Confirma tu pago" in a
   real browser — what happy-dom cannot answer. Every choice is a 48px
   target, "Confirmar pago" is the 64px decisive action, a choice shows a
   focus ring the eye can see on the row (its radio is visually hidden),
   nothing scrolls sideways from the 360px floor up, and axe runs with
   contrast and target size ON, in both themes. */
test.describe("payment-without-receipt US2: step 1 and 'Confirma tu pago' in a real browser", () => {
  /* measured at rest: mid-fade, every ink reads lighter than it is */
  async function settled(page: Page) {
    await page.waitForFunction(() =>
      document
        .getAnimations()
        .every((a) => a.playState !== "running" || a.effect?.getTiming().iterations === Infinity),
    );
  }

  async function expectAxeClean(page: Page, what: string) {
    await settled(page);
    const results = await new AxeBuilder({ page }).analyze();
    expect(
      results.violations.map(
        (v) =>
          `${v.id}: ${v.nodes.map((n) => `${n.html.slice(0, 90)} → ${n.failureSummary?.split("\n").slice(-1)[0]}`).join(" | ")}`,
      ),
      what,
    ).toEqual([]);
  }

  async function openReference(page: Page, width: number) {
    await stubPagoApi(page);
    await stubPagoReference(page);
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`${PAGO}/p/tok123`);
    await page.getByRole("heading", { name: /haz tu transferencia/i }).waitFor();
  }

  for (const width of [360, 768, 1280]) {
    for (const theme of ["light", "dark"] as const) {
      test(`step 1 and the confirmation hold at ${width}px in ${theme}`, async ({ page }) => {
        await page.emulateMedia({ colorScheme: theme });
        await openReference(page, width);

        /* Step 1: the reference in its own box (confirmation-hierarchy US5) */
        await expect(page.getByRole("region", { name: "Tu referencia" }).getByText("234 5678")).toBeVisible();
        await expectNoHorizontalScroll(page);
        await expectAxeClean(page, `step 1 at ${width}px, ${theme}`);

        await page.getByRole("button", { name: /ya hice mi transferencia/i }).click();
        await page.getByRole("heading", { name: "Confirma tu pago" }).waitFor();

        /* Open both "otro" fields too: the select and the date field are
           what could push the page wider than the phone. The row is what
           a thumb taps — the radio inside it is visually hidden (D21). */
        await page.locator("fieldset label", { hasText: "Otro banco" }).click();
        await page.locator("fieldset label", { hasText: "Otro día" }).click();
        await expect(page.getByRole("radio", { name: "Otro banco" })).toBeChecked();
        await expect(page.getByRole("radio", { name: "Otro día" })).toBeChecked();
        await expect(page.getByLabel("Elige tu banco")).toBeVisible();
        await expect(page.getByLabel("Fecha de la transferencia")).toBeVisible();

        /* D21: every choice is a 48px target — the whole row is the label */
        const rows = page.locator("fieldset label");
        const count = await rows.count();
        expect(count).toBe(6);
        for (let i = 0; i < count; i++) {
          const box = (await rows.nth(i).boundingBox())!;
          expect(box.height, `choice ${i + 1} is ${box.height}px tall`).toBeGreaterThanOrEqual(48);
        }
        /* the decisive action, declared at 64px (constitution VI) */
        const confirm = page.getByRole("button", { name: "Confirmar pago" });
        expect((await confirm.boundingBox())!.height).toBe(64);
        /* the other ways keep the touch size (confirmation-hierarchy US1,
           T037: 012's two small exits became option 2 and the receipt link) */
        for (const name of ["Pagué otra cantidad", "Usé otra referencia", "Subir foto del comprobante"]) {
          const exit = (await page.getByRole("button", { name }).boundingBox())!;
          expect(exit.height, name).toBeGreaterThanOrEqual(48);
        }

        await expectNoHorizontalScroll(page);
        await expectAxeClean(page, `Confirma tu pago at ${width}px, ${theme}`);
      });
    }
  }

  test("a choice shows a focus ring the eye can see, and the arrow keys move the choice", async ({ page }) => {
    await openReference(page, 360);
    await page.getByRole("button", { name: /ya hice mi transferencia/i }).click();
    await page.getByRole("heading", { name: "Confirma tu pago" }).waitFor();

    const azteca = page.locator("fieldset label", { hasText: "Banco Azteca" });
    const resting = await azteca.evaluate((el) => getComputedStyle(el).boxShadow);
    for (let i = 0; i < 20; i++) {
      await page.keyboard.press("Tab");
      if (await page.evaluate(() => (document.activeElement as HTMLInputElement | null)?.type === "radio")) break;
    }
    /* the group's one tab stop is its chosen radio, and the ring is drawn
       on the row around it */
    await expect(page.getByRole("radio", { name: "Banco Azteca" })).toBeFocused();
    const focused = await azteca.evaluate((el) => getComputedStyle(el).boxShadow);
    expect(focused).not.toBe("none");
    expect(focused).not.toBe(resting);

    await page.keyboard.press("ArrowDown");
    await expect(page.getByRole("radio", { name: "Nu" })).toBeChecked();
    await expect(page.getByRole("radio", { name: "Nu" })).toBeFocused();
    /* confirmation-hierarchy D18: a chip says it is chosen with its check
       icon and its outline, never colour alone */
    const nu = page.locator("fieldset label", { hasText: /^Nu$/ });
    await expect(nu.locator("svg")).toHaveCount(1);
    await expect(azteca.locator("svg")).toHaveCount(0);
    expect(await nu.evaluate((el) => getComputedStyle(el).outlineStyle)).not.toBe("none");
    await expect(page.getByText(/desde Nu, hoy/)).toBeVisible();
  });
});

/* specs/017-confirmation-hierarchy (tasks T009, T041; constitution VI) —
   the step's three options and proposal E in a real browser: what
   happy-dom cannot measure. Sizes (64px for the one decisive action, 48px
   for every other target), a focus ring the eye can see on each, Tab order
   equal to the visual order, no sideways scroll from the 360px floor up,
   and axe with contrast and target size ON, in both themes. */
test.describe("confirmation-hierarchy US1, US5: the three options and proposal E in a real browser", () => {
  async function settled(page: Page) {
    await page.waitForFunction(() =>
      document
        .getAnimations()
        .every((a) => a.playState !== "running" || a.effect?.getTiming().iterations === Infinity),
    );
  }

  async function expectAxeClean(page: Page, what: string) {
    await settled(page);
    const results = await new AxeBuilder({ page }).analyze();
    expect(
      results.violations.map(
        (v) =>
          `${v.id}: ${v.nodes.map((n) => `${n.html.slice(0, 90)} → ${n.failureSummary?.split("\n").slice(-1)[0]}`).join(" | ")}`,
      ),
      what,
    ).toEqual([]);
  }

  async function openReference(page: Page, width: number, kind: "clabe" | "card" | "phone" = "clabe") {
    await stubPagoApi(page);
    await stubPagoReference(page, kind);
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`${PAGO}/p/tok123`);
    await page.getByRole("heading", { name: /haz tu transferencia/i }).waitFor();
  }

  /* The ring is measured, not assumed: focused, the control draws a box
     shadow (or an outline) it did not draw at rest. It is reached by the
     keyboard — Shift+Tab away and Tab back — because a ring is drawn for
     `:focus-visible`, which a programmatic focus after a tap never is. */
  async function expectFocusRing(page: Page, name: string | RegExp, role: "button" | "radio" = "button") {
    const control = page.getByRole(role, { name }).first();
    const target = role === "radio" ? control.locator("xpath=ancestor::label") : control;
    const rest = await target.evaluate((el) => `${getComputedStyle(el).boxShadow}|${getComputedStyle(el).outlineStyle}`);
    await control.focus();
    await page.keyboard.press("Shift+Tab");
    await page.keyboard.press("Tab");
    await expect(control).toBeFocused();
    await page.waitForTimeout(250);
    const focused = await target.evaluate((el) => `${getComputedStyle(el).boxShadow}|${getComputedStyle(el).outlineStyle}`);
    expect(focused, `${name} shows no focus ring`).not.toBe(rest);
  }

  async function height(page: Page, name: string | RegExp) {
    return (await page.getByRole("button", { name }).first().boundingBox())!.height;
  }

  for (const width of [360, 768, 1280]) {
    for (const theme of ["light", "dark"] as const) {
      test(`the confirmation, option 2 and the receipt view hold at ${width}px in ${theme} (T009)`, async ({ page }) => {
        await page.emulateMedia({ colorScheme: theme });
        await openReference(page, width);
        await page.getByRole("button", { name: /ya hice mi transferencia/i }).click();
        await page.getByRole("heading", { name: "Confirma tu pago" }).waitFor();

        /* D2: one decisive 64px action; option 2 and the receipt link 48px */
        expect(await height(page, "Confirmar pago")).toBe(64);
        expect(await height(page, "Usé otra referencia")).toBeGreaterThanOrEqual(48);
        expect(await height(page, "Subir foto del comprobante")).toBeGreaterThanOrEqual(48);
        for (const name of ["Confirmar pago", "Usé otra referencia", "Subir foto del comprobante"]) await expectFocusRing(page, name);

        /* FR-008: Tab reaches option 1, then option 2, then the receipt */
        await page.getByRole("button", { name: "Confirmar pago" }).focus();
        await page.keyboard.press("Tab");
        await expect(page.getByRole("button", { name: "Usé otra referencia" })).toBeFocused();
        await page.keyboard.press("Tab");
        await expect(page.getByRole("button", { name: "Subir foto del comprobante" })).toBeFocused();
        await expectNoHorizontalScroll(page);
        await expectAxeClean(page, `the confirmation at ${width}px, ${theme}`);

        /* option 2 */
        await page.getByRole("button", { name: "Usé otra referencia" }).click();
        await page.getByRole("heading", { name: "Usé otra referencia" }).waitFor();
        expect(await height(page, /^Volver$/)).toBeGreaterThanOrEqual(48);
        expect(await height(page, "Subir foto del comprobante")).toBeGreaterThanOrEqual(48);
        await expectFocusRing(page, /^Volver$/);
        await page.getByRole("button", { name: /^Volver$/ }).focus();
        await page.keyboard.press("Tab");
        await expect(page.getByRole("button", { name: "Subir foto del comprobante" })).toBeFocused();
        await expectNoHorizontalScroll(page);
        await expectAxeClean(page, `option 2 at ${width}px, ${theme}`);

        /* option 3 */
        await page.getByRole("button", { name: "Subir foto del comprobante" }).click();
        await page.getByRole("heading", { name: /envía tu comprobante/i }).waitFor();
        expect(await height(page, /^Volver$/)).toBeGreaterThanOrEqual(48);
        await expectNoHorizontalScroll(page);
        await expectAxeClean(page, `the receipt view at ${width}px, ${theme}`);
      });

      test(`proposal E's targets, contrast and width hold at ${width}px in ${theme} (T041)`, async ({ page }) => {
        await page.emulateMedia({ colorScheme: theme });
        await openReference(page, width);
        /* step 1: the copy buttons and "Ver otra vez" are touch targets */
        expect(await height(page, "Copiar Tu referencia")).toBeGreaterThanOrEqual(48);
        expect(await height(page, "Copiar CLABE")).toBeGreaterThanOrEqual(48);
        expect(await height(page, "Ver otra vez")).toBeGreaterThanOrEqual(48);
        for (const name of ["Copiar Tu referencia", "Ver otra vez"]) await expectFocusRing(page, name);
        /* the reference's box and the tags pass contrast, axe's rule on */
        await expectAxeClean(page, `step 1 at ${width}px, ${theme}`);

        await page.getByRole("button", { name: /ya hice mi transferencia/i }).click();
        await page.getByRole("heading", { name: "Confirma tu pago" }).waitFor();
        const chips = page.locator("fieldset label");
        for (let i = 0; i < (await chips.count()); i++) {
          expect((await chips.nth(i).boundingBox())!.height).toBeGreaterThanOrEqual(48);
        }
        await expectFocusRing(page, "Banco Azteca", "radio");
        expect(await height(page, "¿Por qué te preguntamos esto?")).toBeGreaterThanOrEqual(48);
        await expectFocusRing(page, "¿Por qué te preguntamos esto?");
        await page.getByRole("button", { name: "¿Por qué te preguntamos esto?" }).click();
        await page.getByRole("button", { name: "Usé otra referencia" }).click();
        await page.getByRole("heading", { name: "Usé otra referencia" }).waitFor();
        await expectAxeClean(page, `option 2's tags at ${width}px, ${theme}`);
      });
    }
  }

  for (const kind of ["clabe", "card", "phone"] as const) {
    test(`no sideways scroll at 360px with a ${kind} (T041)`, async ({ page }) => {
      await openReference(page, 360, kind);
      await expect(page.getByRole("region", { name: "Transfiere a" })).toBeVisible();
      await expectNoHorizontalScroll(page);
    });
  }

  test("with reduced motion the example shows all four values at once, and nothing in step 1 moves (T041, D20)", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await openReference(page, 360);
    const example = page.getByRole("region", { name: "Así se llena en tu app" });
    for (const text of ["646180157000000004", "$514.00", "234 5678", "Opcional: lo que quieras"]) {
      const value = example.getByText(text, { exact: true });
      await expect(value).toBeVisible();
      expect(await value.evaluate((el) => getComputedStyle(el).clipPath)).toMatch(/^(none|inset\(0(px)?( 0(px)?)*\))$/);
    }
    const moving = await page.evaluate(() =>
      document
        .getAnimations()
        .filter((a) => a.playState === "running")
        .map((a) => (a as CSSAnimation).animationName ?? "")
        .filter((name) => /step-rise|example-|reference-glow/.test(name)),
    );
    expect(moving).toEqual([]);
  });

  /* T052 (D17, D20; contracts/payment-page.md "Motion"): the confirmed
     check draws once on the slow duration — and with reduced motion it is
     there, drawn, with no keyframe at all */
  for (const motion of ["no-preference", "reduce"] as const) {
    test(`the confirmed check ${motion === "reduce" ? "shows drawn with reduced motion" : "draws itself once"} (T052)`, async ({ page }) => {
      await page.emulateMedia({ reducedMotion: motion });
      await stubPagoApi(page);
      await stubPagoConfirmedOwn(page);
      await page.setViewportSize({ width: 360, height: 900 });
      await page.goto(`${PAGO}/p/tok123`);
      const check = page.locator(".check-draw svg path");
      await expect(page.getByText("Folio DV-OWN")).toBeVisible();
      await expect(check).toHaveCount(1);
      expect(await check.evaluate((el) => getComputedStyle(el).animationName)).toBe(motion === "reduce" ? "none" : "check-draw");
      await settled(page);
      /* at rest the stroke is whole: nothing of the check is left undrawn */
      expect(Number.parseFloat(await check.evaluate((el) => getComputedStyle(el).strokeDashoffset))).toBe(0);
    });
  }
});
