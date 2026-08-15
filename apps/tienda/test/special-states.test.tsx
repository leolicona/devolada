import { describe, expect, it } from "vitest";
import { act, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { baOk, fail as failResponse, handlers, ok, server, storeActor } from "./msw";
import { renderApp } from "./render";

/* docs/auth/store-invitation.spec.md scenarios 4–6, updated for
   better-auth.spec.md D8: acceptance also collects the recovery email
   and offers an optional código step. */

async function fillInvitationForm() {
  await userEvent.type(
    await screen.findByLabelText("Correo (para recuperar tu acceso)"),
    "chuy@gmail.com",
  );
  await userEvent.type(screen.getByLabelText("Nueva contraseña"), "nueva-clave-1");
  await userEvent.type(screen.getByLabelText("Repite la contraseña"), "nueva-clave-1");
  await userEvent.click(screen.getByRole("button", { name: /guardar y entrar/i }));
}

describe("US-S05: the invitation form signs the shopkeeper in", () => {
  it("submits email + password, offers the código, and 'Después' lands on Cobrar", async () => {
    server.use(
      handlers.acceptInvitation(() => ok({ type: "store", id: "s1", name: "La Esquina" })),
      handlers.session(() => ok(storeActor)),
    );
    const router = renderApp("/invitation/tok-123");
    await fillInvitationForm();

    /* Signed in already; the código step is optional (D8) */
    expect(await screen.findByText(/te enviamos un código a chuy@gmail.com/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /después/i }));

    expect(await screen.findByPlaceholderText("ID, teléfono o nombre")).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/");
  });

  it("typing the código confirms the email and lands on Cobrar", async () => {
    server.use(
      handlers.acceptInvitation(() => ok({ type: "store", id: "s1", name: "La Esquina" })),
      handlers.verifyEmailCode(() => baOk()),
      handlers.session(() => ok(storeActor)),
    );
    const router = renderApp("/invitation/tok-123");
    await fillInvitationForm();

    await userEvent.type(await screen.findByLabelText("Código"), "123456");
    await userEvent.click(screen.getByRole("button", { name: /confirmar correo/i }));

    expect(await screen.findByPlaceholderText("ID, teléfono o nombre")).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/");
  });

  it("a dead link shows the plain re-send message", async () => {
    server.use(handlers.acceptInvitation(() => failResponse("INVALID_TOKEN", 400)));
    renderApp("/invitation/tok-dead");
    await fillInvitationForm();

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
