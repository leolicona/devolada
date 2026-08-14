import { describe, expect, it } from "vitest";
import { act, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { fail as failResponse, handlers, ok, server, storeActor } from "./msw";
import { renderApp } from "./render";

/* docs/auth/store-invitation.spec.md scenarios 4–6. */

describe("US-S05: the invitation form signs the shopkeeper in", () => {
  it("submits the password and lands on Cobrar", async () => {
    server.use(
      handlers.acceptInvitation(() => ok({ type: "store", id: "s1", name: "La Esquina" })),
      handlers.session(() => ok(storeActor)),
    );
    const router = renderApp("/invitation/tok-123");

    await userEvent.type(await screen.findByLabelText("Nueva contraseña"), "nueva-clave-1");
    await userEvent.type(screen.getByLabelText("Repite la contraseña"), "nueva-clave-1");
    await userEvent.click(screen.getByRole("button", { name: /guardar y entrar/i }));

    /* landed on Cobrar, signed in */
    expect(await screen.findByPlaceholderText("ID, teléfono o nombre")).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/");
  });

  it("a dead link shows the plain re-send message", async () => {
    server.use(handlers.acceptInvitation(() => failResponse("INVALID_TOKEN", 400)));
    renderApp("/invitation/tok-dead");

    await userEvent.type(await screen.findByLabelText("Nueva contraseña"), "nueva-clave-1");
    await userEvent.type(screen.getByLabelText("Repite la contraseña"), "nueva-clave-1");
    await userEvent.click(screen.getByRole("button", { name: /guardar y entrar/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/invitación nueva/i);
  });
});

describe("D4: the offline banner follows the connection", () => {
  it("appears on offline and leaves on online", async () => {
    server.use(
      handlers.session(() => ok(storeActor)),
      handlers.customerSearch(() => ok({ customers: [] })),
    );
    renderApp("/");
    await screen.findByPlaceholderText("ID, teléfono o nombre");

    act(() => {
      window.dispatchEvent(new Event("offline"));
    });
    expect(await screen.findByRole("status")).toHaveTextContent(/sin conexión/i);

    act(() => {
      window.dispatchEvent(new Event("online"));
    });
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});
