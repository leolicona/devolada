import { afterEach, describe, expect, it, vi } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { accessRequestList, landingCounts } from "@devolada/api/landing-schema";
import { expectNoViolations } from "./a11y";
import { businessActor, handlers, ok, server } from "./msw";
import { renderApp } from "./render";

/* landing-page US2 (FR-017, FR-024, SC-003; research D17, D23): the
   operator's third tab. The counts by channel with the three steps and
   each share of visits, "visitas = cargas de página" in words, the
   requests newest first with every answer, which form, the channel, the
   arrival time and the notice's state as icon + text; the "repetida" mark
   on rows that share a number; the CSV built from the loaded list. The
   fixtures parse with the contract (constitution III). */

const operator = { ...businessActor, platformOperator: true };

const shell = () => [
  handlers.feed(() => ok({ payments: [], nextCursor: null, today: { count: 0, totalCents: 0, startedAtMs: 0 } })),
  handlers.support(() => ok({ whatsapp: "5215512345678", email: "hola@devoladapago.com" })),
  handlers.platformSettings(() => ok({ settings: [] })),
];

const at = Date.UTC(2026, 8, 20, 18, 30);
const counts = landingCounts.parse({
  from: "2026-08-22",
  to: "2026-09-20",
  rows: [
    { day: "2026-09-19", channel: "Grupo-ISP", step: "visit", count: 30 },
    { day: "2026-09-20", channel: "Grupo-ISP", step: "visit", count: 10 },
    { day: "2026-09-20", channel: "Grupo-ISP", step: "began", count: 8 },
    { day: "2026-09-20", channel: "Grupo-ISP", step: "sent", count: 4 },
    { day: "2026-09-20", channel: "direct", step: "visit", count: 5 },
    { day: "2026-09-20", channel: "direct", step: "sent", count: 1 },
  ],
});

const requests = accessRequestList.parse({
  items: [
    { id: "r3", whatsapp: "55 1111 1111", name: null, billingSystem: null, form: "hero", repeated: true, channel: "direct", createdAt: at + 2000, notifiedAt: null, notifyError: "NO_RESEND_KEY" },
    { id: "r2", whatsapp: "55 2222 2222", name: "Ana Torres", billingSystem: "wisphub", form: "full", repeated: false, channel: "Grupo-ISP", createdAt: at + 1000, notifiedAt: at + 1500, notifyError: null },
    { id: "r1", whatsapp: "55 1111 1111", name: "Luis Pérez", billingSystem: "own_software", form: "full", repeated: true, channel: "Grupo-ISP", createdAt: at, notifiedAt: at + 500, notifyError: null },
  ],
  nextCursor: null,
});

async function openLanding() {
  const queried: URL[] = [];
  server.use(
    ...shell(),
    handlers.session(() => ok(operator)),
    handlers.landingCounts((url) => {
      queried.push(url);
      return ok(counts);
    }),
    handlers.landingRequests(() => ok(requests)),
  );
  renderApp("/operador");
  await userEvent.click(await screen.findByRole("tab", { name: "Landing" }));
  return queried;
}

afterEach(() => vi.restoreAllMocks());

describe("landing-page US2: the creator reads the answer in one tab", () => {
  it("shows one row per channel with the three steps and each share of visits, and says a visit is a page load (FR-024, D8)", async () => {
    const queried = await openLanding();
    expect(await screen.findByText(/una carga de página, no una persona/i)).toBeInTheDocument();

    const table = (await screen.findByRole("rowheader", { name: "Grupo-ISP" })).closest("table")!;
    const grupo = within(table).getByRole("rowheader", { name: "Grupo-ISP" }).closest("tr")!;
    expect(within(grupo).getAllByRole("cell").map((c) => c.textContent)).toEqual(["40", "8", "4", "20 %", "10 %"]);
    const direct = within(table).getByRole("rowheader", { name: "direct" }).closest("tr")!;
    expect(within(direct).getAllByRole("cell").map((c) => c.textContent)).toEqual(["5", "0", "1", "0 %", "20 %"]);

    /* The default period is 30 days; the picker asks for 7 */
    expect(queried[0].searchParams.get("from")).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    await userEvent.click(screen.getByRole("button", { name: "7 días" }));
    await screen.findByText(/una carga de página/i);
    const last = queried[queried.length - 1];
    const [fy, fm, fd] = last.searchParams.get("from")!.split("-").map(Number);
    const [ty, tm, td] = last.searchParams.get("to")!.split("-").map(Number);
    expect((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86_400_000).toBe(6);
  });

  it("lists the requests newest first with every answer, the form, the channel, the time and the notice state (FR-017, FR-018)", async () => {
    await openLanding();
    const table = (await screen.findByText("Ana Torres")).closest("table")!;
    const rows = within(table).getAllByRole("row").slice(1);
    expect(rows.map((r) => within(r).getAllByRole("cell")[0].textContent)).toEqual([
      "55 1111 1111repetida",
      "55 2222 2222",
      "55 1111 1111repetida",
    ]);
    const ana = rows[1];
    expect(within(ana).getByText("WispHub")).toBeInTheDocument();
    expect(within(ana).getByText("completo")).toBeInTheDocument();
    expect(within(ana).getByText("Grupo-ISP")).toBeInTheDocument();
    expect(within(ana).getByText("Entregado")).toBeInTheDocument();
    const hero = rows[0];
    expect(within(hero).getByText("inicio")).toBeInTheDocument();
    expect(within(hero).getByText("sin respuesta")).toBeInTheDocument();
    expect(within(hero).getByText("Sin entregar")).toBeInTheDocument();
    expect(within(hero).getByText("NO_RESEND_KEY")).toBeInTheDocument();
    /* SC-003: the one-line count by billing system */
    expect(screen.getByText(/por sistema: WispHub 1 · propio 1 · otro 0 · ninguno 0 · sin respuesta 1/)).toBeInTheDocument();
  });

  it("marks the rows that share a WhatsApp as repetida, and the one with its own number not (the 'same person asks twice' edge case)", async () => {
    await openLanding();
    await screen.findByText("Ana Torres");
    const marks = screen.getAllByText("repetida");
    expect(marks).toHaveLength(2);
    for (const m of marks) expect(m.closest("tr")!.textContent).toContain("55 1111 1111");
    expect(screen.getByText("55 2222 2222").closest("tr")!.textContent).not.toContain("repetida");
  });

  it("Exportar CSV builds a file whose rows match the list (FR-017, D17)", async () => {
    await openLanding();
    await screen.findByText("Ana Torres");
    let captured: Blob | null = null;
    Object.assign(URL, {
      createObjectURL: vi.fn((blob: Blob) => {
        captured = blob;
        return "blob:landing";
      }),
      revokeObjectURL: vi.fn(),
    });
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    await userEvent.click(screen.getByRole("button", { name: "Exportar CSV" }));
    expect(click).toHaveBeenCalledTimes(1);
    const csv = await captured!.text();
    const lines = csv.split("\n");
    expect(lines[0]).toBe("whatsapp,nombre,sistema,formulario,canal,llego,aviso,repetida");
    expect(lines).toHaveLength(4);
    expect(lines[1]).toMatch(/^55 1111 1111,,,inicio,direct,.*,NO_RESEND_KEY,sí$/);
    expect(lines[2]).toMatch(/^55 2222 2222,Ana Torres,WispHub,completo,Grupo-ISP,.*,entregado,no$/);
    expect(lines[3]).toMatch(/^55 1111 1111,Luis Pérez,Sistema propio,completo,Grupo-ISP,.*,entregado,sí$/);
  });

  it("the tab has no accessibility violation", async () => {
    await openLanding();
    await screen.findByText("Ana Torres");
    await expectNoViolations(screen.getByRole("tabpanel"));
  });
});
