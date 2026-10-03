import { describe, expect, it } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { storeMeResponse } from "@devolada/api/store-schema";
import { expectNoViolations } from "./a11y";
import { baOk, handlers, ok, server } from "./msw";
import { renderApp } from "./render";

/* docs/legacy/auth/better-auth.spec.md UI contract + design-review 2026-09-01
   (must fix): the access screens speak the pivot's voice — the store-era
   pitch ("red de puntos de cobro") left with devolada-red, and "Admin"
   was an identifier, never es-MX copy. */
describe("US-B01: the access screens speak the pivoted product", () => {
  it("login wears the Devolada wordmark and the SPEI-validation subtitle (passwordless-access US2: and asks a código, not a password)", async () => {
    renderApp("/login");

    expect(await screen.findByText("Devolada")).toBeInTheDocument();
    expect(screen.getByText("Cobra por transferencia con validación automática.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Enviar código" })).toBeInTheDocument();
    expect(screen.queryByText(/contraseña/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/red de puntos de cobro/)).not.toBeInTheDocument();
    expect(screen.queryByText("Devolada Admin")).not.toBeInTheDocument();
  });
});

/* cash-at-stores US3 (FR-013, D2): a shopkeeper who signs in to the panel
   meets a screen of its own — never the business wizard — and a way out */
describe("cash-at-stores US3: a store account in the panel", () => {
  it("names the store app and offers Cerrar sesión instead of the business wizard", async () => {
    let signedOut = false;
    server.use(
      handlers.session(() =>
        ok(
          storeMeResponse.parse({
            type: "store",
            storeId: "store-1",
            name: "Abarrotes Lupita",
            businessName: "ISP Demo",
            email: "lupita@correo.mx",
          }),
        ),
      ),
      handlers.logout(() => {
        signedOut = true;
        return baOk();
      }),
    );
    const router = renderApp("/payments");

    expect(await screen.findByRole("heading", { name: "Esta cuenta es de una tienda." })).toBeInTheDocument();
    expect(screen.getByText(/Entra en/)).toHaveTextContent("Entra en red.devoladapago.com.");
    expect(router.state.location.pathname).toBe("/payments");
    expect(screen.queryByRole("heading", { name: /nuevo negocio/i })).not.toBeInTheDocument();
    await expectNoViolations(document.body);

    await userEvent.click(screen.getByRole("button", { name: /cerrar sesión/i }));
    await waitFor(() => expect(signedOut).toBe(true));
    await waitFor(() => expect(router.state.location.pathname).toBe("/login"));
  });
});
