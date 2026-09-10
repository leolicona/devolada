import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { StatusBadge } from "../src";

/* feedback-vocabulary-rollout US4: one name for a size, everywhere.

   The badge was the last component asking for `sm` or `md` while every other
   one named a context. Nothing about it changes except the words — so these
   pin the emitted classes to what `sm` and `md` produced, character for
   character. If a rename quietly resized anything, this is what says so, and
   it says so in the diff rather than in a screenshot nobody opens. */

/* Recorded from the component before the rename. Not derived from it: a test
   that reads today's values and asserts today's values proves nothing. */
const BEFORE = {
  sm: { badge: ["gap-1.5", "px-3", "py-1", "text-sm"], icon: "size-4" },
  md: { badge: ["gap-2", "px-4", "py-1.5", "text-base"], icon: "size-5" },
};

const badge = (container: HTMLElement) => container.firstElementChild as HTMLElement;
const icon = (container: HTMLElement) => container.querySelector("svg") as SVGElement;

describe("feedback-vocabulary-rollout US4: the badge names a context", () => {
  it("compact renders exactly what sm rendered", () => {
    const { container } = render(<StatusBadge status="reconnected" size="compact" />);

    expect(badge(container)).toHaveClass(...BEFORE.sm.badge);
    expect(icon(container)).toHaveClass(BEFORE.sm.icon);
  });

  it("standard renders exactly what md rendered", () => {
    const { container } = render(<StatusBadge status="reconnected" size="standard" />);

    expect(badge(container)).toHaveClass(...BEFORE.md.badge);
    expect(icon(container)).toHaveClass(BEFORE.md.icon);
  });

  it("defaults to compact, because most of the product is the dense back office", () => {
    const { container } = render(<StatusBadge status="reconnected" />);

    expect(badge(container)).toHaveClass(...BEFORE.sm.badge);
  });

  it("still pairs colour with an icon and a word", () => {
    /* The rule the badge exists to enforce, unchanged by this feature: status
       is never colour alone (constitution VI). */
    const { container } = render(<StatusBadge status="failed" size="standard" />);

    expect(screen.getByText("Fallido")).toBeInTheDocument();
    expect(icon(container)).toBeInTheDocument();
    expect(badge(container).className).toMatch(/text-error/);
  });
});
