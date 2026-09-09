import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Field, Input } from "../src";

/* design-foundations US3: one field definition, two declared sizes. */

describe("design-foundations US3: the merged field", () => {
  it("gives each size the height its name promises", () => {
    render(<Input aria-label="estándar" />);
    render(<Input aria-label="compacto" size="compact" />);

    expect(screen.getByLabelText("estándar")).toHaveClass("h-12");
    expect(screen.getByLabelText("compacto")).toHaveClass("h-10");
  });

  it("keeps the deliberately darker edge at both sizes (WCAG 1.4.11)", () => {
    /* border-line-input, not border-line: a field must be findable. The merge
       is exactly where a rule like this gets lost. */
    render(<Input aria-label="estándar" />);
    render(<Input aria-label="compacto" size="compact" />);

    expect(screen.getByLabelText("estándar")).toHaveClass("border-line-input");
    expect(screen.getByLabelText("compacto")).toHaveClass("border-line-input");
  });

  it("moves the leading icon's gap with the size", () => {
    const Icon = ({ className }: { className?: string }) => <svg className={className} />;
    render(<Input aria-label="buscar" icon={Icon} />);
    render(<Input aria-label="buscar compacto" icon={Icon} size="compact" />);

    /* A gap that did not shrink with the field would put the text on top of
       the icon at 40px. */
    expect(screen.getByLabelText("buscar")).toHaveClass("pl-12");
    expect(screen.getByLabelText("buscar compacto")).toHaveClass("pl-9");
  });

  it("fades disabled text rather than washing the whole control", () => {
    render(<Input aria-label="monto" disabled size="compact" />);
    const field = screen.getByLabelText("monto");
    expect(field).toHaveClass("disabled:text-ink-faint");
    expect(field.className).not.toMatch(/disabled:opacity-/);
  });

  it("keeps the Field label wired to the control at either size", () => {
    render(
      <Field label="Clave de rastreo">
        <Input size="compact" />
      </Field>,
    );
    /* getByLabelText only resolves when htmlFor and id actually match. */
    expect(screen.getByLabelText("Clave de rastreo")).toHaveClass("h-10");
  });

  it("does not let the money sign become the field's name (design review D8)", () => {
    render(
      <Field label="Monto">
        <Input prefix="$" />
      </Field>,
    );
    expect(screen.getByLabelText("Monto")).toBeInTheDocument();
  });
});
