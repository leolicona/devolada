import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { PasskeyOffer, type PasskeyOfferState } from "../src";
import { expectNoViolations } from "./a11y";

/* passwordless-access US1: after a código, the person is offered their
   fingerprint or face for next time (FR-006 to FR-009; research D7, D12).

   Presentational: these drive the state the app would pass and check what
   the step says and lets the person press. The ceremony itself, and the
   platform check that decides whether this step appears at all, belong to
   the apps' tests and the passkey layer. */

const ACTIVATE = "Activar huella o rostro";

function offer(state: PasskeyOfferState, extra: Partial<Parameters<typeof PasskeyOffer>[0]> = {}) {
  const onActivate = vi.fn();
  const onSkip = vi.fn();
  const view = render(
    <PasskeyOffer
      deviceWord="este dispositivo"
      state={state}
      onActivate={onActivate}
      onSkip={onSkip}
      {...extra}
    />,
  );
  return { ...view, onActivate, onSkip };
}

describe("passwordless-access US1: the offer, before anything is pressed", () => {
  it("titles the step and says FR-008's four lines, with the device in them", () => {
    offer("idle");

    expect(
      screen.getByRole("heading", { level: 2, name: "Entra la próxima vez con tu huella o rostro" }),
    ).toBeInTheDocument();
    const lines = screen.getAllByRole("listitem").map((li) => li.textContent);
    expect(lines).toEqual([
      "La próxima vez entras con tu huella o tu rostro, sin escribir nada.",
      "Devolada nunca ve tu huella ni tu rostro: se quedan en tu dispositivo.",
      "Si tu llavero de iCloud o de Google sincroniza tus llaves, también servirá en tus otros dispositivos.",
      "Si otras personas desbloquean este dispositivo, también podrán entrar. En un equipo compartido, elige «Ahora no».",
    ]);
  });

  it("offers the decisive 64px button with the fingerprint, and «Ahora no» beside it", () => {
    offer("idle");

    const activate = screen.getByRole("button", { name: ACTIVATE });
    expect(activate).toHaveClass("h-16");
    expect(activate).toBeEnabled();
    expect(activate.querySelector("svg.lucide-fingerprint")).not.toBeNull();

    const skip = screen.getByRole("button", { name: "Ahora no" });
    expect(skip).toHaveClass("h-12", "w-full");
    expect(skip).toBeEnabled();
  });

  it("is the screen's own h1 where the app asks for one (the store app)", () => {
    offer("idle", { titleAs: "h1" });
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "Entra la próxima vez con tu huella o rostro",
    );
  });

  it("speaks of the phone on a phone, and of the computer on a computer", () => {
    const { unmount } = offer("idle", { deviceWord: "este teléfono" });
    expect(screen.getByText(/se quedan en tu teléfono\.$/)).toBeInTheDocument();
    expect(screen.getByText(/^Si otras personas desbloquean este teléfono,/)).toBeInTheDocument();
    unmount();

    offer("alreadyEnrolled", { deviceWord: "esta computadora" });
    expect(screen.getByText("Esta computadora ya tiene tu huella o rostro.")).toBeInTheDocument();
  });

  it("never names the plumbing in its copy", () => {
    const { container } = offer("failed");
    expect(container.textContent).not.toMatch(/contraseña|passkey|OTP|token|enlace/i);
  });

  it("has no axe violations", async () => {
    const { container } = offer("idle");
    await expectNoViolations(container);
  });
});

describe("passwordless-access US1: pressing it", () => {
  it("starts the ceremony inside the click itself, not after it (research D7)", () => {
    /* Safari refuses a WebAuthn call outside a user gesture. A call made from
       an effect that watches a state the click set would still have run by
       the time fireEvent returns — act() flushes effects — so "was it called"
       proves nothing. What is asserted is WHEN: while the click event is
       still travelling through the document, between the window's capture
       listener and its bubble listener. */
    let dispatching = false;
    const begin = () => void (dispatching = true);
    const end = () => void (dispatching = false);
    window.addEventListener("click", begin, true);
    window.addEventListener("click", end);

    const calls: boolean[] = [];
    try {
      render(
        <PasskeyOffer
          deviceWord="este dispositivo"
          state="idle"
          onActivate={() => calls.push(dispatching)}
          onSkip={() => {}}
        />,
      );
      fireEvent.click(screen.getByRole("button", { name: ACTIVATE }));
    } finally {
      window.removeEventListener("click", begin, true);
      window.removeEventListener("click", end);
    }

    expect(calls).toEqual([true]);
  });

  it("«Ahora no» calls onSkip, and nothing else", () => {
    const { onActivate, onSkip } = offer("idle");
    fireEvent.click(screen.getByRole("button", { name: "Ahora no" }));

    expect(onSkip).toHaveBeenCalledTimes(1);
    expect(onActivate).not.toHaveBeenCalled();
  });
});

describe("passwordless-access US1: each state the app passes", () => {
  afterEach(() => vi.useRealTimers());

  it("busy: waits for the device in words, inside a pending region, with both buttons held", () => {
    vi.useFakeTimers();
    const { onActivate, onSkip } = offer("busy");

    const activate = screen.getByRole("button", { name: "Esperando a tu dispositivo…" });
    expect(activate).toBeDisabled();
    expect(screen.getByRole("button", { name: "Ahora no" })).toBeDisabled();

    /* The waiting label is spoken once the wait is real, by Pending */
    act(() => void vi.advanceTimersByTime(200));
    expect(screen.getByRole("status")).toHaveTextContent("Esperando a tu dispositivo.");
    expect(activate.closest("[data-motion='breath']")).not.toBeNull();

    fireEvent.click(activate);
    fireEvent.click(screen.getByRole("button", { name: "Ahora no" }));
    expect(onActivate).not.toHaveBeenCalled();
    expect(onSkip).not.toHaveBeenCalled();
  });

  it("busy on a phone waits for the phone", () => {
    offer("busy", { deviceWord: "este teléfono" });
    expect(screen.getByRole("button", { name: "Esperando a tu teléfono…" })).toBeDisabled();
  });

  it("failed: says so in one line and leaves both ways forward (FR-009)", async () => {
    const { container } = offer("failed");

    expect(screen.getByRole("alert")).toHaveTextContent(
      "No se pudo activar. Intenta de nuevo o elige «Ahora no».",
    );
    expect(screen.getByRole("button", { name: ACTIVATE })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Ahora no" })).toBeEnabled();
    await expectNoViolations(container);
  });

  it("alreadyEnrolled: the device already has it, which is not a failure", async () => {
    const { container } = offer("alreadyEnrolled");

    expect(screen.getByRole("status")).toHaveTextContent(
      "Este dispositivo ya tiene tu huella o rostro.",
    );
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    await expectNoViolations(container);
  });

  it("done: «Listo.», and nothing left to press while the app moves on", async () => {
    const { container } = offer("done");

    expect(screen.getByRole("status")).toHaveTextContent("Listo.");
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    await expectNoViolations(container);
  });
});
