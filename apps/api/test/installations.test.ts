import { describe, expect, it } from "vitest";
import { DEFAULT_BASE_URL } from "../src/wisphub/client";
import { installationKey } from "../src/routes/integrations/schema";
import {
  INSTALLATIONS,
  defaultInstallation,
  installationByKey,
  isInstallationKey,
} from "../src/wisphub/installations";

/* provider-address-per-isp US1 — the catalogue's invariants.

   This file is what stands in for a generator (research D2). `banks.ts`
   is generated and CI diffs it because 97 rows arrive from outside; three
   installations are edited by hand, so the guard against drift is these
   assertions rather than `gen-banks --check`. Everything FR-006 asks to
   be "verified automatically so it cannot drift unnoticed" is here. */

const PROVIDER_DOMAINS = ["wisphub.net", "wisphub.io"];

describe("provider-address-per-isp US1: the installation catalogue holds its shape", () => {
  it("has at least the three installations the product knows about", () => {
    expect(INSTALLATIONS.map((i) => i.key)).toEqual(
      expect.arrayContaining(["wisphub_net", "wisphub_io", "wisphub_sandbox"]),
    );
  });

  it("every key is unique — a row stores this string forever (D1)", () => {
    const keys = INSTALLATIONS.map((i) => i.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("every host is https and inside the provider's own domain family", () => {
    for (const installation of INSTALLATIONS) {
      const url = new URL(installation.host);
      expect(url.protocol, `${installation.key} must be https`).toBe("https:");
      /* The point of D1: a catalogue entry is the only thing that can
         name an origin, so an entry pointing anywhere but the provider
         would hand every business on it to a stranger. */
      const inFamily = PROVIDER_DOMAINS.some(
        (domain) => url.hostname === domain || url.hostname.endsWith(`.${domain}`),
      );
      expect(inFamily, `${installation.key} points at ${url.hostname}`).toBe(true);
    }
  });

  it("marks exactly one default — the answer for a row that chose nothing", () => {
    const defaults = INSTALLATIONS.filter((i) => i.isDefault);
    expect(defaults).toHaveLength(1);
    expect(defaultInstallation().key).toBe(defaults[0].key);
    /* The demo tenant lives here, and it is where the adapter has always
       pointed with nothing set. Asserted against the adapter's own
       constant so the two cannot drift apart. */
    expect(defaultInstallation().host).toBe(DEFAULT_BASE_URL);
  });

  it("sets kind on every entry, and marks the sandbox as a test (FR-007)", () => {
    for (const installation of INSTALLATIONS) {
      expect(["real", "test"]).toContain(installation.kind);
      expect(installation.label.trim().length).toBeGreaterThan(0);
    }
    expect(installationByKey("wisphub_sandbox")?.kind).toBe("test");
    /* A test installation can never be the default: a business that
       chose nothing would silently be collecting against a sandbox. */
    expect(defaultInstallation().kind).toBe("real");
  });

  it("resolves a known key and refuses an unknown one (FR-005)", () => {
    expect(installationByKey("wisphub_io")?.host).toBe("https://api.wisphub.io/api");
    expect(installationByKey("wisphub_elsewhere")).toBeUndefined();
    expect(isInstallationKey("wisphub_net")).toBe(true);
    expect(isInstallationKey("https://evil.example/api")).toBe(false);
  });

  it("is frozen — the catalogue changes by deploy, never at runtime (D2)", () => {
    expect(Object.isFrozen(INSTALLATIONS)).toBe(true);
  });

  it("agrees with the wire contract's enum, so the column cannot outrun the panel", () => {
    /* FR-005 is enforced twice: `wisphubPatchRequest` refuses a value
       outside the enum at the validator, and the catalogue refuses to
       resolve one at the adapter. Two lists that drift apart would let a
       key be saved that nothing can call, or offer one the contract
       rejects — so they are asserted equal here, which is this file's
       job as the generator's stand-in (D2). */
    expect([...installationKey.options].sort()).toEqual(INSTALLATIONS.map((i) => i.key).sort());
  });
});
