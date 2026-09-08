import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Alert, Button, Card, Input, Skeleton } from "../src";

/* docs/store-pwa/shell.spec.md scenario 7 (D5, D6).

   These assert the class list, not rendered color: what is under test is
   the merge that decides which utility survives, which happy-dom can
   answer. Contrast still belongs to the Playwright+axe layer
   (docs/legacy/TESTING.md rule 6). */

describe("US-S01: D6 — the login and drop fields keep the size their screen asks for", () => {
  it("keeps the caller's height on Input instead of stacking both", () => {
    render(<Input aria-label="Monto" className="h-14" />);
    const input = screen.getByLabelText("Monto");

    expect(input).toHaveClass("h-14");
    expect(input).not.toHaveClass("h-12");
  });

  it("keeps the caller's padding on Button instead of stacking both", () => {
    render(<Button className="px-0">Cerrar sesión</Button>);
    const button = screen.getByRole("button", { name: "Cerrar sesión" });

    expect(button).toHaveClass("px-0");
    expect(button).not.toHaveClass("px-6");
  });

  it("still applies the atom's own utilities when nothing conflicts", () => {
    render(<Input aria-label="Monto" className="mt-4" />);
    const input = screen.getByLabelText("Monto");

    expect(input).toHaveClass("h-12", "mt-4");
  });
});

describe("US-P01, US-P04: the Alert primitive carries meaning, not just a recipe", () => {
  it("Alert is announced and takes the variant the caller asked for", () => {
    render(<Alert variant="destructive">El monto no puede ser mayor a tu balance.</Alert>);
    const alert = screen.getByRole("alert");

    expect(alert).toHaveTextContent("El monto no puede ser mayor a tu balance.");
    expect(alert).toHaveClass("text-error");
  });

  it("a neutral notice is not announced as an alert", () => {
    /* An empty list is not an emergency: list-states D1 needs "no
       movements yet" to be distinguishable from a failure. */
    render(<Alert>Todavía no tienes movimientos.</Alert>);

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByText("Todavía no tienes movimientos.")).toBeInTheDocument();
  });

  it("a warning is announced politely, not assertively", () => {
    render(<Alert variant="warning">Tu caja se acerca a su límite.</Alert>);

    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("a tappable Card renders as its child, so the link stays a link", () => {
    render(
      <Card asChild>
        <a href="/ledger">Efectivo del ISP en tu poder</a>
      </Card>,
    );
    const link = screen.getByRole("link", { name: "Efectivo del ISP en tu poder" });

    /* The recipe travels onto the anchor: no wrapper div in between */
    expect(link).toHaveClass("rounded-md", "border", "bg-card");
  });

  it("Skeleton is hidden from screen readers so a loading screen is announced once", () => {
    const { container } = render(<Skeleton className="h-4 w-40" />);

    expect(container.firstChild).toHaveAttribute("aria-hidden", "true");
  });
});
