import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { Pending, Skeleton } from "../src";

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
    /* Stronger than "the region is empty": once the wait is over the region is
       gone, so a screen that owns a status of its own is never competing with
       an idle one (feedback-vocabulary-rollout D4). */
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
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

/* feedback-vocabulary-rollout US1: a region whose content has a known shape.

   What these can answer: which element is rendered, when, and with which
   class. What they CANNOT answer is the one FR-015 cares most about — that
   the space is really held and the page does not jump. happy-dom reports no
   layout, so `invisible` and `hidden` look identical to it. That assertion
   lives in tests/e2e/feedback.spec.ts, and the test below only pins the
   mechanism the browser test then measures. */
describe("feedback-vocabulary-rollout US1: the promised shape", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const shape = <div data-testid="bars">bars</div>;

  it("keeps the shape unpainted, and silent, until the threshold has passed", () => {
    render(
      <Pending active label="Cargando los cobros" shape={shape}>
        <p>rows</p>
      </Pending>,
    );

    act(() => void vi.advanceTimersByTime(199));

    /* Present, so it occupies its box; invisible, so it paints nothing. */
    const held = screen.getByTestId("bars").parentElement!;
    expect(held).toHaveClass("invisible");
    expect(held).toHaveAttribute("aria-hidden", "true");
    expect(screen.getByRole("status")).toHaveTextContent("");
  });

  it("replaces the children rather than sitting beside them (FR-003)", () => {
    render(
      <Pending active label="Cargando los cobros" shape={shape}>
        <p>rows</p>
      </Pending>,
    );

    act(() => void vi.advanceTimersByTime(200));
    expect(screen.getByTestId("bars")).toBeInTheDocument();
    expect(screen.queryByText("rows")).not.toBeInTheDocument();
  });

  it("paints, breathes and speaks on one schedule", () => {
    const { container } = render(
      <Pending active label="Cargando los cobros" shape={shape}>
        <p>rows</p>
      </Pending>,
    );

    act(() => void vi.advanceTimersByTime(200));

    expect(screen.getByTestId("bars").parentElement).not.toHaveClass("invisible");
    expect(wrapper(container)).toHaveAttribute("data-motion", "breath");
    expect(screen.getByRole("status")).toHaveTextContent("Cargando los cobros");
  });

  it("carries no movement of its own — the region breathes, the shape does not", () => {
    const { container } = render(
      <Pending active label="Cargando" shape={<Skeleton className="h-4 w-40" />}>
        <p>rows</p>
      </Pending>,
    );

    act(() => void vi.advanceTimersByTime(200));

    /* One animation for the region (D6). Six bars animating separately would
       drift out of phase the moment one mounted a frame late. */
    expect(wrapper(container)).toHaveClass("animate-breath");
    expect(container.querySelectorAll("[class*='animate-']")).toHaveLength(1);
  });

  it("shows nothing at all when the load beats the threshold (SC-014)", () => {
    const { rerender } = render(
      <Pending active label="Cargando" shape={shape}>
        <p>rows</p>
      </Pending>,
    );

    act(() => void vi.advanceTimersByTime(100));
    expect(screen.getByTestId("bars").parentElement).toHaveClass("invisible");

    rerender(
      <Pending active={false} label="Cargando" shape={shape}>
        <p>rows</p>
      </Pending>,
    );
    act(() => void vi.advanceTimersByTime(5_000));

    /* The shape was never painted and the content is simply there. */
    expect(screen.queryByTestId("bars")).not.toBeInTheDocument();
    expect(screen.getByText("rows")).toBeInTheDocument();
  });

  it("holds the shape while the signal is still being read", () => {
    const { rerender } = render(
      <Pending active label="Cargando" shape={shape}>
        <p>rows</p>
      </Pending>,
    );

    act(() => void vi.advanceTimersByTime(200));
    rerender(
      <Pending active={false} label="Cargando" shape={shape}>
        <p>rows</p>
      </Pending>,
    );

    /* Still holding: swapping to the content here would be the blink the
       minimum-visible window exists to prevent. */
    act(() => void vi.advanceTimersByTime(100));
    expect(screen.getByTestId("bars")).toBeInTheDocument();

    act(() => void vi.advanceTimersByTime(500));
    expect(screen.getByText("rows")).toBeInTheDocument();
  });

  it("is the children's region again once idle", () => {
    render(
      <Pending active={false} label="Cargando" shape={shape}>
        <p>rows</p>
      </Pending>,
    );

    act(() => void vi.advanceTimersByTime(5_000));
    expect(screen.getByText("rows")).toBeInTheDocument();
    expect(screen.queryByTestId("bars")).not.toBeInTheDocument();
  });
});
