import { describe, expect, it } from "vitest";
import { env, SELF } from "cloudflare:test";

/* landing-page US3 (FR-001, FR-025, FR-027; research D3, D4, D12): the
   Worker in front of the page, in workerd — the one runtime that has
   HTMLRewriter. ASSETS is the stub vitest.config.ts declares, answering
   the fixture page with two forms and one non-HTML path. */

const ORIGIN = "https://devoladapago.com";
const get = (url: string) => SELF.fetch(url, { redirect: "manual" });

describe("landing-page US3: the page travels well", () => {
  it("www answers 301 to the apex with the path and the query intact (D3)", async () => {
    const res = await get("https://www.devoladapago.com/gracias?ch=x&y=1");
    expect(res.status).toBe(301);
    expect(res.headers.get("location")).toBe(`${ORIGIN}/gracias?ch=x&y=1`);
    /* The redirect carries the headers too */
    expect(res.headers.get("content-security-policy")).toContain("default-src 'self'");
  });

  it("a channel tag fills every hidden channel input, as typed (FR-025, D4)", async () => {
    const html = await (await get(`${ORIGIN}/?ch=Grupo-ISP`)).text();
    expect(html.match(/name="channel" value="Grupo-ISP"/g)).toHaveLength(2);
    expect(html).not.toContain('value=""');
  });

  it("a tag outside the charset leaves the inputs untouched; no tag leaves them empty (D4)", async () => {
    for (const bad of ["%3Cscript%3E", "grupo%20isp", "a".repeat(33)]) {
      const html = await (await get(`${ORIGIN}/?ch=${bad}`)).text();
      expect(html.match(/name="channel" value=""/g)).toHaveLength(2);
    }
    const plain = await (await get(`${ORIGIN}/`)).text();
    expect(plain.match(/name="channel" value=""/g)).toHaveLength(2);
  });

  it("a non-HTML asset passes through byte for byte, with the headers (D12)", async () => {
    const res = await get(`${ORIGIN}/robots.txt?ch=Grupo-ISP`);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("User-agent: *\nAllow: /\n");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("every response carries the CSP with the bound API origin, the three headers, and HSTS on https only (FR-027, D12)", async () => {
    const res = await get(`${ORIGIN}/`);
    const csp = res.headers.get("content-security-policy") ?? "";
    expect(csp).toContain(`connect-src 'self' ${env.API_ORIGIN}`);
    expect(csp).toContain(`form-action 'self' ${env.API_ORIGIN}`);
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("script-src 'self'");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("referrer-policy")).toBe("strict-origin-when-cross-origin");
    expect(res.headers.get("permissions-policy")).toBe("camera=(), microphone=(), geolocation=()");
    expect(res.headers.get("strict-transport-security")).toBe("max-age=31536000; includeSubDomains");

    const http = await get("http://localhost:8790/");
    expect(http.headers.get("strict-transport-security")).toBeNull();
    expect(http.headers.get("content-security-policy")).toContain("default-src 'self'");
  });

  it("a path the build did not emit is the binding's own 404 page, with the headers (FR-001, D1)", async () => {
    const res = await get(`${ORIGIN}/nada`);
    expect(res.status).toBe(404);
    expect(res.headers.get("content-security-policy")).toContain("default-src 'self'");
  });
});
