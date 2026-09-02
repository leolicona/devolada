import { describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import { renderApp } from "./render";

/* docs/auth/better-auth.spec.md UI contract + design-review 2026-09-01
   (must fix): the access screens speak the pivot's voice — the store-era
   pitch ("red de puntos de cobro") left with devolada-red, and "Admin"
   was an identifier, never es-MX copy. */
describe("US-B01: the access screens speak the pivoted product", () => {
  it("login wears the Devolada wordmark and the SPEI-validation subtitle", async () => {
    renderApp("/login");

    expect(await screen.findByText("Devolada")).toBeInTheDocument();
    expect(screen.getByText("Cobra por transferencia con validación automática.")).toBeInTheDocument();
    expect(screen.queryByText(/red de puntos de cobro/)).not.toBeInTheDocument();
    expect(screen.queryByText("Devolada Admin")).not.toBeInTheDocument();
  });
});
