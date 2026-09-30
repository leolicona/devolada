import { describe, expect, it } from "vitest";
import { nationalPhone } from "../src/phone";
import { toWhatsAppPhone } from "../src/receipt";

/* payment-without-receipt D2 — what counts as a phone. The payer's
   reference is the last seven digits of a phone only when the digits are
   a Mexican number read with confidence; anything else is no phone, and
   the customer gets an assigned number. The WhatsApp rule is `52` in
   front of the same reading, with the outputs it always had. */

describe("payment-without-receipt US1: nationalPhone (D2)", () => {
  it.each([
    ["5512345678", "5512345678"],
    ["+52 55 1234 5678", "5512345678"],
    ["52 55 1234 5678", "5512345678"],
    ["521 55 1234 5678", "5512345678"],
    ["+521-55-1234-5678", "5512345678"],
    ["55-1234-5678", "5512345678"],
    [" (55) 1234 5678 ", "5512345678"],
  ])("%s reads as ten digits", (raw, expected) => {
    expect(nationalPhone(raw)).toBe(expected);
  });

  it.each([
    ["eight digits", "12345678"],
    ["two numbers in one field", "5512345678 / 5587654321"],
    ["empty", ""],
    ["spaces only", "   "],
    ["null", null],
    ["undefined", undefined],
    ["eleven digits that are not 52…", "15512345678"],
  ])("%s is no phone", (_label, raw) => {
    expect(nationalPhone(raw)).toBeNull();
  });
});

describe("payment-without-receipt US1: toWhatsAppPhone keeps every output (D2)", () => {
  it.each([
    ["5512345678", "525512345678"],
    ["+52 55 1234 5678", "525512345678"],
    ["525512345678", "525512345678"],
    ["5215512345678", "525512345678"],
    ["55 1234 5678", "525512345678"],
    ["12345", null],
    ["", null],
    [null, null],
  ])("%s → %s", (raw, expected) => {
    expect(toWhatsAppPhone(raw)).toBe(expected);
  });
});
