import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { KeysCard, type KeysCardKey, type KeysCardProps, type KeysCardStepUp } from "../src";
import { expectNoViolations } from "./a11y";

/* passwordless-access US5: the person manages their keys and sessions from
   Cuenta → Seguridad, and the store app's Caja (FR-020 to FR-022; research
   D8, D11, D12).

   Presentational: each case passes the state the app would hold and checks
   what the card shows and which callback a press reaches. The requests
   themselves are the apps' tests. */

/* Noon UTC, so the calendar day is the same in every timezone a developer
   runs this from; October, because its short form is "oct" in every ICU
   build (September reads "sep" or "sept" depending on the build). */
const ACTIVATED = "2026-10-02T12:00:00.000Z";

const KEYS: KeysCardKey[] = [
  { id: "k1", name: "MacBook de Ana", createdAt: ACTIVATED, backedUp: true },
  { id: "k2", name: null, createdAt: new Date(ACTIVATED), backedUp: false },
  { id: "k3", name: "   ", createdAt: null, backedUp: null },
];

function card(props: Partial<KeysCardProps> = {}) {
  const callbacks = {
    onActivate: vi.fn(),
    onRemove: vi.fn(),
    onSignOutOthers: vi.fn(),
  };
  const all: KeysCardProps = {
    keys: KEYS,
    loading: false,
    deviceWord: "este dispositivo",
    canActivate: true,
    activation: "idle",
    stepUp: null,
    signOutOthers: "idle",
    ...callbacks,
    ...props,
  };
  const view = render(<KeysCard {...all} />);
  return { ...view, ...callbacks, rerenderWith: (next: Partial<KeysCardProps>) => view.rerender(<KeysCard {...all} {...next} />) };
}

function stepUp(over: Partial<KeysCardStepUp> = {}): KeysCardStepUp {
  return {
    email: "ana@negocio.mx",
    code: "",
    onCodeChange: vi.fn(),
    onSubmit: vi.fn(),
    onCancel: vi.fn(),
    busy: false,
    error: null,
    ...over,
  };
}

const ACTIVATE = "Activar en este dispositivo";
const SIGN_OUT_OTHERS = "Cerrar sesión en los demás dispositivos";

describe("passwordless-access US5: the card says what it is for", () => {
  it("titles itself and explains the synced case, naming the device", () => {
    card();

    expect(
      screen.getByRole("heading", { level: 2, name: "Entrar con huella o rostro" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Activa el acceso con la huella o el rostro de este dispositivo. Si tu llavero de iCloud o de Google sincroniza tus llaves, también servirá en tus otros dispositivos.",
      ),
    ).toBeInTheDocument();
  });

  it("takes the app's own title and description where it has them", () => {
    card({ title: "Tus llaves", description: "Las llaves de esta tienda." });

    expect(screen.getByRole("heading", { name: "Tus llaves" })).toBeInTheDocument();
    expect(screen.getByText("Las llaves de esta tienda.")).toBeInTheDocument();
  });

  it("never mentions a password, in any state (FR-030)", () => {
    const states: Partial<KeysCardProps>[] = [
      {},
      { keys: [], activation: "failed", removeFailed: true },
      { activation: "done", signOutOthers: "done" },
      { stepUp: stepUp({ error: "invalid" }) },
      { stepUp: stepUp({ error: "tooMany", busy: true }), signOutOthers: "busy" },
    ];
    for (const state of states) {
      const { container, unmount } = card(state);
      /* innerHTML, not textContent: an aria-label is copy too */
      expect(container.innerHTML).not.toMatch(/contraseña/i);
      expect(container.textContent).not.toMatch(/passkey|OTP|token|enlace/i);
      unmount();
    }
  });
});

describe("passwordless-access US5: the keys", () => {
  afterEach(() => vi.useRealTimers());

  it("lists each key by name, or as «Llave de acceso» when it has none", () => {
    card();

    const list = screen.getByRole("list", { name: "Dispositivos con acceso" });
    const rows = within(list).getAllByRole("listitem");
    expect(rows).toHaveLength(3);
    expect(rows[0]).toHaveTextContent("MacBook de Ana");
    /* null and a blank name read the same */
    expect(rows[1]).toHaveTextContent(/^Llave de acceso/);
    expect(rows[2]).toHaveTextContent(/^Llave de acceso/);
  });

  it("says when each key was activated, and whether the keychain carries it", () => {
    card();
    const rows = within(screen.getByRole("list", { name: "Dispositivos con acceso" })).getAllByRole(
      "listitem",
    );

    expect(within(rows[0]).getByText("Activada el 2 oct 2026 · sincronizada con tu llavero")).toBeInTheDocument();
    expect(within(rows[1]).getByText("Activada el 2 oct 2026")).toBeInTheDocument();
    /* No date and not synced: no detail line at all, rather than an empty one */
    expect(rows[2]).not.toHaveTextContent(/Activada|sincronizada/);
  });

  it("gives every «Quitar» the name and date of its key, and hands the app that key's id", () => {
    const { onRemove } = card();

    const named = screen.getByRole("button", { name: "Quitar MacBook de Ana, activada el 2 oct 2026" });
    expect(named).toHaveTextContent("Quitar");
    /* two unnamed keys are told apart by their date, or by its absence (the design canvas) */
    const dated = screen.getByRole("button", { name: "Quitar llave de acceso, activada el 2 oct 2026" });
    const undated = screen.getByRole("button", { name: "Quitar llave de acceso" });

    fireEvent.click(named);
    fireEvent.click(dated);
    fireEvent.click(undated);
    expect(onRemove.mock.calls).toEqual([["k1"], ["k2"], ["k3"]]);
  });

  it("says so when a key could not be removed", () => {
    card({ removeFailed: true });
    expect(screen.getByRole("alert")).toHaveTextContent("No pudimos quitar esa llave. Intenta de nuevo.");
  });

  it("says plainly when no device has a key yet", async () => {
    const { container } = card({ keys: [] });

    expect(
      screen.getByText("Ningún dispositivo tiene acceso con huella o rostro todavía."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
    await expectNoViolations(container);
  });

  it("promises the list's shape while it loads, and says so in words", () => {
    vi.useFakeTimers();
    card({ loading: true, keys: undefined });

    act(() => void vi.advanceTimersByTime(200));
    expect(screen.getByRole("status")).toHaveTextContent("Cargando tus dispositivos");
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
    expect(screen.queryByText(/Ningún dispositivo/)).not.toBeInTheDocument();
  });

  it("has no axe violations with keys listed", async () => {
    const { container } = card();
    await expectNoViolations(container);
  });
});

describe("passwordless-access US5: activating this device", () => {
  afterEach(() => vi.useRealTimers());

  it("is offered only where the device can verify the person (research D7)", () => {
    const { rerenderWith } = card({ canActivate: false });
    expect(screen.queryByRole("button", { name: ACTIVATE })).not.toBeInTheDocument();

    rerenderWith({ canActivate: true });
    expect(screen.getByRole("button", { name: ACTIVATE })).toBeEnabled();
  });

  it("starts the ceremony inside the click itself (research D7)", () => {
    /* See passkey-offer.test.tsx: asserted is WHEN the call happens — while
       the click is still travelling through the document — because act()
       would flush an effect-based call before fireEvent returns. */
    let dispatching = false;
    const begin = () => void (dispatching = true);
    const end = () => void (dispatching = false);
    window.addEventListener("click", begin, true);
    window.addEventListener("click", end);

    const calls: boolean[] = [];
    try {
      card({ onActivate: () => calls.push(dispatching) });
      fireEvent.click(screen.getByRole("button", { name: ACTIVATE }));
    } finally {
      window.removeEventListener("click", begin, true);
      window.removeEventListener("click", end);
    }

    expect(calls).toEqual([true]);
  });

  it("waits for the device in words, inside a pending region", () => {
    vi.useFakeTimers();
    card({ activation: "busy" });

    expect(screen.getByRole("button", { name: "Esperando a tu dispositivo…" })).toBeDisabled();
    act(() => void vi.advanceTimersByTime(200));
    expect(screen.getByRole("status")).toHaveTextContent("Esperando a tu dispositivo.");
  });

  it("failed: one line, the button still there to try again, nothing to fall back on", () => {
    card({ activation: "failed" });

    expect(screen.getByRole("alert")).toHaveTextContent("No se pudo activar. Intenta de nuevo.");
    expect(screen.getByRole("button", { name: ACTIVATE })).toBeEnabled();
  });

  it("done: the confirmation takes the button's place", async () => {
    const { container } = card({ activation: "done" });

    expect(
      screen.getByText("Listo. Este dispositivo ya puede entrar con huella o rostro."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: ACTIVATE })).not.toBeInTheDocument();
    await expectNoViolations(container);
  });

  it("speaks of the phone in the store app", () => {
    const { rerenderWith } = card({ deviceWord: "este teléfono" });
    expect(screen.getByRole("button", { name: "Activar en este teléfono" })).toBeInTheDocument();

    rerenderWith({ deviceWord: "este teléfono", activation: "busy" });
    expect(screen.getByRole("button", { name: "Esperando a tu teléfono…" })).toBeDisabled();

    rerenderWith({ deviceWord: "este teléfono", activation: "done", signOutOthers: "done" });
    expect(screen.getByText("Listo. Este teléfono ya puede entrar con huella o rostro.")).toBeInTheDocument();
    expect(screen.getByText("Listo. Solo este teléfono sigue con tu sesión abierta.")).toBeInTheDocument();
  });
});

describe("passwordless-access US5: the step-up, when the session is older than a day (research D8)", () => {
  afterEach(() => vi.useRealTimers());

  it("says where the código went, and replaces the activate button", () => {
    card({ stepUp: stepUp() });

    expect(
      screen.getByText("Confirma que eres tú: te enviamos un código a ana@negocio.mx."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: ACTIVATE })).not.toBeInTheDocument();
    expect(screen.getByLabelText("Código")).toHaveAttribute("autocomplete", "one-time-code");
  });

  it("puts the person in the código field, since the button they pressed is gone", () => {
    card({ stepUp: stepUp() });
    expect(screen.getByLabelText("Código")).toHaveFocus();
  });

  it("hands the app the digits typed", () => {
    const step = stepUp();
    card({ stepUp: step });

    fireEvent.change(screen.getByLabelText("Código"), { target: { value: "48 29a" } });
    expect(step.onCodeChange).toHaveBeenLastCalledWith("4829");
  });

  it("enables «Confirmar» only with six digits, and only then submits", () => {
    const short = stepUp({ code: "48291" });
    const { rerenderWith } = card({ stepUp: short });

    expect(screen.getByRole("button", { name: "Confirmar" })).toBeDisabled();
    /* Enter in the field submits the form: it must not reach the app either */
    fireEvent.submit(screen.getByLabelText("Código").closest("form")!);
    expect(short.onSubmit).not.toHaveBeenCalled();

    const full = stepUp({ code: "482913" });
    rerenderWith({ stepUp: full });
    const confirm = screen.getByRole("button", { name: "Confirmar" });
    expect(confirm).toBeEnabled();
    fireEvent.click(confirm);
    expect(full.onSubmit).toHaveBeenCalledTimes(1);
  });

  it("«Cancelar» closes the step-up", () => {
    const step = stepUp({ code: "482913" });
    card({ stepUp: step });

    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(step.onCancel).toHaveBeenCalledTimes(1);
    expect(step.onSubmit).not.toHaveBeenCalled();
  });

  it("confirms inside a pending region, holding both buttons and the field", () => {
    vi.useFakeTimers();
    card({ stepUp: stepUp({ code: "482913", busy: true }) });

    expect(screen.getByRole("button", { name: "Confirmando…" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancelar" })).toBeDisabled();
    expect(screen.getByLabelText("Código")).toBeDisabled();
    act(() => void vi.advanceTimersByTime(200));
    expect(screen.getByRole("status")).toHaveTextContent("Confirmando el código.");
  });

  it("a wrong or expired código: says so, and marks the field", async () => {
    const { container } = card({ stepUp: stepUp({ code: "482913", error: "invalid" }) });

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent(
      "El código no es válido o ya venció. Pide uno nuevo.",
    );
    const field = screen.getByLabelText("Código");
    expect(field).toHaveAttribute("aria-invalid", "true");
    expect(field).toHaveAttribute("aria-describedby", alert.id);
    await expectNoViolations(container);
  });

  it("too many tries: says to wait (FR-027)", () => {
    card({ stepUp: stepUp({ error: "tooMany" }) });

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Demasiados intentos. Espera un momento e intenta de nuevo.",
    );
    /* The código itself was not judged: the field is not marked wrong */
    expect(screen.getByLabelText("Código")).not.toHaveAttribute("aria-invalid");
  });

  it("has no axe violations", async () => {
    const { container } = card({ stepUp: stepUp({ code: "4829" }) });
    await expectNoViolations(container);
  });
});

describe("passwordless-access US5: signing out the other devices (research D11)", () => {
  afterEach(() => vi.useRealTimers());

  it("is a secondary button below the keys, separated from them", () => {
    const { onSignOutOthers } = card();

    const button = screen.getByRole("button", { name: SIGN_OUT_OTHERS });
    expect(button).toHaveClass("border-line", "bg-card");
    expect(button.closest(".border-t")).not.toBeNull();

    fireEvent.click(button);
    expect(onSignOutOthers).toHaveBeenCalledTimes(1);
  });

  it("is there even where this device cannot hold a key", () => {
    card({ canActivate: false, keys: [] });
    expect(screen.getByRole("button", { name: SIGN_OUT_OTHERS })).toBeInTheDocument();
  });

  it("closes the other sessions inside a pending region", () => {
    vi.useFakeTimers();
    card({ signOutOthers: "busy" });

    expect(screen.getByRole("button", { name: "Cerrando sesiones…" })).toBeDisabled();
    act(() => void vi.advanceTimersByTime(200));
    expect(screen.getByRole("status")).toHaveTextContent("Cerrando las demás sesiones.");
  });

  it("done: one line saying only this device is still signed in", async () => {
    const { container } = card({ signOutOthers: "done" });

    expect(screen.getByRole("status")).toHaveTextContent(
      "Listo. Solo este dispositivo sigue con tu sesión abierta.",
    );
    expect(screen.queryByRole("button", { name: SIGN_OUT_OTHERS })).not.toBeInTheDocument();
    await expectNoViolations(container);
  });
});

describe("passwordless-access US5: the two declared sizes (constitution VI)", () => {
  it("is compact in the panel, where a pointer aims", () => {
    card({ stepUp: stepUp() });

    expect(screen.getByRole("button", { name: /^Quitar MacBook de Ana/ })).toHaveClass("h-10");
    expect(screen.getByRole("button", { name: "Confirmar" })).toHaveClass("h-10");
    expect(screen.getByLabelText("Código")).toHaveClass("h-10");
    /* The long label wraps rather than clips at 360px, never below 40px */
    expect(screen.getByRole("button", { name: SIGN_OUT_OTHERS })).toHaveClass("min-h-10", "h-auto");
  });

  it("is standard and full width in the store app, where a thumb aims", () => {
    card({ size: "standard" });

    expect(screen.getByRole("button", { name: /^Quitar MacBook de Ana/ })).toHaveClass("h-12");
    expect(screen.getByRole("button", { name: ACTIVATE })).toHaveClass("min-h-12", "w-full");
    expect(screen.getByRole("button", { name: SIGN_OUT_OTHERS })).toHaveClass("min-h-12", "w-full");
  });

  it("gives the store app's step-up a 48px field and full-width buttons", () => {
    card({ size: "standard", stepUp: stepUp({ code: "482913" }) });

    expect(screen.getByLabelText("Código")).toHaveClass("h-12");
    expect(screen.getByRole("button", { name: "Confirmar" })).toHaveClass("h-12", "w-full");
    expect(screen.getByRole("button", { name: "Cancelar" })).toHaveClass("h-12", "w-full");
  });
});
