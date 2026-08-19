import { describe, expect, it } from "vitest";
import { env } from "cloudflare:test";
import { app, seedApiKey } from "./helpers";
import { BANKS } from "../src/provider/banks";

/* docs/consta/validation.spec.md scenario 18 (D12). */

describe("GET /banks", () => {
  it("US-V07: serves the vocabulary to a valid key so a picker is generated, not transcribed", async () => {
    const { key } = await seedApiKey();
    const res = await app.request("/banks", { headers: { Authorization: `Bearer ${key}` } }, env);
    expect(res.status).toBe(200);

    const { data } = (await res.json()) as { data: { banks: string[] } };
    expect(data.banks).toHaveLength(97);
    /* The names a customer would type are not the names apiCEP takes —
       exactly why this endpoint exists. */
    expect(data.banks).toContain("NUBANK");
    expect(data.banks).toContain("BBVA MEXICO");
    expect(data.banks).not.toContain("Nu");
    expect(data.banks).not.toContain("BBVA");
    /* Casing is apiCEP's, not ours to normalise */
    expect(data.banks).toContain("albo");
    expect(data.banks).toEqual([...BANKS]);
  });

  it("US-V07: without a key it 401s like every other route (D8)", async () => {
    const res = await app.request("/banks", {}, env);
    expect(res.status).toBe(401);
  });
});
