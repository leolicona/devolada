import { describe, expect, it } from "vitest";
import { cleanup, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { linksRosterResponse } from "@devolada/api/direct-payments-schema";
import { handlers, businessActor, fail, ok, server } from "./msw";
import { renderApp } from "./render";
import { expectNoViolations } from "./a11y";

/* US-D07, amended by the pilot-UX round: the page is the roster, alive
   on arrival, searched locally by contains. */

const roster = (over: Record<string, unknown> = {}) =>
  linksRosterResponse.parse({
    results: [
      {
        channel: "panel",
        wisphubId: 101,
        usuario: "greyes",
        name: "Janely Reyes",
        phone: "5551234567",
        url: "https://link.dev.devoladapago.com/p/tok-greyes",
        waLink: "https://wa.me/525551234567?text=hola",
      },
      {
        channel: "panel",
        wisphubId: 102,
        usuario: "aflores",
        name: "Abraham Flores",
        phone: null,
        url: "https://link.dev.devoladapago.com/p/tok-aflores",
        waLink: "https://wa.me/?text=hola",
      },
    ],
    complete: true,
    readAt: Date.now(),
    ...over,
  });

function stubClipboard(writeText: (text: string) => Promise<void>) {
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText },
    configurable: true,
  });
}

const arrange = (r: () => ReturnType<typeof ok | typeof fail> = () => ok(roster())) => {
  server.use(handlers.session(() => ok(businessActor)), handlers.linksRoster(r));
  renderApp("/links");
};

describe("US-D07: the roster is alive on arrival", () => {
  it("lists every customer with their link before anything is typed", async () => {
    arrange();
    expect(await screen.findByText("Janely Reyes")).toBeInTheDocument();
    expect(screen.getByText("Abraham Flores")).toBeInTheDocument();
    expect(screen.getByText(/consultado hace/i)).toBeInTheDocument();
  });

  it("search is contains, over the three fields at once — half a name is enough", async () => {
    arrange();
    await screen.findByText("Janely Reyes");
    const box = screen.getByLabelText(/buscar cliente/i);

    await userEvent.type(box, "reye");
    expect(screen.getByText("Janely Reyes")).toBeInTheDocument();
    expect(screen.queryByText("Abraham Flores")).not.toBeInTheDocument();

    await userEvent.clear(box);
    await userEvent.type(box, "aflo");
    expect(screen.getByText("Abraham Flores")).toBeInTheDocument();

    await userEvent.clear(box);
    await userEvent.type(box, "zzz");
    expect(await screen.findByText(/ningún cliente coincide/i)).toBeInTheDocument();
  });

  it("the search box keeps its accessible name and refuses autofill", async () => {
    arrange();
    const box = await screen.findByLabelText(/buscar cliente/i);
    expect(box).toHaveAttribute("autocomplete", "off");
    expect(box).toHaveAttribute("name", "roster-search");
  });

  it("a provider that stalled with nothing to show is the error block, with a retry", async () => {
    arrange(() => fail("WISPHUB_UNAVAILABLE", 503));
    expect(await screen.findByRole("button", { name: /reintentar/i })).toBeInTheDocument();
  });
});

/* automated-collections-api US1 scenario 11 (FR-011): one list per
   business, both channels, each row marked; the API row shows the
   caller's reference, search finds it, and nothing on it names WispHub. */
describe("automated-collections-api US1 scenario 11: both channels in one list", () => {
  const apiRow = {
    channel: "api",
    wisphubId: null,
    usuario: null,
    customerRef: "CLI-4471",
    label: "Ana Ruiz",
    askCents: 49900,
    linkState: "open",
    name: "Ana Ruiz",
    phone: null,
    url: "https://link.dev.devoladapago.com/p/tok-cli4471",
    waLink: "https://wa.me/?text=hola",
  };
  const both = () => {
    const base = roster();
    return linksRosterResponse.parse({ ...base, results: [...base.results, apiRow] });
  };

  it("marks every row with its channel as icon + text, and the API row shows the reference and the ask", async () => {
    arrange(() => ok(both()));
    expect(await screen.findByText("Ana Ruiz")).toBeInTheDocument();
    expect(screen.getAllByText("Panel")).toHaveLength(2);
    expect(screen.getAllByText("API")).toHaveLength(1);
    expect(screen.getByText(/CLI-4471/)).toBeInTheDocument();
    expect(screen.getByText(/\$499\.00/)).toBeInTheDocument();
    /* WispHub copy only on panel rows: the nameless-customer line never
       reaches the API row, and the API row's own line names no provider */
    const apiItem = screen.getByText("Ana Ruiz").closest("li")!;
    expect(apiItem.textContent).not.toMatch(/wisphub/i);
    await expectNoViolations(document.body);
  });

  it("search matches the caller's reference", async () => {
    arrange(() => ok(both()));
    await screen.findByText("Ana Ruiz");
    await userEvent.type(screen.getByLabelText(/buscar cliente/i), "cli-44");
    expect(screen.getByText("Ana Ruiz")).toBeInTheDocument();
    expect(screen.queryByText("Janely Reyes")).not.toBeInTheDocument();
  });

  it("a closed one-time link says so on its row", async () => {
    const base = roster();
    arrange(() => ok(linksRosterResponse.parse({ ...base, results: [{ ...apiRow, linkState: "paid" }] })));
    expect(await screen.findByText(/link pagado/i)).toBeInTheDocument();
  });

  it("a business without WispHub sees its API links alone, and an empty list points at the API rather than at WispHub", async () => {
    const base = roster();
    server.use(
      handlers.session(() => ok({ ...businessActor, integrationConfigured: false })),
      handlers.linksRoster(() => ok(linksRosterResponse.parse({ ...base, results: [apiRow] }))),
    );
    renderApp("/links");
    expect(await screen.findByText("Ana Ruiz")).toBeInTheDocument();
    expect(screen.queryByText(/sin conexión a wisphub/i)).not.toBeInTheDocument();

    cleanup();
    server.use(
      handlers.session(() => ok({ ...businessActor, integrationConfigured: false })),
      handlers.linksRoster(() => ok(linksRosterResponse.parse({ ...base, results: [] }))),
    );
    renderApp("/links");
    expect(await screen.findByText(/tu sistema puede crearlos desde la api de cobros/i)).toBeInTheDocument();
  });
});

describe("US-D07: Copiar says what happened", () => {
  it("confirms with 'Copiado' after writing the link", async () => {
    stubClipboard(() => Promise.resolve());
    arrange();
    const buttons = await screen.findAllByRole("button", { name: /copiar/i });
    await userEvent.click(buttons[0]);
    expect(await screen.findByText("Copiado")).toBeInTheDocument();
  });

  it("says 'No se copió' when the clipboard refuses", async () => {
    stubClipboard(() => Promise.reject(new Error("denied")));
    arrange();
    const buttons = await screen.findAllByRole("button", { name: /copiar/i });
    await userEvent.click(buttons[0]);
    expect(await screen.findByText("No se copió")).toBeInTheDocument();
  });
});
