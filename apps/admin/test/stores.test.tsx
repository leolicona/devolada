import { describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ledgerResponse } from "@devolada/api/ledger-schema";
import { storeCreateResponse, storeItem, storesResponse } from "@devolada/api/stores-schema";
import { handlers, ispActor, ok, server } from "./msw";
import { renderApp } from "./render";

/* docs/admin/stores.spec.md scenarios 4–6. */

const store = (over: Record<string, unknown> = {}) =>
  storeItem.parse({
    id: "st-1",
    name: "Abarrotes La Esquina",
    contactName: "Don Chuy",
    phone: "5512345678",
    zone: "Col. El Mirador",
    status: "active",
    invitationStatus: "accepted",
    commissionCents: null,
    balanceCents: 89100,
    cap: { capCents: 100000, approaching: true, blocked: false },
    ...over,
  });

describe("US-A03: the list shows balances and status", () => {
  it("renders a store row with balance, cap alert and badge", async () => {
    server.use(
      handlers.session(() => ok(ispActor)),
      handlers.stores(() => ok(storesResponse.parse({ stores: [store()] }))),
    );
    renderApp("/stores");

    expect(await screen.findByText("Abarrotes La Esquina")).toBeInTheDocument();
    expect(screen.getByText("$891.00")).toBeInTheDocument();
    expect(screen.getByText("Cerca del límite")).toBeInTheDocument();
    expect(screen.getByText("Tienda activa")).toBeInTheDocument();
  });

  /* design-review D2: the badge used to reuse the subscriber's words, so a
     suspended shop told the ISP its internet was down. */
  it("never labels a store with the subscriber's internet status", async () => {
    server.use(
      handlers.session(() => ok(ispActor)),
      handlers.stores(() =>
        ok(storesResponse.parse({ stores: [store({ status: "suspended" })] })),
      ),
    );
    renderApp("/stores");

    expect(await screen.findByText("Tienda suspendida")).toBeInTheDocument();
    expect(screen.queryByText(/Servicio (activo|suspendido)/)).not.toBeInTheDocument();
  });
});

describe("US-A02: creating a store shows the copyable invitation", () => {
  it("travels from the list, submits and shows the link", async () => {
    server.use(
      handlers.session(() => ok(ispActor)),
      handlers.stores(() => ok(storesResponse.parse({ stores: [] }))),
      handlers.createStore(() =>
        ok(
          storeCreateResponse.parse({
            store: store({ status: "invited", invitationStatus: "sent", balanceCents: 0,
              cap: { capCents: 500000, approaching: false, blocked: false } }),
            invitationLink: "http://localhost:5173/invitation/inv-tok-9",
          }),
          201,
        ),
      ),
    );
    renderApp("/stores");

    await userEvent.click(await screen.findByRole("link", { name: /nueva tienda/i }));
    await userEvent.type(await screen.findByLabelText(/nombre de la tienda/i), "Miscelánea Lupita");
    await userEvent.type(screen.getByLabelText(/responsable/i), "Doña Lupita");
    await userEvent.type(screen.getByLabelText(/teléfono/i), "5587654321");
    await userEvent.click(screen.getByRole("button", { name: /registrar y crear invitación/i }));

    expect(
      await screen.findByText("http://localhost:5173/invitation/inv-tok-9"),
    ).toBeInTheDocument();
    expect(screen.getByText(/tú compartes el enlace/i)).toBeInTheDocument();
  });
});

describe("US-A03: the detail manages the store", () => {
  it("suspends the store and re-sends the invitation", async () => {
    const patches: unknown[] = [];
    let current = store({ status: "invited", invitationStatus: "sent" });
    server.use(
      handlers.session(() => ok(ispActor)),
      handlers.store(() => ok(current)),
      handlers.storeLedger(() => ok(ledgerResponse.parse({ entries: [], nextCursor: null }))),
      handlers.patchStore((body) => {
        patches.push(body);
        current = store({ ...current, status: "suspended" });
        return ok(current);
      }),
      handlers.resendInvitation(() =>
        ok({ invitationLink: "http://localhost:5173/invitation/rotated-tok" }),
      ),
    );
    renderApp("/stores/st-1");

    await userEvent.click(await screen.findByRole("button", { name: /suspender tienda/i }));
    expect(patches).toContainEqual({ status: "suspended" });
    expect(await screen.findByRole("button", { name: /reactivar tienda/i })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /reenviar invitación/i }));
    expect(await screen.findByText(/rotated-tok/)).toBeInTheDocument();
  });
});
