import { describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { BANKS, settingsResponse } from "@devolada/api/settings-schema";
import { businessActor, handlers, ok, server } from "./msw";
import { renderApp } from "./render";
import { expectNoViolations } from "./a11y";

/* searchable-picker US1, US2.

   97 names are searched, not scanned, and the field is the search box. What
   this layer can answer is which names are offered for what was typed, and
   what the field commits. Real contrast, target size and the height the popup
   gets are layout, so they belong to the browser layer (constitution IV) —
   happy-dom would be guessing.

   US3 — the same field on all three screens — is proved where the other two
   screens are tested, in credit.test.tsx and operator-bank.test.tsx.

   The dropdown that could not be scrolled, which is where this control came
   from, is a separate story with its own guard:
   `bug: bank-picker-unreachable`, proved in tests/e2e/dropdown.spec.ts. */

const settings = (over: Record<string, unknown> = {}) =>
  settingsResponse.parse({
    serviceFeeCents: 1500,
    timezone: "America/Mexico_City",
    timeFormat: "12h",
    wisphub: { configured: true, keyTail: "1234" },
    spei: {
      clabe: "646180157000000004",
      bank: null,
      beneficiaryName: null,
      serviceFeeCents: null,
      effectiveServiceFeeCents: 1500,
      bankUnknown: false,
      configured: false,
    },
    reconnection: { thresholdPercent: 100, floorCents: 0, provisionalReleaseEnabled: false },
    reconciliationPolicy: { toleranceCents: 0, overTreatment: "flag", effectiveOverTreatment: "flag" },
    ...over,
  });

const withBank = (bank: string | null) =>
  settings({
    spei: {
      clabe: "646180157000000004",
      bank,
      beneficiaryName: null,
      serviceFeeCents: null,
      effectiveServiceFeeCents: 1500,
      bankUnknown: false,
      configured: bank !== null,
    },
  });

async function openPicker(bank: string | null = null) {
  server.use(
    handlers.session(() => ok(businessActor)),
    handlers.settings(() => ok(withBank(bank))),
  );
  renderApp("/settings/direct-payment");
  const field = await screen.findByRole("combobox", { name: "Banco" });
  await userEvent.click(field);
  return field;
}

const offered = () => screen.getAllByRole("option").map((o) => o.textContent);

describe("searchable-picker US1: the ISP finds their bank by typing", () => {
  it("offers the whole vocabulary when nothing has been typed", async () => {
    await openPicker();
    expect(offered()).toHaveLength(BANKS.length);
    expect(new Set(offered())).toEqual(new Set(BANKS));
  });

  it("narrows to the match as the name is typed — SCOTIABANK is three keys away", async () => {
    const field = await openPicker();
    await userEvent.type(field, "scotia");
    expect(offered()).toEqual(["SCOTIABANK"]);
  });

  it("matches without case or accents, so 'méxico' finds the names spelled without one", async () => {
    const field = await openPicker();
    await userEvent.type(field, "méxico");
    expect(offered()).toEqual(["BBVA MEXICO", "CITI MEXICO"]);
  });

  it("puts the names that start with what was typed first", async () => {
    const field = await openPicker();
    await userEvent.type(field, "ban");
    const names = offered();
    /* "ban" should open on BANAMEX, not on the first name that happens to
       contain it — NUBANK is a match, but it is not what was being typed. */
    expect(names[0]).toBe("BANAMEX");
    const firstContains = names.findIndex((n) => !n?.startsWith("BAN"));
    expect(names.slice(0, firstContains).every((n) => n?.startsWith("BAN"))).toBe(true);
    expect(names).toContain("NUBANK");
  });

  it("says so when nothing matches, and commits nothing", async () => {
    const field = await openPicker();
    await userEvent.type(field, "zzz");
    expect(screen.getByText("Sin resultados")).toBeInTheDocument();
    expect(screen.queryAllByRole("option")).toHaveLength(0);
    expect(screen.getByRole("button", { name: /guardar pago directo/i })).toBeDisabled();
  });
});

describe("searchable-picker US2: the field never holds a name nobody chose", () => {
  it("saves the name that was chosen with the keyboard", async () => {
    const patches: unknown[] = [];
    server.use(
      handlers.session(() => ok(businessActor)),
      handlers.settings(() => ok(withBank(null))),
      handlers.patchSettings((body) => {
        patches.push(body);
        return ok(withBank("SCOTIABANK"));
      }),
    );
    renderApp("/settings/direct-payment");
    const field = await screen.findByRole("combobox", { name: "Banco" });
    await userEvent.type(field, "scotia");
    await userEvent.keyboard("{ArrowDown}{Enter}");
    expect(field).toHaveValue("SCOTIABANK");

    await userEvent.click(screen.getByRole("button", { name: /guardar pago directo/i }));
    expect(patches).toMatchObject([{ speiBank: "SCOTIABANK" }]);
  });

  it("Escape puts the committed name back — a half-typed fragment never looks chosen", async () => {
    const field = await openPicker("STP");
    expect(field).toHaveValue("STP");
    await userEvent.clear(field);
    await userEvent.type(field, "banor");
    expect(field).toHaveValue("banor");
    await userEvent.keyboard("{Escape}");
    expect(field).toHaveValue("STP");
  });

  it("leaving the field puts the committed name back too", async () => {
    const field = await openPicker("STP");
    await userEvent.clear(field);
    await userEvent.type(field, "banor");
    await userEvent.tab();
    expect(field).toHaveValue("STP");
    expect(screen.queryAllByRole("option")).toHaveLength(0);
  });
});

describe("searchable-picker US1: the open picker is announced", () => {
  it("passes axe with the list open, and names the highlighted option", async () => {
    const field = await openPicker();
    await userEvent.type(field, "scotia");
    expect(field).toHaveAttribute("aria-expanded", "true");
    const option = screen.getByRole("option", { name: "SCOTIABANK" });
    expect(field).toHaveAttribute("aria-activedescendant", option.id);
    /* Scoped to the popup, not the whole body: Radix portals it to the
       document root, where axe's `region` rule reports every overlay in this
       app for sitting outside the page's landmarks. The field's own ARIA is
       asserted above; what is left to check is the list it opens. */
    const popup = document.querySelector<HTMLElement>("[data-radix-popper-content-wrapper]");
    expect(popup).not.toBeNull();
    await expectNoViolations(popup!);
  });
});
