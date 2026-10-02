import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { CodeInput } from "../src";
import { expectNoViolations } from "./a11y";

/* passwordless-access US1: a person registers and signs in with a código.

   Every door ends in this field (passwordless-access D12), so what it hands
   the app is the contract: six digits, nothing else, whatever was typed or
   pasted. */

function Controlled({ onValue }: { onValue?: (value: string) => void }) {
  const [code, setCode] = useState("");
  return (
    <CodeInput
      value={code}
      onChange={(next) => {
        onValue?.(next);
        setCode(next);
      }}
    />
  );
}

const field = () => screen.getByLabelText("Código") as HTMLInputElement;

describe("passwordless-access US1: the código field", () => {
  it("is named by its visible label, «Código» unless the screen says otherwise", () => {
    render(<Controlled />);
    expect(field()).toBeInTheDocument();

    render(<CodeInput label="Código de acceso" value="" onChange={() => {}} />);
    expect(screen.getByLabelText("Código de acceso")).toBeInTheDocument();
  });

  it("asks the phone for its digit pad and its one-time-code suggestion", () => {
    render(<Controlled />);
    const input = field();

    expect(input).toHaveAttribute("inputmode", "numeric");
    expect(input).toHaveAttribute("autocomplete", "one-time-code");
    expect(input).toHaveAttribute("maxlength", "6");
    /* "text", not "number": a number field drops a leading zero */
    expect(input).toHaveAttribute("type", "text");
  });

  it("is the standard 48px field, in the mono face, spaced to read digit by digit", () => {
    render(<Controlled />);
    expect(field()).toHaveClass("h-12", "font-mono", "tracking-widest");
  });

  it("hands the app digits only: letters and spaces typed are dropped", () => {
    const onValue = vi.fn();
    render(<Controlled onValue={onValue} />);

    fireEvent.change(field(), { target: { value: "4a8 2-9" } });

    expect(onValue).toHaveBeenLastCalledWith("4829");
    expect(field()).toHaveValue("4829");
  });

  it("cuts what it hands the app to six digits", () => {
    const onValue = vi.fn();
    render(<Controlled onValue={onValue} />);

    fireEvent.change(field(), { target: { value: "48291377" } });

    expect(onValue).toHaveBeenLastCalledWith("482913");
  });

  it("keeps all six digits of a pasted «482 913», which the browser's own cut would not", () => {
    /* The native paste applies maxLength to the seven raw characters before
       anything filters them, and would keep "482 91". */
    const onValue = vi.fn();
    render(<Controlled onValue={onValue} />);

    fireEvent.paste(field(), { clipboardData: { getData: () => "482 913" } });

    expect(onValue).toHaveBeenLastCalledWith("482913");
    expect(field()).toHaveValue("482913");
  });

  it("drops the words around a pasted código", () => {
    const onValue = vi.fn();
    render(<Controlled onValue={onValue} />);

    fireEvent.paste(field(), { clipboardData: { getData: () => "Tu código: 482913." } });

    expect(onValue).toHaveBeenLastCalledWith("482913");
  });

  it("marks the field invalid for assistive technology when the app says so", () => {
    render(<CodeInput value="482913" onChange={() => {}} invalid />);
    expect(field()).toHaveAttribute("aria-invalid", "true");
  });

  it("passes the field's own attributes through", () => {
    render(<CodeInput value="" onChange={() => {}} name="code" id="step-code" disabled size="compact" />);
    const input = field();

    expect(input).toHaveAttribute("name", "code");
    expect(input).toHaveAttribute("id", "step-code");
    expect(input).toBeDisabled();
    expect(input).toHaveClass("h-10");
  });

  it("has no axe violations", async () => {
    const { container } = render(<Controlled />);
    await expectNoViolations(container);
  });
});
