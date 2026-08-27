import { describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { handlers, ispActor, ok, server } from "./msw";
import { renderApp } from "./render";

/* US-D07, design-review fixes: the copy button answers either way, and
   the search box carries a name a screen reader can say. */

const results = {
  results: [
    {
      wisphubId: 101,
      usuario: "greyes",
      name: "Janely Reyes",
      phone: "5551234567",
      url: "https://pago.dev.devoladapago.com/p/tok-greyes",
      waLink: "https://wa.me/525551234567?text=hola",
    },
  ],
};

function stubClipboard(writeText: (text: string) => Promise<void>) {
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText },
    configurable: true,
  });
}

async function searchReyes() {
  server.use(
    handlers.session(() => ok(ispActor)),
    handlers.linksSearch(() => ok(results)),
  );
  renderApp("/links");
  await userEvent.type(await screen.findByLabelText(/buscar cliente/i), "reyes");
  return screen.findByRole("button", { name: /copiar/i });
}

describe("US-D07: the search box has an accessible name", () => {
  it("is reachable as 'Buscar cliente', like the tienda's twin", async () => {
    server.use(handlers.session(() => ok(ispActor)));
    renderApp("/links");
    expect(await screen.findByLabelText(/buscar cliente/i)).toBeInTheDocument();
  });
});

describe("US-D07: one character is not a search", () => {
  it("keeps the instruction sentence instead of firing a doomed query", async () => {
    /* The contract 400s under 2 characters; no handler registered, so
       any request here would fail the test with an MSW error screen. */
    server.use(handlers.session(() => ok(ispActor)));
    renderApp("/links");

    await userEvent.type(await screen.findByLabelText(/buscar cliente/i), "j");
    /* Past the 400ms debounce */
    await new Promise((r) => setTimeout(r, 600));

    expect(screen.getByText(/busca a un cliente por nombre/i)).toBeInTheDocument();
    expect(screen.queryByText(/no pudimos cargar/i)).not.toBeInTheDocument();
  });
});

describe("US-D07: Copiar says what happened", () => {
  it("confirms with 'Copiado' after writing the link", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    stubClipboard(writeText);

    await userEvent.click(await searchReyes());

    expect(await screen.findByText("Copiado")).toBeInTheDocument();
    expect(writeText).toHaveBeenCalledWith("https://pago.dev.devoladapago.com/p/tok-greyes");
  });

  it("says 'No se copió' when the clipboard refuses", async () => {
    stubClipboard(vi.fn().mockRejectedValue(new Error("denied")));

    await userEvent.click(await searchReyes());

    expect(await screen.findByText("No se copió")).toBeInTheDocument();
  });
});
