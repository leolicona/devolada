import { afterEach, describe, expect, it, vi } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse } from "msw";
import {
  benchListResponse,
  benchReceiptDetail,
  benchTallyResponse,
  readerStateResponse,
  type BenchReceiptDetail,
} from "@devolada/api/reader-schema";
import { expectNoViolations } from "./a11y";
import { businessActor, handlers, ok, server } from "./msw";
import { renderApp } from "./render";

/* receipt-reader-tuning US1 and US3 (D19; contracts/reader-api.md): the
   operator's fourth tab, Lector — the model card, the test bench and the
   results. Fixtures parse with the contract (constitution III); axe runs
   on each state. */

const operator = { ...businessActor, platformOperator: true };
const DEFAULT = "@cf/mistralai/mistral-small-3.1-24b-instruct";
const GEMMA = "@cf/google/gemma-4-26b-a4b-it";
const at = Date.UTC(2026, 8, 25, 18, 30);

const shell = () => [
  handlers.feed(() => ok({ payments: [], nextCursor: null, today: { count: 0, totalCents: 0, startedAtMs: 0 } })),
  handlers.support(() => ok({ whatsapp: "5215512345678", email: "hola@devoladapago.com" })),
  handlers.platformSettings(() => ok({ settings: [] })),
  handlers.session(() => ok(operator)),
];

const state = (over: Record<string, unknown> = {}) =>
  readerStateResponse.parse({
    models: [
      { id: DEFAULT, label: "Mistral Small 3.1" },
      { id: GEMMA, label: "Gemma 4 26B" },
    ],
    defaultModel: DEFAULT,
    activeModel: DEFAULT,
    choice: "default",
    staleChoice: null,
    history: [],
    fallbacksLast7Days: 0,
    questionVersion: "2",
    readerAvailable: true,
    ...over,
  });

const READ = {
  isReceipt: true,
  legibility: "full",
  trackingKey: null,
  referenceNumber: "250926",
  senderBank: "AZTECA",
  receivingBank: "AZTECA",
  amountCents: 35000,
  date: "2026-09-25",
  destination: { kind: "clabe", digits: "7897" },
  sameBank: true,
};

const detail = (over: Partial<BenchReceiptDetail> = {}) =>
  benchReceiptDetail.parse({
    id: "b1",
    mediaType: "image/png",
    byteSize: 1200,
    createdAt: at,
    fileAvailable: true,
    missing: [],
    readings: [
      {
        id: "r1",
        model: DEFAULT,
        modelLabel: "Mistral Small 3.1",
        questionVersion: "2",
        status: "read",
        failureCode: null,
        readerMs: 3100,
        reading: READ,
        rawOutput: '```json\n{"esComprobante": true}\n```',
        marks: {},
        judged: {},
        markedAt: null,
      },
      {
        id: "r2",
        model: GEMMA,
        modelLabel: "Gemma 4 26B",
        questionVersion: "2",
        status: "failed",
        failureCode: "READER_UNREADABLE",
        readerMs: 4200,
        reading: null,
        rawOutput: '{"choices": []}',
        marks: {},
        judged: {},
        markedAt: null,
      },
    ],
    ...over,
  });

const list = benchListResponse.parse({
  items: [
    {
      id: "b1",
      mediaType: "image/png",
      byteSize: 1200,
      createdAt: at,
      fileAvailable: true,
      readings: [
        { id: "r1", model: DEFAULT, modelLabel: "Mistral Small 3.1", questionVersion: "2", status: "read", readerMs: 3100, marked: 4 },
        { id: "r2", model: GEMMA, modelLabel: "Gemma 4 26B", questionVersion: "2", status: "failed", readerMs: 4200, marked: 0 },
      ],
    },
  ],
  nextCursor: null,
});

const tally = benchTallyResponse.parse({
  asOf: at,
  rows: [
    {
      model: DEFAULT,
      modelLabel: "Mistral Small 3.1",
      questionVersion: "2",
      readings: 7,
      failures: 0,
      judged: 50,
      right: 45,
      wrongByField: { trackingKey: 3, senderBank: 2, date: 0 },
      p90Ms: 3400,
    },
  ],
});

function arrange(over: { state?: ReturnType<typeof state>; list?: typeof list; detail?: BenchReceiptDetail } = {}) {
  const posts: unknown[] = [];
  server.use(
    ...shell(),
    handlers.readerState(() => ok(over.state ?? state())),
    handlers.readerChoose((body) => {
      posts.push(body);
      return ok(state({ activeModel: GEMMA, choice: "applies" }), 201);
    }),
    handlers.benchList(() => ok(over.list ?? benchListResponse.parse({ items: [], nextCursor: null }))),
    handlers.benchTally(() => ok(tally)),
    handlers.benchDetail(() => ok(over.detail ?? detail())),
    handlers.benchFile(() => new HttpResponse(new Uint8Array([0x89, 0x50, 0x4e, 0x47]), { headers: { "Content-Type": "image/png" } })),
  );
  return posts;
}

async function openReader() {
  renderApp("/operador");
  await userEvent.click(await screen.findByRole("tab", { name: "Lector" }));
  await screen.findByText("Modelo que lee los comprobantes");
}

afterEach(() => vi.restoreAllMocks());

describe("receipt-reader-tuning US1: the Lector tab — the operator chooses the model", () => {
  it("the tab is the operator's; a business user is sent away from /operador", async () => {
    server.use(...shell());
    /* A later `use` wins over the shell's operator session */
    server.use(handlers.session(() => ok(businessActor)));
    const router = renderApp("/operador");
    await vi.waitFor(() => expect(router.state.location.pathname).toBe("/payments"));
    expect(screen.queryByRole("tab", { name: "Lector" })).not.toBeInTheDocument();
  });

  it("shows the active model with 'Por defecto', the fallbacks and the history", async () => {
    arrange({
      state: state({
        fallbacksLast7Days: 2,
        history: [{ value: DEFAULT, authorUserId: "user-1", authorEmail: "demo@devolada.app", createdAt: at }],
        choice: "applies",
      }),
    });
    await openReader();
    const card = screen.getByText("Modelo que lee los comprobantes").closest("div")!.parentElement!;
    expect(within(card).getByText("Mistral Small 3.1")).toBeInTheDocument();
    expect(within(card).getByText(/Por defecto/)).toBeInTheDocument();
    expect(within(card).getByText(/Respaldos en los últimos 7 días: 2/)).toBeInTheDocument();
    expect(within(card).getByText(/El modelo elegido falló y leyó el modelo por defecto/)).toBeInTheDocument();
    expect(within(card).getByText("Cambios recientes")).toBeInTheDocument();
    /* FR-002: who chose it, by the address a person recognises — never a row id */
    const change = within(card).getByText(/demo@devolada\.app/);
    expect(change.textContent).toContain("Mistral Small 3.1");
    expect(change.textContent).not.toContain("user-1");
    await expectNoViolations(screen.getByRole("tabpanel"));
  });

  it("a stale choice says which one and that the default reads", async () => {
    arrange({
      state: state({
        choice: "stale",
        staleChoice: "@cf/old/model",
        /* The stale choice's author left: the row still shows, and says so */
        history: [{ value: "@cf/old/model", authorUserId: "user-gone", authorEmail: null, createdAt: at }],
      }),
    });
    await openReader();
    expect(await screen.findByText(/La elección anterior \(@cf\/old\/model\) ya no está disponible/)).toBeInTheDocument();
    const change = screen.getByText(/cuenta eliminada/);
    expect(change.textContent).toContain("@cf/old/model");
    expect(change.textContent).not.toContain("user-gone");
    await expectNoViolations(screen.getByRole("tabpanel"));
  });

  it("'Usar este modelo' is disabled until the selection changes, then posts the model id", async () => {
    const posts = arrange();
    await openReader();
    const use = screen.getByRole("button", { name: "Usar este modelo" });
    expect(use).toBeDisabled();
    await userEvent.click(screen.getByLabelText("Modelo"));
    await userEvent.click(await screen.findByRole("option", { name: "Gemma 4 26B" }));
    expect(use).toBeEnabled();
    await userEvent.click(use);
    await vi.waitFor(() => expect(posts).toEqual([{ modelId: GEMMA }]));
  });

  it("a one-model list shows the select disabled and says so", async () => {
    arrange({ state: state({ models: [{ id: DEFAULT, label: "Mistral Small 3.1" }] }) });
    await openReader();
    expect(screen.getByText("Este ambiente tiene un solo modelo.")).toBeInTheDocument();
    expect(screen.getByLabelText("Modelo")).toBeDisabled();
    await expectNoViolations(screen.getByRole("tabpanel"));
  });

  it("no reader in this environment is said in words", async () => {
    arrange({ state: state({ readerAvailable: false }) });
    await openReader();
    expect(screen.getByText(/Este ambiente no tiene lector; los comprobantes van directo al proveedor/)).toBeInTheDocument();
    await expectNoViolations(screen.getByRole("tabpanel"));
  });
});

describe("receipt-reader-tuning US3: the Lector tab — banco de pruebas and results", () => {
  const objectUrls = () =>
    Object.assign(URL, { createObjectURL: vi.fn(() => "blob:bench"), revokeObjectURL: vi.fn() });

  it("uploading shows the receipt side by side; a duplicate says so", async () => {
    objectUrls();
    arrange();
    server.use(handlers.benchUpload(() => ok({ ...detail(), duplicate: true }, 200)));
    await openReader();
    const file = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], "r.png", { type: "image/png" });
    await userEvent.upload(screen.getByLabelText("Comprobante de prueba"), file);
    expect(await screen.findByText("Comprobante de prueba")).toBeInTheDocument();
    expect(screen.getByText("Este comprobante ya estaba en el banco.")).toBeInTheDocument();
    await expectNoViolations(screen.getByRole("tabpanel"));
  });

  it("the detail: nine rows, 'No se ve', the same-bank flag as icon + text, a failed column with its reason and raw answer", async () => {
    objectUrls();
    arrange({ list });
    await openReader();
    await userEvent.click(await screen.findByRole("button", { name: /Mistral Small 3\.1: leído en 3\.1 s/ }));
    const mistral = await screen.findByRole("region", { name: "Mistral Small 3.1 · v2" });
    for (const label of ["¿Es comprobante?", "Legibilidad", "Clave de rastreo", "Referencia", "Banco emisor", "Banco receptor", "Monto", "Fecha", "Destino"]) {
      expect(within(mistral).getByText(label)).toBeInTheDocument();
    }
    expect(within(mistral).getByText("No se ve")).toBeInTheDocument();
    expect(within(mistral).getAllByText("Mismo banco")).toHaveLength(2);
    /* No "No aparece" on the first two rows */
    expect(within(mistral).getByRole("group", { name: "Revisión de ¿Es comprobante?" }).textContent).not.toContain("No aparece");
    expect(within(mistral).getByRole("group", { name: "Revisión de Clave de rastreo" }).textContent).toContain("No aparece");

    expect(screen.getByText("Respuesta sin datos")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Ver respuesta del modelo" }).length).toBeGreaterThanOrEqual(2);
    expect(await screen.findByAltText("El comprobante de prueba")).toBeInTheDocument();
    await expectNoViolations(screen.getByRole("tabpanel"));
  });

  it("marks: the three-way control, and 'Guardar revisión' sends the marks", async () => {
    objectUrls();
    arrange({ list });
    const sent: unknown[] = [];
    server.use(
      handlers.benchMarks((id, body) => {
        sent.push({ id, body });
        return ok(detail().readings[0]);
      }),
    );
    await openReader();
    await userEvent.click(await screen.findByRole("button", { name: /Mistral Small 3\.1: leído/ }));
    const clave = await screen.findByRole("group", { name: "Revisión de Clave de rastreo" });
    await userEvent.click(within(clave).getByRole("button", { name: "No aparece" }));
    expect(within(clave).getByRole("button", { name: "No aparece" })).toHaveAttribute("aria-pressed", "true");
    const ref = screen.getByRole("group", { name: "Revisión de Referencia" });
    await userEvent.click(within(ref).getByRole("button", { name: "Correcto" }));
    await userEvent.click(screen.getByRole("button", { name: "Guardar revisión" }));
    await vi.waitFor(() =>
      expect(sent).toEqual([{ id: "r1", body: { marks: { trackingKey: "absent", referenceNumber: "right" } } }]),
    );
  });

  it("'Leer de nuevo' appears only when a model is missing; a gone file is said in words and the readings stay", async () => {
    objectUrls();
    arrange({ list, detail: detail({ fileAvailable: false, missing: [{ model: GEMMA, questionVersion: "2" }] }) });
    await openReader();
    await userEvent.click(await screen.findByRole("button", { name: /Mistral Small 3\.1: leído/ }));
    expect(await screen.findByRole("button", { name: "Leer de nuevo" })).toBeInTheDocument();
    expect(screen.getByText(/Falta leer con: @cf\/google\/gemma-4-26b-a4b-it/)).toBeInTheDocument();
    expect(screen.getByText(/La imagen ya se borró \(se guarda 15 días\)/)).toBeInTheDocument();
    expect(screen.getAllByText("Clave de rastreo").length).toBeGreaterThan(0);
    await expectNoViolations(screen.getByRole("tabpanel"));
  });

  it("with nothing missing there is no 'Leer de nuevo'", async () => {
    objectUrls();
    arrange({ list });
    await openReader();
    await userEvent.click(await screen.findByRole("button", { name: /Mistral Small 3\.1: leído/ }));
    await screen.findByText("Comprobante de prueba");
    expect(screen.queryByRole("button", { name: "Leer de nuevo" })).not.toBeInTheDocument();
  });

  it("Resultados: one row per model and version, the 'Al …' date and the two worst fields", async () => {
    arrange();
    await openReader();
    const row = (await screen.findByRole("rowheader", { name: "Mistral Small 3.1" })).closest("tr")!;
    expect(within(row).getAllByRole("cell").map((c) => c.textContent)).toEqual([
      "v2",
      "7",
      "0",
      "50",
      "45 (90 %)",
      "3.4 s",
      "Clave de rastreo (3), Banco emisor (2)",
    ]);
    expect(screen.getByText(/^Al /)).toBeInTheDocument();
    await expectNoViolations(screen.getByRole("tabpanel"));
  });
});
