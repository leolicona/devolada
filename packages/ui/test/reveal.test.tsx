import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Reveal } from "../src";

/* design-foundations US1: the outcome arrives calmly, and the same way
   whether the news is good or bad (FR-012). */

const wrapper = (container: HTMLElement) => container.firstElementChild!;
const TRANSFORM = /\b(scale|translate|rotate|skew)-/;

describe("design-foundations US1: the outcome cross-fade", () => {
  it("renders the outcome and marks it for the cross-fade", () => {
    const { container } = render(<Reveal>Tu pago quedó confirmado.</Reveal>);

    expect(screen.getByText("Tu pago quedó confirmado.")).toBeInTheDocument();
    expect(wrapper(container)).toHaveAttribute("data-motion", "reveal");
    expect(wrapper(container)).toHaveClass("animate-reveal");
  });

  it("treats a refusal exactly like a confirmation", () => {
    const { container: good } = render(<Reveal>Tu pago quedó confirmado.</Reveal>);
    const { container: bad } = render(<Reveal>No pudimos verificar tu transferencia.</Reveal>);

    /* Tone belongs to colour and words. If the motion differed at all, it
       would be the animation editorialising about someone's money. */
    expect(wrapper(bad).className).toBe(wrapper(good).className);
    expect(wrapper(bad).getAttribute("data-motion")).toBe(
      wrapper(good).getAttribute("data-motion"),
    );
  });

  it("never applies a transform: it fades, it does not move", () => {
    const { container } = render(<Reveal>Tu pago quedó confirmado.</Reveal>);
    expect(wrapper(container).className).not.toMatch(TRANSFORM);
  });
});
