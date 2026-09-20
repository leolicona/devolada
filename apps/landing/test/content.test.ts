import { describe, expect, it } from "vitest";
import { CLAIMS, claim } from "../src/content/claims";
import { DOMICILIO, RESPONSABLE } from "../src/content/legal";

/* landing-page US1 (FR-013, FR-014, SC-008; research D11, D20): the test
   that refuses to publish an unreviewed claim or an unnamed responsible
   party. Every claim has a unique id and a non-empty basis; no claim names
   a vendor or carries a figure; the legal identity is not a placeholder. */

describe("landing-page US1: every claim has a basis, and the notice names a person", () => {
  it("every claim has a unique id, a text and a non-empty basis (D11)", () => {
    const ids = CLAIMS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const c of CLAIMS) {
      expect(c.text.trim().length, c.id).toBeGreaterThan(0);
      expect(c.basis.trim().length, `${c.id} has no basis`).toBeGreaterThan(0);
    }
    expect(CLAIMS.length).toBeGreaterThanOrEqual(12);
  });

  it("no claim names a vendor or carries a figure (FR-007, FR-014, D24)", () => {
    for (const c of CLAIMS) {
      expect(c.text, c.id).not.toMatch(/wisphub/i);
      expect(c.text, c.id).not.toMatch(/\$\s?\d|\d+\s?(pesos|MXN|%)/i);
    }
  });

  it("asking for a claim that is not on the list throws at build (D11)", () => {
    expect(claim("pricing-model").text).toContain("Prepago");
    expect(() => claim("free-forever")).toThrow(/no claim/);
  });

  it("the privacy notice names a legal person and an address — no placeholder publishes (D20)", () => {
    expect(RESPONSABLE).not.toMatch(/\{\{/);
    expect(DOMICILIO).not.toMatch(/\{\{/);
    expect(RESPONSABLE.trim().length).toBeGreaterThan(0);
    expect(DOMICILIO.trim().length).toBeGreaterThan(0);
  });
});
