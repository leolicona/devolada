import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { customersResponse } from "@devolada/api/direct-payments-schema";
import { handlers, businessActor, fail, ok, server } from "./msw";
import { renderApp } from "./render";
import { expectNoViolations } from "./a11y";
import { FOCUS_FLOOR_MS, resetPresenceForTests } from "../src/lib/presence";
import { RESULTS_TTL_MS, resetSeenForTests } from "../src/features/links/seen";

/* links-on-demand-search US1: the page asks for one screenful instead
   of reading a customer base.

   The roster is gone and with it three things this file used to assert:
   the whole tenant alive on arrival, a local contains over it, and
   "consultado hace X min". What replaces them is one block read live, a
   search put to the provider, and a link that is born when an operator
   presses something (FR-008). */

const panel = (over: Record<string, unknown> = {}) => ({
  channel: "panel",
  usuario: "greyes",
  wisphubId: 101,
  customerRef: null,
  label: null,
  askCents: null,
  linkState: null,
  name: "Janely Reyes",
  phone: "5551234567",
  hasLink: false,
  url: null,
  waLink: null,
  ...over,
});

const api = (over: Record<string, unknown> = {}) => ({
  channel: "api",
  usuario: null,
  wisphubId: null,
  customerRef: "CLI-4471",
  label: "Ana Ruiz",
  askCents: 49900,
  linkState: "open",
  name: "Ana Ruiz",
  phone: null,
  hasLink: true,
  url: "https://link.dev.devoladapago.com/p/tok-cli4471",
  waLink: "https://wa.me/?text=hola",
  ...over,
});

const block = (rows: unknown[], over: Record<string, unknown> = {}) =>
  customersResponse.parse({
    results: rows,
    nextCursor: null,
    matched: null,
    total: rows.length,
    wisphub: "ok",
    ...over,
  });

const twoCustomers = () => [
  panel(),
  panel({ usuario: "aflores", wisphubId: 102, name: "Abraham Flores", phone: null }),
];

function stubClipboard(writeText: (text: string) => Promise<void>) {
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
}

const arrange = (
  answer: (url: URL) => ReturnType<typeof ok | typeof fail> = () => ok(block(twoCustomers())),
) => {
  server.use(handlers.session(() => ok(businessActor)), handlers.customers(answer));
  renderApp("/links");
};

describe("US1: the page opens on one block, read live", () => {
  it("shows the first block and how many customers the ISP has — never a read age, never an incomplete-list warning", async () => {
    arrange(() => ok(block(twoCustomers(), { total: 6513 })));
    expect(await screen.findByText("Janely Reyes")).toBeInTheDocument();
    expect(screen.getByText("Abraham Flores")).toBeInTheDocument();
    /* FR-018: the count the provider answers with every block */
    expect(screen.getByText(/6,513 clientes en WispHub/)).toBeInTheDocument();
    /* FR-027 / D15: a block is read when it renders, so there is no age
       to print and nothing to refresh by hand */
    expect(screen.queryByText(/consultado hace/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /actualizar/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/puede estar incompleta/i)).not.toBeInTheDocument();
  });

  it("asks for a block sized to the viewport, inside the band the server allows (FR-020, D3)", async () => {
    let asked: URL | null = null;
    arrange((url) => {
      asked = url;
      return ok(block(twoCustomers()));
    });
    await screen.findByText("Janely Reyes");
    const limit = Number(asked!.searchParams.get("limit"));
    expect(limit).toBeGreaterThanOrEqual(10);
    expect(limit).toBeLessThanOrEqual(50);
    /* A browse carries no text */
    expect(asked!.searchParams.get("q")).toBeNull();
  });

  it("a row whose customer has no link shows the same two buttons as one who has (FR-008, FR-026)", async () => {
    arrange(() => ok(block([panel({ hasLink: false, url: null, waLink: null })])));
    await screen.findByText("Janely Reyes");
    expect(screen.getByRole("button", { name: /copiar/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /whatsapp/i })).toBeInTheDocument();
    await expectNoViolations(document.body);
  });
});

describe("US1: the link is born on the act", () => {
  it("Copiar on a customer with no link calls the create door once, then copies what it returns", async () => {
    const copied: string[] = [];
    stubClipboard((text) => {
      copied.push(text);
      return Promise.resolve();
    });
    let posts = 0;
    server.use(
      handlers.session(() => ok(businessActor)),
      handlers.customers(() => ok(block([panel()]))),
      handlers.createLink((body) => {
        posts++;
        expect(body).toEqual({ usuario: "greyes" });
        return ok({
          token: "tok-greyes",
          url: "https://link.dev.devoladapago.com/p/tok-greyes",
          waLink: "https://wa.me/525551234567?text=hola",
          created: true,
        });
      }),
    );
    renderApp("/links");

    await screen.findByText("Janely Reyes");
    await userEvent.click(screen.getByRole("button", { name: /copiar/i }));

    expect(await screen.findByText("Copiado")).toBeInTheDocument();
    expect(copied).toEqual(["https://link.dev.devoladapago.com/p/tok-greyes"]);
    expect(posts).toBe(1);

    /* FR-005 / FR-009: the link is permanent, so a second press asks for
       nothing and copies the same address */
    await userEvent.click(screen.getByRole("button", { name: /copiar/i }));
    await waitFor(() => expect(copied).toHaveLength(2));
    expect(posts).toBe(1);
    expect(copied[1]).toBe(copied[0]);
  });

  it("a row that already has its link copies without asking the door at all", async () => {
    stubClipboard(() => Promise.resolve());
    let posts = 0;
    server.use(
      handlers.session(() => ok(businessActor)),
      handlers.customers(() =>
        ok(block([panel({ hasLink: true, url: "https://pago.test/p/tok", waLink: "https://wa.me/52555?text=x" })])),
      ),
      handlers.createLink(() => {
        posts++;
        return ok({ token: "t", url: "u", waLink: "w", created: false });
      }),
    );
    renderApp("/links");
    await screen.findByText("Janely Reyes");
    await userEvent.click(screen.getByRole("button", { name: /copiar/i }));
    expect(await screen.findByText("Copiado")).toBeInTheDocument();
    expect(posts).toBe(0);
  });

  it("WhatsApp opens its window on the click and fills it when the link lands (D9)", async () => {
    const opened = { location: { href: "" }, close: vi.fn(), opener: {} as unknown };
    const open = vi.spyOn(window, "open").mockReturnValue(opened as unknown as Window);
    server.use(
      handlers.session(() => ok(businessActor)),
      handlers.customers(() => ok(block([panel()]))),
      handlers.createLink(() =>
        ok({
          token: "tok-greyes",
          url: "https://pago.test/p/tok-greyes",
          waLink: "https://wa.me/525551234567?text=hola",
          created: true,
        }),
      ),
    );
    renderApp("/links");

    await screen.findByText("Janely Reyes");
    await userEvent.click(screen.getByRole("button", { name: /whatsapp/i }));

    /* The window was opened blank by the click itself — a browser blocks
       `open` called after an await, and creating the link is an await */
    expect(open).toHaveBeenCalledWith("about:blank", "_blank");
    await waitFor(() => expect(opened.location.href).toBe("https://wa.me/525551234567?text=hola"));
    expect(await screen.findByText("Enviado")).toBeInTheDocument();
    open.mockRestore();
  });

  it("a create that fails closes the blank window instead of leaving it staring back", async () => {
    const opened = { location: { href: "" }, close: vi.fn(), opener: {} as unknown };
    const open = vi.spyOn(window, "open").mockReturnValue(opened as unknown as Window);
    server.use(
      handlers.session(() => ok(businessActor)),
      handlers.customers(() => ok(block([panel()]))),
      handlers.createLink(() => fail("WISPHUB_UNAVAILABLE", 503)),
    );
    renderApp("/links");

    await screen.findByText("Janely Reyes");
    await userEvent.click(screen.getByRole("button", { name: /whatsapp/i }));
    await waitFor(() => expect(opened.close).toHaveBeenCalled());
    expect(opened.location.href).toBe("");
    open.mockRestore();
  });

  it("FR-022: the row keeps its mark for the rest of the session, and promises it to nobody else", async () => {
    stubClipboard(() => Promise.resolve());
    server.use(
      handlers.session(() => ok(businessActor)),
      handlers.customers(() => ok(block(twoCustomers()))),
      handlers.createLink(() => ok({ token: "t", url: "https://pago.test/p/t", waLink: "https://wa.me/?text=x", created: true })),
    );
    renderApp("/links");
    await screen.findByText("Janely Reyes");
    await userEvent.click(screen.getAllByRole("button", { name: /copiar/i })[0]);
    expect(await screen.findByText("Copiado")).toBeInTheDocument();

    /* Leave the page and come back: the mark is still on that row and on
       no other */
    cleanup();
    server.use(handlers.session(() => ok(businessActor)), handlers.customers(() => ok(block(twoCustomers()))));
    renderApp("/links");
    const janely = (await screen.findByText("Janely Reyes")).closest("li")!;
    const abraham = screen.getByText("Abraham Flores").closest("li")!;
    expect(janely.textContent).toMatch(/Copiado/);
    expect(abraham.textContent).not.toMatch(/Copiado/);
  });
});

describe("US1: the search asks the provider, once the operator pauses", () => {
  it("says so below three characters and asks nothing (FR-002)", async () => {
    let calls = 0;
    arrange(() => {
      calls++;
      return ok(block(twoCustomers()));
    });
    await screen.findByText("Janely Reyes");
    await userEvent.type(screen.getByLabelText(/buscar cliente/i), "ma");

    expect(await screen.findByText(/escribe al menos 3 letras para buscar/i)).toBeInTheDocument();
    /* The first block is still on screen: nothing was thrown away */
    expect(screen.getByText("Janely Reyes")).toBeInTheDocument();
    expect(calls).toBe(1);
  });

  it("puts the text to the door and says how many matched, as a floor (FR-006, D5)", async () => {
    const asked: string[] = [];
    arrange((url) => {
      const q = url.searchParams.get("q");
      if (q === null) return ok(block(twoCustomers()));
      asked.push(q);
      return ok(block([panel({ name: "María Fernanda López" })], { matched: 904, total: null }));
    });
    await screen.findByText("Janely Reyes");
    await userEvent.type(screen.getByLabelText(/buscar cliente/i), "mar");

    expect(await screen.findByText(/más de 904 clientes coinciden con «mar»/i)).toBeInTheDocument();
    expect(screen.getByText(/escribe más letras para acotar la búsqueda/i)).toBeInTheDocument();
    /* One request for the pause, not one per keystroke (FR-002) */
    expect(asked).toEqual(["mar"]);
  });

  it("says plainly how many when everything that matched is on screen", async () => {
    arrange((url) =>
      url.searchParams.get("q") === null
        ? ok(block(twoCustomers()))
        : ok(block([panel({ name: "María Fernanda López" })], { matched: 1, total: null })),
    );
    await screen.findByText("Janely Reyes");
    await userEvent.type(screen.getByLabelText(/buscar cliente/i), "maria");
    expect(await screen.findByText(/1 cliente coincide con «maria»/i)).toBeInTheDocument();
  });

  it("names the text nobody matched", async () => {
    arrange((url) =>
      url.searchParams.get("q") === null ? ok(block(twoCustomers())) : ok(block([], { total: null })),
    );
    await screen.findByText("Janely Reyes");
    await userEvent.type(screen.getByLabelText(/buscar cliente/i), "zzz");
    expect(await screen.findByText(/ningún cliente coincide con «zzz»/i)).toBeInTheDocument();
  });

  it("the search box keeps its accessible name and refuses autofill", async () => {
    arrange();
    const box = await screen.findByLabelText(/buscar cliente/i);
    expect(box).toHaveAttribute("autocomplete", "off");
    expect(box).toHaveAttribute("name", "customer-search");
  });
});

/* automated-collections-api US1 scenario 11 (FR-011), carried into
   FR-007: one list per business, both channels, each row marked. */
describe("US1: both channels in one list", () => {
  it("marks every row with its channel as icon + text, and the API row shows the reference and the ask", async () => {
    arrange(() => ok(block([...twoCustomers(), api()])));
    expect(await screen.findByText("Ana Ruiz")).toBeInTheDocument();
    expect(screen.getAllByText("Panel")).toHaveLength(2);
    expect(screen.getAllByText("API")).toHaveLength(1);
    expect(screen.getByText(/CLI-4471/)).toBeInTheDocument();
    expect(screen.getByText(/\$499\.00/)).toBeInTheDocument();
    /* WispHub copy only on panel rows, and the API row names no provider */
    const apiItem = screen.getByText("Ana Ruiz").closest("li")!;
    expect(apiItem.textContent).not.toMatch(/wisphub/i);
    await expectNoViolations(document.body);
  });

  it("a closed one-time link says so on its row", async () => {
    arrange(() => ok(block([api({ linkState: "paid" })])));
    expect(await screen.findByText(/link pagado/i)).toBeInTheDocument();
  });

  it("a business without WispHub sees its API links alone, and an empty list points at the API (FR-015)", async () => {
    server.use(
      handlers.session(() => ok({ ...businessActor, integrationConfigured: false })),
      handlers.customers(() => ok(block([api()], { wisphub: "not_configured", total: null }))),
    );
    renderApp("/links");
    expect(await screen.findByText("Ana Ruiz")).toBeInTheDocument();

    cleanup();
    server.use(
      handlers.session(() => ok({ ...businessActor, integrationConfigured: false })),
      handlers.customers(() => ok(block([], { wisphub: "not_configured", total: null }))),
    );
    renderApp("/links");
    expect(await screen.findByText(/tu sistema puede crearlos desde la api de cobros/i)).toBeInTheDocument();
  });

  it("a provider that stalled with nothing to show is the error block, with a retry", async () => {
    arrange(() => fail("WISPHUB_UNAVAILABLE", 503));
    expect(await screen.findByRole("button", { name: /reintentar/i })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /ir a integraciones/i })).not.toBeInTheDocument();
  });

  it("says 'No se copió' when the clipboard refuses", async () => {
    stubClipboard(() => Promise.reject(new Error("denied")));
    arrange(() => ok(block([panel({ hasLink: true, url: "https://pago.test/p/tok", waLink: "https://wa.me/?text=x" })])));
    await screen.findByText("Janely Reyes");
    await userEvent.click(screen.getByRole("button", { name: /copiar/i }));
    expect(await screen.findByText("No se copió")).toBeInTheDocument();
  });
});

/* bug: links-refused-key — the same refusal Cobros learned to name
   (cobros-installation-fallback): a key the installation rejected is
   setup, not weather, and the page says so with the same sentence and
   the same door, never with a Reintentar. */
describe("bug links-refused-key: a refused key is a setup problem, not an outage", () => {
  function setVisibility(state: "visible" | "hidden") {
    Object.defineProperty(document, "visibilityState", { value: state, configurable: true });
    document.dispatchEvent(new Event("visibilitychange", { bubbles: true }));
  }
  beforeEach(() => {
    setVisibility("visible");
    resetPresenceForTests();
  });
  afterEach(() => {
    vi.useRealTimers();
    setVisibility("visible");
  });

  it("WISPHUB_AUTH_FAILED → the Integraciones door, the installation named first, no Reintentar, no search box", async () => {
    arrange(() => fail("WISPHUB_AUTH_FAILED", 503));
    const sentence = await screen.findByText(/wisphub rechazó la conexión/i);
    const notice = sentence.closest('[role="status"]') as HTMLElement;
    expect(notice).not.toBeNull();
    expect(notice).toHaveTextContent(/revisa primero la instalación y luego la llave/i);
    expect(screen.getByRole("link", { name: /ir a integraciones/i })).toHaveAttribute(
      "href",
      "/integrations/wisphub",
    );
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /reintentar/i })).not.toBeInTheDocument();
    /* Nothing to search until the read is allowed again */
    expect(screen.queryByRole("searchbox")).not.toBeInTheDocument();
    await expectNoViolations(document.body);
  });

  it("a background read that starts being refused replaces the rows with the door, not a quiet note", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let reads = 0;
    server.use(
      handlers.session(() => ok(businessActor)),
      handlers.customers(() => {
        reads++;
        return reads === 1 ? ok(block(twoCustomers())) : fail("WISPHUB_AUTH_FAILED", 503);
      }),
    );
    renderApp("/links");
    expect(await screen.findByText("Janely Reyes")).toBeInTheDocument();

    /* FR-027 / D15: the return to the tab re-reads the FIRST block,
       above the 30-second floor — the one part of presence-freshness
       this feature keeps */
    vi.advanceTimersByTime(FOCUS_FLOOR_MS + 1_000);
    setVisibility("hidden");
    setVisibility("visible");

    expect(await screen.findByText(/wisphub rechazó la conexión/i)).toBeInTheDocument();
    expect(reads).toBe(2);
    expect(screen.queryByText("Janely Reyes")).not.toBeInTheDocument();
    expect(screen.queryByText(/sin conexión a wisphub/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /reintentar/i })).not.toBeInTheDocument();
  });
});

/* links-on-demand-search US2: the search survives leaving the page.

   Three stores, no server state (D11): the URL carries the text, so a
   pasted address opens on that search and the back button lands on it;
   `sessionStorage` carries the results for two minutes, because a query
   cache dies on reload and the operator should not pay a second visible
   wait for the search they just did.

   What is NOT promised: past two minutes the same text asks again, and
   an empty box leaves nothing behind — a browse is not a search. */
describe("US2: the text lives in the address and the results in the session", () => {
  it("FR-011: the address carries the settled text, and a pasted address opens on that search", async () => {
    const asked: string[] = [];
    const answer = (url: URL) => {
      const q = url.searchParams.get("q");
      if (q === null) return ok(block(twoCustomers()));
      asked.push(q);
      return ok(block([panel({ name: "María Fernanda López" })], { matched: 1, total: null }));
    };

    /* Typed here: the address follows once the text settles */
    server.use(handlers.session(() => ok(businessActor)), handlers.customers(answer));
    const router = renderApp("/links");
    await screen.findByText("Janely Reyes");
    await userEvent.type(screen.getByLabelText(/buscar cliente/i), "maria");
    expect(await screen.findByText("María Fernanda López")).toBeInTheDocument();
    await waitFor(() => expect(router.state.location.search).toEqual({ q: "maria" }));

    /* Pasted there: the same search, with the box already filled */
    cleanup();
    resetSeenForTests();
    server.use(handlers.session(() => ok(businessActor)), handlers.customers(answer));
    renderApp("/links?q=maria");
    expect(await screen.findByText("María Fernanda López")).toBeInTheDocument();
    expect(screen.getByLabelText(/buscar cliente/i)).toHaveValue("maria");
  });

  it("FR-012: remounting inside two minutes restores the results without asking again", async () => {
    let searches = 0;
    const answer = (url: URL) => {
      const q = url.searchParams.get("q");
      if (q === null) return ok(block(twoCustomers()));
      searches++;
      return ok(block([panel({ name: "María Fernanda López" })], { matched: 1, total: null }));
    };
    server.use(handlers.session(() => ok(businessActor)), handlers.customers(answer));
    renderApp("/links");
    await screen.findByText("Janely Reyes");
    await userEvent.type(screen.getByLabelText(/buscar cliente/i), "maria");
    expect(await screen.findByText("María Fernanda López")).toBeInTheDocument();
    expect(searches).toBe(1);

    /* Leave and come back — a fresh query cache, the session's memory
       intact: the rows are there before anything is asked */
    cleanup();
    server.use(handlers.session(() => ok(businessActor)), handlers.customers(answer));
    renderApp("/links?q=maria");
    expect(await screen.findByText("María Fernanda López")).toBeInTheDocument();
    expect(searches).toBe(1);
  });

  it("FR-012: a stored search older than two minutes is asked again", async () => {
    let searches = 0;
    const answer = (url: URL) => {
      const q = url.searchParams.get("q");
      if (q === null) return ok(block(twoCustomers()));
      searches++;
      return ok(block([panel({ name: "María Fernanda López" })], { matched: 1, total: null }));
    };
    server.use(handlers.session(() => ok(businessActor)), handlers.customers(answer));
    renderApp("/links");
    await screen.findByText("Janely Reyes");
    await userEvent.type(screen.getByLabelText(/buscar cliente/i), "maria");
    await screen.findByText("María Fernanda López");
    expect(searches).toBe(1);

    /* Age the entry past its two minutes, in the store itself */
    const raw = JSON.parse(sessionStorage.getItem("devolada.links.results.v1")!);
    for (const entry of Object.values(raw) as { at: number }[]) {
      entry.at = Date.now() - (RESULTS_TTL_MS + 1_000);
    }
    sessionStorage.setItem("devolada.links.results.v1", JSON.stringify(raw));

    cleanup();
    server.use(handlers.session(() => ok(businessActor)), handlers.customers(answer));
    renderApp("/links?q=maria");
    expect(await screen.findByText("María Fernanda López")).toBeInTheDocument();
    expect(searches).toBe(2);
  });

  it("an empty box leaves no entry behind: a browse is not a search", async () => {
    arrange();
    await screen.findByText("Janely Reyes");
    await waitFor(() =>
      expect(sessionStorage.getItem("devolada.links.results.v1")).toBeNull(),
    );
  });
});
