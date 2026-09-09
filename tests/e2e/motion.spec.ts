import { expect, test, type Page } from "@playwright/test";
import { ADMIN, PAGO } from "../../playwright.config";
import { proofReading, stubAdminApi, stubPagoApi } from "./stubs";

/* design-foundations US1 — the questions a simulated DOM cannot answer.

   happy-dom applies no stylesheet, so the component tests can only prove
   that `animate-breath` and `data-motion` are on the element. Whether the
   cascade then lets the animation RUN is a different question, and it is the
   one that can ship broken while every check stays green: under reduced
   motion a frozen pending screen and a working one are pixel-identical, so
   no screenshot review would ever catch it.

   Hence the assertion below is on the *computed* animation-duration. */

const envelope = (data: unknown) => ({
  status: 200,
  contentType: "application/json",
  body: JSON.stringify({ success: true, data }),
});

/* The payer's page, parked in the calm verification state: the transfer is
   with Banxico, no error, nothing for the payer to correct. */
async function openWaitingPayer(page: Page) {
  await stubPagoApi(page);
  /* Resolved on every field, so the confirmation screen has nothing left to
     ask and the flow reaches `validating` in one click. */
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

  await page.goto(`${PAGO}/p/tok123`);
  await page.getByRole("button", { name: /ya hice mi transferencia/i }).click();
  await page.locator('input[type="file"]').setInputFiles({
    name: "cep.png",
    mimeType: "image/png",
    buffer: Buffer.alloc(120),
  });
  await page.getByRole("button", { name: /enviar comprobante/i }).click();
  /* No confirmation step: every field came back resolved, so the silent
     inline attempt (D18) pays and the page lands on `validating` itself. */
  await expect(page.getByText(/estamos verificando tu transferencia/i)).toBeVisible();
}

/* Everything on the page that is REALLY running a movement.

   The blanket reduced-motion rule flattens an animation to 0.01ms, which is a
   declaration that moves nothing, so a flattened animation does not count.
   That distinction is the point: the back office's retry spinner IS a
   rotation, and the right question is whether it is allowed to turn when
   someone asked for less motion — not whether its keyframe exists. */
async function runningMovements(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    /* What each emitted keyframe animates. Tailwind only emits the keyframes
       an animation in use needs, so this is the real set, not the catalogue. */
    const animates: Record<string, string[]> = {};
    for (const sheet of Array.from(document.styleSheets)) {
      let rules: CSSRuleList;
      try {
        rules = sheet.cssRules;
      } catch {
        continue; /* a sheet we do not own */
      }
      for (const rule of Array.from(rules)) {
        if (rule.constructor.name !== "CSSKeyframesRule") continue;
        const frames = rule as CSSKeyframesRule;
        const props = new Set<string>();
        for (const frame of Array.from(frames.cssRules)) {
          const style = (frame as CSSKeyframeRule).style;
          for (let i = 0; i < style.length; i++) props.add(style[i]);
        }
        animates[frames.name] = Array.from(props);
      }
    }

    const MOVEMENT = /^(transform|translate|scale|rotate|perspective)/;
    /* What the blanket rule's `0.01ms` comes back as. getComputedStyle
       normalises it to seconds in exponent form, so the literal string
       "0.01ms" never appears and a set without "1e-05s" would silently match
       nothing — which is exactly how a test like this rots into a no-op. */
    const FLAT = new Set(["1e-05s", "0.00001s", "0s", "0ms"]);
    const offenders: string[] = [];

    for (const el of Array.from(document.querySelectorAll("*"))) {
      const style = getComputedStyle(el);
      if (style.animationName === "none") continue;
      const names = style.animationName.split(",").map((n) => n.trim());
      const durations = style.animationDuration.split(",").map((d) => d.trim());

      names.forEach((name, i) => {
        const props = animates[name];
        if (!props?.some((prop) => MOVEMENT.test(prop))) return;
        const duration = durations[i] ?? durations[0];
        if (FLAT.has(duration)) return;
        offenders.push(
          `<${el.tagName.toLowerCase()} class="${el.getAttribute("class") ?? ""}"> runs ${name} for ${duration}`,
        );
      });
    }
    return offenders;
  });
}

/* The properties our own two carve-out animations touch. This is the
   invariant the reduced-motion exception rests on: it re-enables `breath`
   and `reveal` by name, and that is only defensible while neither moves. */
async function carveOutProperties(page: Page): Promise<Record<string, string[]>> {
  return page.evaluate(() => {
    const out: Record<string, string[]> = {};
    for (const sheet of Array.from(document.styleSheets)) {
      let rules: CSSRuleList;
      try {
        rules = sheet.cssRules;
      } catch {
        continue;
      }
      for (const rule of Array.from(rules)) {
        if (rule.constructor.name !== "CSSKeyframesRule") continue;
        const frames = rule as CSSKeyframesRule;
        if (frames.name !== "breath" && frames.name !== "reveal") continue;
        const props = new Set<string>();
        for (const frame of Array.from(frames.cssRules)) {
          const style = (frame as CSSKeyframeRule).style;
          for (let i = 0; i < style.length; i++) props.add(style[i]);
        }
        out[frames.name] = Array.from(props);
      }
    }
    return out;
  });
}

test.describe("design-foundations US1: the wait is visible, and reduced motion does not silence it", () => {
  test("the breath keeps its real duration under reduced motion", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await openWaitingPayer(page);

    const breathing = page.locator('[data-motion="breath"]');
    await expect(breathing).toBeVisible();

    const computed = await breathing.evaluate((el) => {
      const s = getComputedStyle(el);
      return {
        name: s.animationName,
        duration: s.animationDuration,
        iterations: s.animationIterationCount,
      };
    });

    /* The whole point. The blanket reduced-motion rule sets 0.01ms with
       !important; if the carve-out in index.css loses either !important or
       moves above that rule, this is what turns red — and nothing else
       would. */
    expect(computed.name).toBe("breath");
    /* Verified by mutation: drop either !important from the carve-out in
       index.css and this reads "1e-05s" — the breath frozen, the screen
       still rendering exactly as it does when it works. */
    expect(computed.duration).toBe("2.4s");
    expect(computed.iterations).toBe("infinite");
  });

  test("the carve-out animations move nothing, which is what makes the carve-out sound", async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await openWaitingPayer(page);

    const props = await carveOutProperties(page);
    /* Both must exist: an empty result would pass the assertion below while
       proving nothing. */
    expect(Object.keys(props).sort()).toEqual(["breath", "reveal"]);
    expect(props.breath).toEqual(["opacity"]);
    expect(props.reveal).toEqual(["opacity"]);
  });

  test("nothing on the payer's page is actually moving", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await openWaitingPayer(page);

    expect(await runningMovements(page)).toEqual([]);
  });

  test("nothing in the back office is moving either", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await stubAdminApi(page);
    await page.goto(ADMIN);
    await expect(page.getByText("Janely Guadalupe Reyes").first()).toBeVisible();

    expect(await runningMovements(page)).toEqual([]);
  });

  /* SC-008: the tokens GOVERN, they are not decoration. Before this feature
     the motion scale controlled nothing — editing --duration-slow changed no
     pixel anywhere, because no utility resolved from it and every component
     wrote its own literal instead. This is the assertion that would have been
     red for the whole life of the project until now. */
  test("editing a duration token changes what the screen does", async ({ page }) => {
    await openWaitingPayer(page);
    const reveal = page.locator('[data-motion="reveal"]').first();

    await page.route("**/direct-payments/*/status", (route) =>
      route.fulfill(
        envelope({
          status: "confirmed",
          validationAttempts: 2,
          nextValidationAt: null,
          error: null,
          actionOutcome: "done",
          folio: "F-1",
        }),
      ),
    );
    await expect(page.getByText(/tu pago fue registrado/i)).toBeVisible({ timeout: 15_000 });

    const before = await reveal.evaluate((el) => getComputedStyle(el).animationDuration);
    expect(before).toBe("0.4s");

    await page.evaluate(() =>
      document.documentElement.style.setProperty("--duration-slow", "2000ms"),
    );
    const after = await reveal.evaluate((el) => getComputedStyle(el).animationDuration);
    expect(after, "the reveal reads its duration from the token, not from a literal").toBe("2s");
  });

  test("the outcome still arrives when the payer asked for less motion", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await openWaitingPayer(page);

    /* The verdict lands on the next poll. */
    await page.route("**/direct-payments/*/status", (route) =>
      route.fulfill(
        envelope({
          status: "confirmed",
          validationAttempts: 2,
          nextValidationAt: null,
          error: null,
          actionOutcome: "done",
          folio: "F-1",
        }),
      ),
    );

    const outcome = page.getByText(/tu pago fue registrado/i);
    await expect(outcome).toBeVisible({ timeout: 15_000 });
    /* Reduced motion may flatten the fade to nothing, but it may never
       remove the answer. */
    await expect(page.locator('[data-motion="reveal"]')).toBeVisible();
  });
});
