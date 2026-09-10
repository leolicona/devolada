import { describe, expect, it } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ListError } from "../src";

/* feedback-vocabulary-rollout US3: a retry looks like a first attempt.

   The prop these replace was `retrying`, and every one of the eight call sites
   passed TanStack's `isRefetching`. That is true when an errored query
   refetches on window focus, so an operator who switched tabs and came back
   saw "Cargando…" with nothing running. The waiting state is derived from the
   click now, and there is no prop left to get wrong. */

const deferred = () => {
  let resolve!: () => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

describe("feedback-vocabulary-rollout US3: the retry waits on the click", () => {
  it("is idle until the operator asks, however the list got here", () => {
    render(<ListError what="los cobros" onRetry={() => {}} />);

    const button = screen.getByRole("button", { name: /reintentar/i });
    expect(button).toBeEnabled();
    /* Nothing in this component can be told it is waiting from outside. That
       is the point: a refetch nobody started cannot reach it. */
    expect(screen.queryByText(/cargando/i)).not.toBeInTheDocument();
  });

  it("waits from the click until the promise settles", async () => {
    const d = deferred();
    render(<ListError what="los cobros" onRetry={() => d.promise} />);

    fireEvent.click(screen.getByRole("button", { name: /reintentar/i }));
    await waitFor(() => expect(screen.getByRole("button")).toBeDisabled());
    const button = screen.getByRole("button");
    expect(button).toBeDisabled();
    expect(button).toHaveTextContent(/cargando/i);

    d.resolve();
    await waitFor(() => expect(screen.getByRole("button")).toHaveTextContent(/reintentar/i));
    expect(screen.getByRole("button")).toBeEnabled();
  });

  it("does not stay stuck when the retry fails too", async () => {
    const d = deferred();
    render(<ListError what="los cobros" onRetry={() => d.promise} />);

    fireEvent.click(screen.getByRole("button", { name: /reintentar/i }));
    await waitFor(() => expect(screen.getByRole("button")).toBeDisabled());
    expect(screen.getByRole("button")).toBeDisabled();

    d.reject(new Error("still down"));
    /* A failure that leaves the button disabled forever is worse than the
       failure: the operator can no longer try. */
    await waitFor(() => expect(screen.getByRole("button")).toBeEnabled());
    expect(screen.getByRole("button")).toHaveTextContent(/reintentar/i);
  });

  it("breathes while it waits, like every other started action", async () => {
    const d = deferred();
    const { container } = render(<ListError what="los cobros" onRetry={() => d.promise} />);

    fireEvent.click(screen.getByRole("button", { name: /reintentar/i }));
    await waitFor(() => expect(screen.getByRole("button")).toBeDisabled());
    await waitFor(() =>
      expect(container.querySelector('[data-motion="breath"]')).toBeInTheDocument(),
    );
    d.resolve();
  });

  it("never rotates anything, waiting or not (SC-013)", async () => {
    const d = deferred();
    const { container } = render(<ListError what="los cobros" onRetry={() => d.promise} />);

    expect(container.innerHTML).not.toMatch(/animate-spin/);
    fireEvent.click(screen.getByRole("button", { name: /reintentar/i }));
    await waitFor(() => expect(screen.getByRole("button")).toBeDisabled());
    /* The state that used to carry the spinner. Asserting only the idle state
       would pass with the spinner fully intact. */
    await waitFor(() => expect(screen.getByRole("button")).toBeDisabled());
    expect(container.innerHTML).not.toMatch(/animate-spin/);
    d.resolve();
  });

  it("does not announce over the alert it sits inside (D4)", async () => {
    const d = deferred();
    render(<ListError what="los cobros" onRetry={() => d.promise} />);

    fireEvent.click(screen.getByRole("button", { name: /reintentar/i }));
    await waitFor(() => expect(screen.getByRole("button")).toBeDisabled());
    await waitFor(() => expect(screen.getByRole("button")).toBeDisabled());

    /* The Alert is role="alert", an assertive live region, so the button's own
       word changing is already announced. A polite status nested inside would
       read the same state twice. */
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    d.resolve();
  });
});
