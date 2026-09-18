import { describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { settingsListResponse } from "@devolada/api/platform-schema";
import { businessActor, handlers, ok, server } from "./msw";
import { renderApp } from "./render";

/* searchable-picker US3 (AC2): the third screen that names a bank.

   The platform's own top-up account is set here, and it is the one that every
   business's recargas are sent to — a name the provider does not recognise
   fails them all at once. It must be the same field as the two business
   screens, with the same behaviour, and until this file existed nothing
   reached it at all. */

const operator = { ...businessActor, platformOperator: true };

/* The shell around any route asks for these; a test starts from empty or it is
   not a test (constitution IV), and MSW answers `error` to anything unhandled. */
const shell = () => [
  handlers.feed(() => ok({ payments: [], nextCursor: null, today: { count: 0, totalCents: 0, startedAtMs: 0 } })),
  handlers.support(() => ok({ whatsapp: "5215512345678", email: "hola@devoladapago.com" })),
];

const rules = (bank: string | null) =>
  settingsListResponse.parse({
    settings: [
      { key: "topup_bank", type: "bank", birth: null, current: bank, history: [] },
    ],
  });

describe("searchable-picker US3: the platform's own bank is the same field", () => {
  it("opens on the saved name, searches by typing, and saves what was chosen", async () => {
    const posted: [string, unknown][] = [];
    server.use(
      ...shell(),
      handlers.session(() => ok(operator)),
      handlers.platformSettings(() => ok(rules("STP"))),
      handlers.setPlatformSetting((key, body) => {
        posted.push([key, body]);
        return ok({ ok: true });
      }),
    );
    renderApp("/operador");

    const bank = await screen.findByRole("combobox", { name: "Banco de la CLABE" });
    expect(bank).toHaveValue("STP");

    /* The same three keystrokes that reach SCOTIABANK in Configuración */
    await userEvent.clear(bank);
    await userEvent.type(bank, "sco");
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual(["SCOTIABANK"]);
    await userEvent.keyboard("{ArrowDown}{Enter}");
    expect(bank).toHaveValue("SCOTIABANK");

    await userEvent.click(screen.getByRole("button", { name: "Guardar Banco de la CLABE" }));
    expect(posted).toEqual([["topup_bank", { value: "SCOTIABANK" }]]);
  });

  it("a half-typed name is never left in the field, here either", async () => {
    server.use(
      ...shell(),
      handlers.session(() => ok(operator)),
      handlers.platformSettings(() => ok(rules("STP"))),
    );
    renderApp("/operador");

    const bank = await screen.findByRole("combobox", { name: "Banco de la CLABE" });
    await userEvent.clear(bank);
    await userEvent.type(bank, "banor");
    await userEvent.keyboard("{Escape}");
    expect(bank).toHaveValue("STP");
    /* Nothing was chosen, so there is nothing to save */
    expect(screen.getByRole("button", { name: "Guardar Banco de la CLABE" })).toBeDisabled();
  });
});
