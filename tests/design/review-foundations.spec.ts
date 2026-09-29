import { expect, test, type Page } from "@playwright/test";
import { ADMIN } from "../../playwright.config";
import { PAGO } from "../../playwright.config";
import {
  businessActor,
  feed,
  cobros,
  integrationsHub,
  customersBlock,
  proofReading,
  stubPagoApi,
} from "../e2e/stubs";

/* design-foundations US2 — the three modal surfaces, photographed so their
   dimming can be compared as images rather than argued about.

   The claim under review: one stacking order and one dimming treatment. A
   dialog, a sheet and a confirmation each used to hand-mix their own black —
   bg-black/50, bg-black/50 and bg-ink/40 — and all three sat at z-50, so the
   order came from whichever Radix portalled last.

   Run just this file:
   pnpm exec playwright test --config playwright.review.config.ts tests/design/review-foundations.spec.ts */

const OUT = ".design/screenshots";

const envelope = (data: unknown) => ({
  status: 200,
  contentType: "application/json",
  body: JSON.stringify({ success: true, data }),
});

function json(page: Page, pattern: string, data: unknown) {
  return page.route(pattern, (route) =>
    route.request().resourceType() === "document" ? route.fallback() : route.fulfill(envelope(data)),
  );
}

const members = {
  members: [
    { id: "m-owner", userId: "user-1", name: "Leo", email: "demo@devolada.app", role: "owner", createdAt: 1 },
    { id: "m-op", userId: "user-2", name: "Ana", email: "ana@wifiplus.mx", role: "operator", createdAt: 2 },
  ],
  invitations: [],
  /* Without this the row offers no controls at all: mayInvite is
     `grantable.length > 0`, so an empty list renders a plain role label and
     the confirmation is unreachable. */
  grantable: ["admin", "operator", "viewer"],
};

const proof = {
  folio: "DV-FEED01",
  proofMode: "transfer",
  cep: {
    trackingKey: "NU3AGKMP3ASP8QQQ4U8J8F0K1E4K",
    amountCents: 41400,
    date: "2026-08-19",
    senderBank: "NUBANK",
    senderName: "Janely Guadalupe Reyes",
    beneficiaryName: "WifiPlus SA de CV",
  },
  imageUrl: null,
};

async function stubAdmin(page: Page) {
  await json(page, "**/auth/me", businessActor);
  await json(page, "**/payments/feed*", feed);
  /* cobros-in-links D1: the block carries `?limit=` */
  await json(page, "**/payment-requests*", cobros);
  await json(page, "**/integrations", integrationsHub);
  await json(page, "**/direct-payments/customers*", customersBlock);
  await json(page, "**/businesses/members", members);
  await json(page, "**/payments/*/proof", proof);
}

/* Each surface, and the act that opens it. */
const surfaces = [
  {
    slug: "foundations-dialog",
    width: 1280,
    url: ADMIN,
    ready: "Janely Guadalupe Reyes",
    open: async (page: Page) => {
      /* The charge row is a Collapsible; the proof button lives inside it. */
      await page.getByRole("button", { name: /Janely Guadalupe Reyes/ }).first().click();
      await page.getByRole("button", { name: "Ver comprobante" }).first().click();
      await expect(page.getByRole("dialog")).toBeVisible();
    },
  },
  {
    slug: "foundations-sheet",
    width: 375,
    url: ADMIN,
    ready: "Janely Guadalupe Reyes",
    open: async (page: Page) => {
      await page.getByRole("button", { name: "Fechas" }).click();
      await expect(page.getByText("Fechas", { exact: true }).last()).toBeVisible();
    },
  },
  {
    slug: "foundations-confirmation",
    width: 1280,
    url: `${ADMIN}/settings/users`,
    ready: "Ana",
    open: async (page: Page) => {
      await page.getByRole("button", { name: "Quitar" }).first().click();
      await expect(page.getByRole("alertdialog")).toBeVisible();
    },
  },
] as const;

for (const surface of surfaces) {
  for (const theme of ["light", "dark"] as const) {
    test(`${surface.slug} ${surface.width} ${theme}`, async ({ page }) => {
      await page.setViewportSize({ width: surface.width, height: surface.width < 500 ? 812 : 800 });
      await page.emulateMedia({ colorScheme: theme });
      await stubAdmin(page);
      await page.goto(surface.url);
      await expect(page.getByText(surface.ready).first()).toBeVisible({ timeout: 15_000 });
      await surface.open(page);
      await page.waitForTimeout(400);

      const suffix = theme === "dark" ? "-dark" : "";
      /* Not fullPage: the dimming is a fixed layer, and a full-page capture
         of a fixed element photographs the scroll position rather than the
         screen the person is looking at. */
      await page.screenshot({ path: `${OUT}/review-${surface.slug}-${surface.width}${suffix}.png` });
    });
  }
}

/* T027 could not be captured as written: it asked for a confirmation opened
   from an open sheet, and the product has no such pairing — the only sheet
   holds a calendar. Inventing a screen to photograph would prove nothing
   about the product.

   What the picture was meant to establish is that the order RESOLVES instead
   of falling out of portal order, and that is a number, not an image. So this
   reads the numbers off the live DOM. It is the stronger check: three
   screenshots of surfaces that never overlap cannot show a wrong order, while
   a wrong number here is unambiguous. */
test("foundations-stacking: every surface sits where the scale says", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await stubAdmin(page);
  await page.goto(ADMIN);
  await expect(page.getByText("Janely Guadalupe Reyes").first()).toBeVisible({ timeout: 15_000 });

  await page.getByRole("button", { name: /Janely Guadalupe Reyes/ }).first().click();
  await page.getByRole("button", { name: "Ver comprobante" }).first().click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();

  const layers = await dialog.evaluate((el) => {
    const dimming = el.previousElementSibling!;
    /* Resolve the token through the browser, so both sides of the comparison
       come back in the same notation. Comparing against the raw custom
       property text would compare "rgb(28 25 23 / 0.45)" with "rgba(28, 25,
       23, 0.45)" and fail on formatting alone. */
    const probe = document.createElement("div");
    probe.style.backgroundColor = "var(--color-surface-overlay)";
    document.body.appendChild(probe);
    const expected = getComputedStyle(probe).backgroundColor;
    probe.remove();

    return {
      modal: getComputedStyle(el).zIndex,
      dimming: getComputedStyle(dimming).zIndex,
      background: getComputedStyle(dimming).backgroundColor,
      expected,
    };
  });

  expect(layers.modal, "the modal surface sits on the modal layer").toBe("40");
  expect(layers.dimming, "the dimming sits one layer below it, not level with it").toBe("30");
  expect(layers.background, "the dimming is the shared token, not a hand-mixed black").toBe(
    layers.expected,
  );
});

/* design-foundations US1, T047 — the breath, for a person to settle.

   A still image cannot show a 2.4s animation, so these freeze it at its two
   ends: full strength, and the 0.70 floor it descends to. Put the pair side by
   side and you are looking at the whole amplitude, which is the thing being
   judged — is this present without insisting, next to the copy it accompanies,
   on a phone?

   Changing the answer means two numbers in tokens.css. Nothing else moves. */
for (const phase of ["peak", "trough"] as const) {
  for (const theme of ["light", "dark"] as const) {
    test(`foundations-breath-${phase} 375 ${theme}`, async ({ page }) => {
      await page.setViewportSize({ width: 375, height: 812 });
      await page.emulateMedia({ colorScheme: theme });
      await stubPagoApi(page);
      await page.route("**/direct-payments/links/*/read", (route) =>
        route.fulfill(
          envelope({
            ...proofReading,
            senderBank: "STP",
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

      await page.goto(`${PAGO}/p/tok-breath`);
      await page.getByRole("button", { name: /ya hice mi transferencia/i }).click();
      await page.locator('input[type="file"]').setInputFiles({
        name: "cep.png",
        mimeType: "image/png",
        buffer: Buffer.alloc(120),
      });
      await page.getByRole("button", { name: /enviar comprobante/i }).click();
      await expect(page.getByText(/estamos verificando tu transferencia/i)).toBeVisible();

      const breathing = page.locator('[data-motion="breath"]');
      await expect(breathing).toBeVisible();

      /* Read the floor from the token, so these captures follow it if it moves. */
      const floor = await page.evaluate(() =>
        Number(
          getComputedStyle(document.documentElement).getPropertyValue("--opacity-breath").trim(),
        ),
      );
      expect(floor, "--opacity-breath must be readable, or the trough is a guess").toBeGreaterThan(0);
      const phaseOpacity = phase === "peak" ? 1 : floor;
      /* Pin the opacity instead of freezing the animation.

         Two earlier attempts failed quietly. A negative animation-delay does
         not reposition an already-paused animation, so both frames came out
         identical. Pausing through the Web Animations API does move
         getComputedStyle — the assertion below passed — but an opacity
         animation runs on the compositor, and the captured frame did not
         follow: the two images still differed by a channel delta of 2 where
         0.70 of grey on white is a delta of about 35.

         So the animation is removed and the value set outright. The question
         being asked is what 0.70 LOOKS like beside this copy, and that
         question does not need the animation running to answer. */
      await breathing.evaluate((el, target) => {
        el.style.animation = "none";
        el.style.opacity = String(target);
      }, phaseOpacity);
      /* The mouse is wherever the last click left it; park it so a hover
         treatment cannot creep into the capture (baselines/README.md). */
      await page.mouse.move(0, 0);
      await page.waitForTimeout(200);

      const opacity = await breathing.evaluate((el) => getComputedStyle(el).opacity);
      expect(Number(opacity)).toBeCloseTo(phaseOpacity, 2);

      await page.screenshot({ path: `${OUT}/review-foundations-breath-${phase}-375-${theme}.png` });
    });
  }
}
