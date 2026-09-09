import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { Pending } from "../src";

/* design-foundations US1: the payer can see the page is still working.

   These assert the attribute and the class list, which happy-dom can answer.
   Whether the cascade actually lets the animation run under reduced motion is
   a browser question and lives in tests/e2e/motion.spec.ts — the class being
   present proves nothing about the computed duration. */

const wrapper = (container: HTMLElement) => container.firstElementChild!;
const TRANSFORM = /\b(scale|translate|rotate|skew)-/;

describe("design-foundations US1: the waiting breath", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("stays still until the flash threshold has passed", () => {
    const { container } = render(
      <Pending active label="Verificando tu transferencia">
        <p>Estamos verificando tu transferencia.</p>
      </Pending>,
    );

    /* The children are the page's content and render at once — only the
       signal waits. */
    expect(screen.getByText("Estamos verificando tu transferencia.")).toBeInTheDocument();

    act(() => void vi.advanceTimersByTime(199));
    expect(wrapper(container)).not.toHaveAttribute("data-motion");
    expect(wrapper(container)).not.toHaveClass("animate-breath");
  });

  it("breathes and says so once the wait is real", () => {
    const { container } = render(
      <Pending active label="Verificando tu transferencia">
        <p>Estamos verificando tu transferencia.</p>
      </Pending>,
    );

    act(() => void vi.advanceTimersByTime(200));

    expect(wrapper(container)).toHaveAttribute("data-motion", "breath");
    expect(wrapper(container)).toHaveClass("animate-breath");
    /* FR-011: the motion is never the only carrier. */
    expect(screen.getByRole("status")).toHaveTextContent("Verificando tu transferencia");
  });

  it("leaves no trace when the process resolves faster than a glance (FR-014)", () => {
    const { container, rerender } = render(
      <Pending active label="Verificando">
        <p>copy</p>
      </Pending>,
    );

    /* The assertion is that it NEVER appears, not that it is gone by the end:
       a signal that flashes on and off inside a fifth of a second has already
       done the harm FR-014 exists to prevent, however tidy the final state. */
    act(() => void vi.advanceTimersByTime(100));
    expect(wrapper(container)).not.toHaveAttribute("data-motion");

    rerender(
      <Pending active={false} label="Verificando">
        <p>copy</p>
      </Pending>,
    );
    act(() => void vi.advanceTimersByTime(5_000));

    expect(wrapper(container)).not.toHaveAttribute("data-motion");
    expect(screen.queryByRole("status")).not.toHaveTextContent("Verificando");
  });

  it("once shown, stays long enough to be read rather than blinking out", () => {
    const { container, rerender } = render(
      <Pending active label="Verificando">
        <p>copy</p>
      </Pending>,
    );

    act(() => void vi.advanceTimersByTime(200));
    rerender(
      <Pending active={false} label="Verificando">
        <p>copy</p>
      </Pending>,
    );

    act(() => void vi.advanceTimersByTime(100));
    expect(wrapper(container)).toHaveAttribute("data-motion", "breath");

    act(() => void vi.advanceTimersByTime(500));
    expect(wrapper(container)).not.toHaveAttribute("data-motion");
  });

  it("is silent and still when idle", () => {
    const { container } = render(
      <Pending active={false} label="Verificando">
        <p>copy</p>
      </Pending>,
    );

    act(() => void vi.advanceTimersByTime(5_000));
    expect(wrapper(container)).not.toHaveAttribute("data-motion");
    expect(wrapper(container)).not.toHaveClass("animate-breath");
  });

  it("hands the announcement back when the caller already owns a live region", () => {
    /* The payer's page wraps this whole card in aria-live="polite". A second
       announcer would read the state out twice. */
    render(
      <Pending active label="Verificando" announce={false}>
        <p>copy</p>
      </Pending>,
    );

    act(() => void vi.advanceTimersByTime(200));
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("never applies a transform, which is what the reduced-motion carve-out rests on", () => {
    const { container } = render(
      <Pending active label="Verificando">
        <p>copy</p>
      </Pending>,
    );

    act(() => void vi.advanceTimersByTime(200));
    expect(wrapper(container).className).not.toMatch(TRANSFORM);
  });
});
