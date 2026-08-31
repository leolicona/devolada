import { describe, expect, it } from "vitest";
import { DEV_API_ORIGIN, resolveApiBase } from "../src/lib/base";

/* US-A01 regression: `/links` and `/settings` are SPA routes as well
   as API paths, so with a
   same-origin base the dev server answered them with index.html and the
   screens showed the load error. */

describe("resolveApiBase", () => {
  it("points at the local worker on the dev server, never same-origin", () => {
    expect(resolveApiBase({ MODE: "development" })).toBe(DEV_API_ORIGIN);
  });

  it("uses the URL the deployed build is given", () => {
    expect(resolveApiBase({ MODE: "production", VITE_API_URL: "https://api.example.com" })).toBe(
      "https://api.example.com",
    );
  });

  it("stays same-origin under test, where the network is mocked on relative paths", () => {
    expect(resolveApiBase({ MODE: "test" })).toBe("");
  });
});
