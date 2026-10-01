import { expect, test, type Page } from "@playwright/test";
import { ADMIN, PAGO, RED } from "../../playwright.config";
import { declareHandoverResponse } from "../../apps/api/src/routes/store/schema";
import { feed, holdApiRoute, proofReading, storeCashbox, stubAdminApi, stubPagoApi, stubRedApi } from "./stubs";

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

    const MOVEMENT = /^(transform|translate|scale|rotate|perspective)$/;
    const MOVEMENT_PREFIX = /^(transform|translate|scale|rotate|perspective)/;
    /* What the blanket rule's `0.01ms` comes back as. getComputedStyle
       normalises it to seconds in exponent form, so the literal string
       "0.01ms" never appears and a set without "1e-05s" would silently match
       nothing — which is exactly how a test like this rots into a no-op. */
    const FLAT = new Set(["1e-05s", "0.00001s", "0s", "0ms"]);
    const offenders: string[] = [];

    for (const el of Array.from(document.querySelectorAll("*"))) {
      const style = getComputedStyle(el);
      const describe = () =>
        `<${el.tagName.toLowerCase()} class="${el.getAttribute("class") ?? ""}">`;

      /* Animations. */
      if (style.animationName !== "none") {
        const names = style.animationName.split(",").map((n) => n.trim());
        const durations = style.animationDuration.split(",").map((d) => d.trim());
        names.forEach((name, i) => {
          const props = animates[name];
          if (!props?.some((prop) => MOVEMENT_PREFIX.test(prop))) return;
          const duration = durations[i] ?? durations[0];
          if (FLAT.has(duration)) return;
          offenders.push(`${describe()} runs ${name} for ${duration}`);
        });
      }

      /* Transitions (converge F5). The first version of this check read
         animations only, so a transform carried by a TRANSITION was invisible
         to it — and the payer's page has two, on the collapsible chevrons.
         The blanket rule flattens transition-duration as well, so nothing is
         expected here; what was missing was anything that would notice if a
         rule ever escaped it. */
      if (style.transitionProperty !== "none" && style.transitionProperty !== "") {
        const props = style.transitionProperty.split(",").map((p) => p.trim());
        const durations = style.transitionDuration.split(",").map((d) => d.trim());
        props.forEach((prop, i) => {
          if (prop !== "all" && !MOVEMENT.test(prop)) return;
          const duration = durations[i] ?? durations[0];
          if (!duration || FLAT.has(duration)) return;
          offenders.push(`${describe()} transitions ${prop} over ${duration}`);
        });
      }
    }
    return offenders;
  });
}

/* Prove the instrument before trusting its silence
   (feedback-vocabulary-rollout US1/US2/US3).

   An absence check returns nothing for two very different reasons: the page is
   clean, or the check is broken. From the result alone they are identical, and
   `001-design-foundations` shipped four checks that were green for the second
   reason — an end-state assertion that held with the threshold at zero, a
   constant set that matched no real value, a branch testing a case the page
   never renders, and two capture techniques that photographed the wrong frame.

   So: plant something that WOULD violate the claim, confirm the check sees it,
   then take it away. `decls` are applied with `!important` so no stylesheet can
   quietly win against the probe and make the proof itself a no-op. */
async function withProbe(
  page: Page,
  decls: Record<string, string>,
  run: () => Promise<void>,
): Promise<void> {
  await page.evaluate((applied) => {
    const probe = document.createElement("div");
    probe.id = "instrument-probe";
    probe.textContent = "probe";
    for (const [prop, value] of Object.entries(applied)) {
      probe.style.setProperty(prop, value, "important");
    }
    document.body.appendChild(probe);
  }, decls);
  try {
    await run();
  } finally {
    await page.evaluate(() => document.getElementById("instrument-probe")?.remove());
  }
}

/* What a named set of keyframes actually animates. The same question
   carveOutProperties asks of `breath` and `reveal`, asked of any name — it is
   how "opacity only" is checked at the source rather than inferred from a
   screenshot. */
async function keyframeProperties(page: Page, names: string[]): Promise<Record<string, string[]>> {
  return page.evaluate((wanted) => {
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
        if (!wanted.includes(frames.name)) continue;
        const props = new Set<string>();
        for (const frame of Array.from(frames.cssRules)) {
          const style = (frame as CSSKeyframeRule).style;
          for (let i = 0; i < style.length; i++) props.add(style[i]);
        }
        out[frames.name] = Array.from(props);
      }
    }
    return out;
  }, names);
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

  /* feedback-vocabulary-rollout US1 */
  test("a back-office wait keeps breathing under reduced motion too (FR-014, SC-012)", async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await stubAdminApi(page);
    const release = await holdApiRoute(page, "**/payments/feed*", feed);

    await page.goto(ADMIN);
    const breathing = page.locator('[data-motion="breath"]').first();
    await expect(breathing).toBeVisible();

    const computed = await breathing.evaluate((el) => {
      const s = getComputedStyle(el);
      return { name: s.animationName, duration: s.animationDuration };
    });

    /* This is the defect the feature closes, not a description of what already
       worked. Until now the back office's pending shapes carried Tailwind's
       `animate-pulse`, which matched neither `[data-motion="breath"]` nor
       `[data-motion="reveal"]`, so the blanket rule flattened it and every
       loading screen froze into a dead grey block for anyone who asked for
       less motion.

       Verified by mutation: put `animate-pulse` back on Skeleton and take the
       breath off the region, and this reads "1e-05s". */
    expect(computed.name).toBe("breath");
    expect(computed.duration).toBe("2.4s");
    release();
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

    /* Prove the instrument before trusting its silence.

       This check reports nothing on a page with no movement AND on a page
       where the check itself is broken, and those look identical from here.
       So: plant something that genuinely escapes the blanket rule — an
       !important duration is exactly the shape of a rule that would slip past
       it — confirm it is caught, then remove it. Without this, the transition
       branch below was dead code for one commit and nothing said so. */
    await page.evaluate(() => {
      const probe = document.createElement("div");
      probe.id = "movement-probe";
      probe.style.setProperty("transition-property", "transform", "important");
      probe.style.setProperty("transition-duration", "300ms", "important");
      document.body.appendChild(probe);
    });
    expect(
      await runningMovements(page),
      "the movement check no longer detects a moving element",
    ).toHaveLength(1);
    await page.evaluate(() => document.getElementById("movement-probe")?.remove());

    expect(await runningMovements(page)).toEqual([]);
  });

  test("nothing in the back office is moving either", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await stubAdminApi(page);
    await page.goto(ADMIN);
    await expect(page.getByText("Janely Guadalupe Reyes").first()).toBeVisible();

    expect(await runningMovements(page)).toEqual([]);
  });

  /* design-foundations US1 (converge F1, F2). The upload and the submit are
     waits too, and until now the only sign either was happening was a greyed
     button whose word changed — announced to nobody, since both forms render
     outside the status Card's live region.

     The route is held open on purpose: a stubbed upload returns instantly, and
     an instant upload correctly shows nothing (FR-014). What needs proving is
     the slow connection, which is the case that matters. */
  test("the upload wait is both visible and spoken", async ({ page }) => {
    await stubPagoApi(page);
    await page.route("**/direct-payments/links/*/proof", async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 2_000));
      await route.fulfill(envelope({ proofId: "link-1/proof-1" }));
    });

    await page.goto(`${PAGO}/p/tok123`);
    await page.getByRole("button", { name: /ya hice mi transferencia/i }).click();
    await page.locator('input[type="file"]').setInputFiles({
      name: "cep.png",
      mimeType: "image/png",
      buffer: Buffer.alloc(120),
    });
    await page.getByRole("button", { name: /enviar comprobante/i }).click();

    /* Seen without reading (FR-008) … */
    await expect(page.locator('[data-motion="breath"]')).toBeVisible();
    /* … and available as words to someone who cannot see it (FR-011, SC-009).
       This form owns its own region: nothing else on the screen announces. */
    await expect(page.getByRole("status")).toHaveText(/subiendo tu comprobante/i);
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

/* feedback-vocabulary-rollout US2 — arriving and departing.

   Three things a simulated DOM cannot answer, and one trap.

   The trap is `transform`. The dialog centres itself with -translate-x-1/2, so
   its computed transform is never "none" and asserting that would fail on a
   surface that is behaving perfectly. What FR-006 forbids is a transform that
   MOVES during the arrival, which is what runningMovements() above already
   measures: it reads the keyframes each running animation touches.

   The load-bearing assertion is the departure. Radix keeps a closing node
   mounted until `animationend`; a keyframe that never ends leaves a dialog in
   the DOM forever — invisible in a still screenshot and fatal in use. */

const members = {
  members: [
    { id: "m-owner", userId: "user-1", name: "Leo", email: "demo@devolada.app", role: "owner", createdAt: 1 },
    { id: "m-op", userId: "user-2", name: "Ana", email: "ana@wifiplus.mx", role: "operator", createdAt: 2 },
  ],
  invitations: [],
  grantable: ["admin", "operator", "viewer"],
};

const proof = {
  folio: "DV-FEED01",
  proofMode: "transfer",
  cep: null,
  imageUrl: null,
};

async function stubSurfaces(page: Page) {
  await stubAdminApi(page);
  await page.route("**/businesses/members", (route) =>
    route.request().resourceType() === "document" ? route.fallback() : route.fulfill(envelope(members)),
  );
  await page.route("**/payments/*/proof", (route) =>
    route.request().resourceType() === "document" ? route.fallback() : route.fulfill(envelope(proof)),
  );
}

type Surface = {
  name: string;
  width: number;
  url: string;
  ready: string;
  role: "dialog" | "alertdialog" | "listbox";
  open: (page: Page) => Promise<void>;
  close: (page: Page) => Promise<void>;
};

const SURFACES: Surface[] = [
  {
    name: "dialog",
    width: 1280,
    url: ADMIN,
    ready: "Janely Guadalupe Reyes",
    role: "dialog",
    open: async (page) => {
      await page.getByRole("button", { name: /Janely Guadalupe Reyes/ }).first().click();
      await page.getByRole("button", { name: "Ver comprobante" }).first().click();
    },
    close: async (page) => page.getByRole("button", { name: "Cerrar" }).first().click(),
  },
  {
    name: "sheet",
    width: 375,
    url: ADMIN,
    ready: "Janely Guadalupe Reyes",
    role: "dialog",
    open: async (page) => page.getByRole("button", { name: "Fechas" }).click(),
    close: async (page) => page.getByRole("button", { name: "Cerrar" }).first().click(),
  },
  {
    name: "alert dialog",
    width: 1280,
    url: `${ADMIN}/settings/users`,
    ready: "Ana",
    role: "alertdialog",
    open: async (page) => page.getByRole("button", { name: "Quitar" }).first().click(),
    close: async (page) => page.getByRole("button", { name: "Cancelar" }).first().click(),
  },
  {
    /* At 1280 "Fechas" is a Popover; the same control becomes a Sheet on a
       phone, which is why the sheet above opens the same way at 375. */
    name: "popover",
    width: 1280,
    url: ADMIN,
    ready: "Janely Guadalupe Reyes",
    role: "dialog",
    open: async (page) => page.getByRole("button", { name: "Fechas" }).click(),
    close: async (page) => page.keyboard.press("Escape"),
  },
  {
    name: "select",
    width: 1280,
    url: `${ADMIN}/settings/users`,
    ready: "Ana",
    role: "listbox",
    open: async (page) => page.getByRole("combobox", { name: /Rol de Ana/ }).click(),
    close: async (page) => page.keyboard.press("Escape"),
  },
];

/* Every element the surface's arrival is supposed to move: the panel and the
   backdrop that dims behind it. They carry the same pair so the two never
   separate mid-flight. */
async function arrivalAnimations(page: Page, role: string): Promise<string[]> {
  return page.evaluate((r) => {
    const panel = document.querySelector(`[role="${r}"]`);
    const names: string[] = [];
    for (const el of Array.from(document.querySelectorAll("body *"))) {
      const s = getComputedStyle(el);
      if (s.animationName === "none") continue;
      const isPanel = el === panel;
      const isBackdrop = s.position === "fixed" && s.inset === "0px";
      if (isPanel || isBackdrop) names.push(s.animationName);
    }
    return names;
  }, role);
}

test.describe("feedback-vocabulary-rollout US2: surfaces arrive and leave the same way", () => {
  for (const surface of SURFACES) {
    test(`the ${surface.name} fades in, and moves nothing while it does`, async ({ page }) => {
      await page.setViewportSize({ width: surface.width, height: surface.width < 500 ? 812 : 800 });
      await stubSurfaces(page);
      await page.goto(surface.url);
      await expect(page.getByText(surface.ready).first()).toBeVisible({ timeout: 15_000 });

      await surface.open(page);
      await expect(page.getByRole(surface.role)).toBeVisible();

      const names = await arrivalAnimations(page, surface.role);
      /* Not "no animation is a movement" — that would pass on a surface with no
         animation at all, which is what FR-007 exists to catch. */
      expect(names.length).toBeGreaterThan(0);
      expect(new Set(names)).toEqual(new Set(["enter"]));

      /* Scoped to the keyframes this surface actually runs, NOT to the page.
         A page-wide movement check fails here for an honest reason that has
         nothing to do with FR-006: the charge row is a Collapsible and its
         chevron rotates 180° on expand, which is a pre-existing transition and
         is correctly flattened under reduced motion. What FR-006 forbids is a
         transform inside the arrival itself. */
      const props = await keyframeProperties(page, ["enter", "leave"]);
      expect(Object.keys(props).sort()).toEqual(["enter", "leave"]);
      expect(props.enter).toEqual(["opacity"]);
      expect(props.leave).toEqual(["opacity"]);
    });

    test(`the ${surface.name} fades out, and is really gone afterwards`, async ({ page }) => {
      await page.setViewportSize({ width: surface.width, height: surface.width < 500 ? 812 : 800 });
      await stubSurfaces(page);
      await page.goto(surface.url);
      await expect(page.getByText(surface.ready).first()).toBeVisible({ timeout: 15_000 });

      await surface.open(page);
      const panel = page.getByRole(surface.role);
      await expect(panel).toBeVisible();

      await surface.close(page);
      /* It does not vanish in the same tick: Radix holds the node while the
         leave keyframe runs (US2 scenario 2). */
      expect(await panel.count()).toBe(1);
      /* And it does leave. A departure that never ends is the failure mode a
         screenshot cannot see. */
      await expect(panel).toHaveCount(0, { timeout: 3_000 });
    });

    test(`the ${surface.name} still unmounts when the operator asked for less motion`, async ({
      page,
    }) => {
      /* enter and leave are deliberately NOT carved out of the reduced-motion
         rule (D9), so both are flattened to 0.01ms here. Flattened is not
         removed: `animationend` still fires, so Radix still unmounts. If that
         ever stopped being true, a dialog would stay in the DOM for exactly the
         people least able to work around it. */
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.setViewportSize({ width: surface.width, height: surface.width < 500 ? 812 : 800 });
      await stubSurfaces(page);
      await page.goto(surface.url);
      await expect(page.getByText(surface.ready).first()).toBeVisible({ timeout: 15_000 });

      await surface.open(page);
      const panel = page.getByRole(surface.role);
      await expect(panel).toBeVisible();
      /* Flattened, as intended — this is the assertion that would catch someone
         "helpfully" adding enter/leave to the carve-out. */
      const duration = await panel.evaluate((el) => getComputedStyle(el).animationDuration);
      expect(duration).toBe("1e-05s");

      await surface.close(page);
      await expect(panel).toHaveCount(0, { timeout: 3_000 });
      /* And nothing moved on the way out, for anyone. */
      expect(await runningMovements(page)).toEqual([]);
    });
  }
});

/* feedback-vocabulary-rollout US3 — one waiting movement, no exceptions. */

/* Every animation name actually in use on the page right now. Names, not
   classes: a class assertion cannot tell whether the rule reached the element,
   and that is the whole failure mode this file exists for. */
async function animationNames(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const names = new Set<string>();
    for (const el of Array.from(document.querySelectorAll("*"))) {
      const n = getComputedStyle(el).animationName;
      if (n && n !== "none") for (const part of n.split(",")) names.add(part.trim());
    }
    return Array.from(names);
  });
}

test.describe("feedback-vocabulary-rollout US3: nothing spins, and nothing pulses", () => {
  test("the check itself notices a rotation, before it is trusted to find none", async ({
    page,
  }) => {
    /* The instrument comes first. An absence check returns nothing when the
       page is clean AND when the check is broken, and 001 shipped four that
       were green for the second reason. */
    await stubAdminApi(page);
    await page.goto(ADMIN);
    await expect(page.getByText("Janely Guadalupe Reyes")).toBeVisible({ timeout: 15_000 });

    await withProbe(page, { animation: "spin 1s linear infinite" }, async () => {
      expect(await animationNames(page)).toContain("spin");
    });
    /* And it is gone once the probe is, so the probe cannot leak into the real
       assertions below. */
    expect(await animationNames(page)).not.toContain("spin");
  });

  test("no element in the back office is running spin or pulse, mid-retry included", async ({
    page,
  }) => {
    /* Driving an actual retry is the whole point. The first version of this
       test loaded the page and asserted on a screen where no retry was
       running — so restoring `animate-spin` on ListError's icon left it GREEN,
       because that class only appears while retrying. An absence check that
       never visits the state it guards is worse than no check: it reports
       safety it has not looked for. */
    await stubAdminApi(page);

    /* Fail every attempt until the test says otherwise, not just the first:
       TanStack retries a failed query three times on its own before the error
       ever reaches the screen. */
    let failing = true;
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    await page.route("**/payments/feed*", async (route) => {
      if (route.request().resourceType() === "document") return route.fallback();
      if (failing) {
        return route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({ success: false, error: { code: "UNAVAILABLE" } }),
        });
      }
      await held;
      return route.fulfill(envelope(feed));
    });

    await page.goto(ADMIN);
    const retry = page.getByRole("button", { name: /reintentar/i }).first();
    await expect(retry).toBeVisible({ timeout: 30_000 });

    failing = false;
    await retry.click();

    /* What actually happens here is US3's first acceptance scenario, observed:
       the retry puts the query back into its first-load state, the failure
       notice unmounts, and the screen shows the SAME pending treatment a first
       attempt shows. There is no retry-specific state to look different,
       because `retrying` has no treatment of its own (D8) — that is the
       guarantee, not an accident of this screen.

       The ListError-specific regression (its icon spinning again) is caught by
       packages/ui/test/list-error.test.tsx, which keeps the component mounted
       through the wait; that test's mutation is recorded there. */
    await expect(page.locator('[data-motion="breath"]').first()).toBeVisible();
    await expect(page.getByRole("button", { name: /reintentar/i })).toHaveCount(0);

    const names = await animationNames(page);
    /* Both were in this product until this feature: `animate-pulse` on every
       Skeleton, `animate-spin` on this very icon. Neither came from tokens.css
       and neither survived reduced motion — the pulse froze, the spin vanished.

       Verified by mutation: restore `animate-spin` on ListError's icon and this
       turns red. */
    expect(names).not.toContain("spin");
    expect(names).not.toContain("pulse");
    /* The retry breathes instead, which is US3 in one assertion: it waits the
       way a first attempt waits. */
    expect(names).toContain("breath");
    release();
  });

  test("nor on the payer's page", async ({ page }) => {
    await openWaitingPayer(page);
    /* Wait for the breath to actually start. Reading straight after the page
       settles samples the region during the flash threshold, when nothing is
       animating yet — the assertion below would then pass on an empty set for
       the wrong reason, which is what the `toContain("breath")` guard is here
       to prevent. It caught exactly that on the first run. */
    await expect(page.locator('[data-motion="breath"]')).toBeVisible();

    const names = await animationNames(page);
    expect(names).not.toContain("spin");
    expect(names).not.toContain("pulse");
    /* And the one movement that IS allowed is present, so this is not a page
       with no animation at all passing by default. */
    expect(names).toContain("breath");
  });
});

/* cash-at-stores T033, T060 (constitution VI; /speckit-analyze M3): the
   store app's waits. A payment whose action is still queued waits on the
   business's system for minutes, with the customer at the counter; the
   cash book loads, and a declared hand-over sends. Each wait must breathe
   at its real duration under reduced motion — a frozen counter reads as a
   broken one — and nothing on the page may translate, scale or rotate. */
test.describe("cash-at-stores: the store app's waits breathe, and nothing moves", () => {
  async function expectBreathing(page: Page): Promise<void> {
    const breathing = page.locator('[data-motion="breath"]').first();
    await expect(breathing).toBeVisible();
    const computed = await breathing.evaluate((el) => {
      const s = getComputedStyle(el);
      return { name: s.animationName, duration: s.animationDuration };
    });
    expect(computed.name).toBe("breath");
    expect(computed.duration).toBe("2.4s");
    expect(await runningMovements(page)).toEqual([]);
  }

  test("a payment waiting on the business breathes on the result screen", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await stubRedApi(page, { collection: "queued" });
    await page.goto(`${RED}/cobros/pay-1`);
    await expect(page.getByText("Estamos avisando al negocio")).toBeVisible();
    await expectBreathing(page);
  });

  test("Mi caja breathes while it loads", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await stubRedApi(page);
    const release = await holdApiRoute(page, "**/store/cashbox", storeCashbox);
    await page.goto(`${RED}/caja`);
    await expectBreathing(page);
    release();
    await expect(page.getByText("WiFi Plus dice:")).toBeVisible();
  });

  test("a declared hand-over breathes while it sends", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await stubRedApi(page);
    await page.goto(`${RED}/caja/entrega?businessId=business-1`);
    await expect(page.getByText("La entrega quedará pendiente")).toBeVisible();
    const release = await holdApiRoute(page, "**/store/handovers", declareHandoverResponse.parse({ id: "h9", status: "pending" }));
    await page.getByRole("button", { name: /Registrar entrega de/ }).click();
    await expectBreathing(page);
    release();
  });

  test("with motion allowed, the counter still moves nothing", async ({ page }) => {
    await stubRedApi(page);
    await page.goto(`${RED}/`);
    await page.getByLabel("Buscar cliente").fill("guadalupe");
    await expect(page.getByText("Guadalupe Reyes Hernández")).toBeVisible();
    /* the payer's-page rule (constitution VI): nothing spins or bounces —
       the counter is the same kind of screen */
    const moving = await page.evaluate(() =>
      Array.from(document.querySelectorAll("*"))
        .map((el) => getComputedStyle(el).animationName)
        .filter((name) => name !== "none" && name !== "breath" && name !== "reveal" && !name.startsWith("enter") && !name.startsWith("leave")),
    );
    expect(moving).toEqual([]);
  });
});
