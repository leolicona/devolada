import { describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { linksRosterResponse } from "@devolada/api/direct-payments-schema";
import { handlers, businessActor, fail, ok, server } from "./msw";
import { renderApp } from "./render";

/* US-D07, amended by the pilot-UX round: the page is the roster, alive
   on arrival, searched locally by contains. */

const roster = (over: Record<string, unknown> = {}) =>
  linksRosterResponse.parse({
    results: [
      {
        wisphubId: 101,
        usuario: "greyes",
        name: "Janely Reyes",
        phone: "5551234567",
        url: "https://link.dev.devoladapago.com/p/tok-greyes",
        waLink: "https://wa.me/525551234567?text=hola",
      },
      {
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

  it("without WispHub the page points at Integraciones", async () => {
    arrange(() => fail("WISPHUB_NOT_CONFIGURED", 503));
    expect(await screen.findByText(/sin conexión a wisphub/i)).toBeInTheDocument();
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
