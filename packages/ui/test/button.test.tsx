import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Button } from "../src";

/* design-foundations US3: one button definition, three declared sizes.

   These assert the class list rather than rendered pixels — what is under
   test is which recipe survives the merge, and happy-dom can answer that.
   Real geometry and contrast stay in the browser layer. */

const classes = (name: string | RegExp) => screen.getByRole("button", { name }).className;

describe("design-foundations US3: the merged button", () => {
  it("renders all five variants", () => {
    for (const variant of ["primary", "secondary", "ghost", "destructive", "link"] as const) {
      render(<Button variant={variant}>{variant}</Button>);
      expect(screen.getByRole("button", { name: variant })).toBeInTheDocument();
    }
  });

  it("gives each size the height its name promises", () => {
    render(<Button size="compact">compacto</Button>);
    render(<Button size="standard">estándar</Button>);
    render(<Button size="decisive">decisivo</Button>);

    expect(classes("compacto")).toContain("h-10"); /* 40px, the back office */
    expect(classes("estándar")).toContain("h-12"); /* 48px, a thumb */
    expect(classes("decisivo")).toContain("h-16"); /* 64px, the charge path */
  });

  it("defaults to standard, because a thumb is the harder case", () => {
    render(<Button>sin tamaño</Button>);
    expect(classes("sin tamaño")).toContain("h-12");
  });

  it("keeps decisive full width and its heavier weight", () => {
    render(<Button size="decisive">Ya hice mi transferencia</Button>);
    const cls = classes("Ya hice mi transferencia");
    expect(cls).toContain("w-full");
    /* The base sets font-medium; twMerge must let the size's font-semibold
       win, or the charge path's action quietly loses its weight. */
    expect(cls).toContain("font-semibold");
    expect(cls).not.toContain("font-medium");
  });

  it("drops the box for a link, whatever size it was given", () => {
    render(
      <Button variant="link" size="standard">
        Cerrar sesión
      </Button>,
    );
    const cls = classes("Cerrar sesión");
    expect(cls).toContain("h-auto");
    expect(cls).not.toContain("h-12");
  });

  it("makes disabled a different fill, never a lower opacity (design review D6)", () => {
    /* A washed accent reads as a low-contrast enabled button — worst in dark,
       where the two sat two cards apart and looked the same. */
    for (const variant of ["primary", "secondary", "destructive"] as const) {
      render(
        <Button variant={variant} disabled>
          {`deshabilitado ${variant}`}
        </Button>,
      );
      const cls = classes(`deshabilitado ${variant}`);
      expect(cls, variant).toContain("disabled:bg-well");
      expect(cls, variant).not.toMatch(/disabled:opacity-/);
    }
  });

  it("carries no literal duration: the theme default supplies it", () => {
    render(<Button>Aplicar</Button>);
    const cls = classes("Aplicar");
    expect(cls).toContain("transition-colors");
    expect(cls).not.toMatch(/duration-\d/);
  });

  it("still lets the caller win, rather than stacking both", () => {
    render(
      <Button size="standard" className="h-11">
        a la medida
      </Button>,
    );
    const cls = classes("a la medida");
    expect(cls).toContain("h-11");
    expect(cls).not.toContain("h-12");
  });
});
