import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { env, fetchMock } from "cloudflare:test";
import { sendAuthCode } from "../src/email/sender";
import type { Bindings } from "../src/env";

/* passwordless-access US1 (contracts/codigo-email.md, D13): one email for
   registration and sign-in, the six digits in its subject and its body, the
   ten minutes said, and no link anywhere (FR-024). Resend is met at its
   real origin (constitution IV). */

beforeAll(() => {
  fetchMock.activate();
  fetchMock.disableNetConnect();
});
afterEach(() => fetchMock.assertNoPendingInterceptors());

const withKey = { ...(env as unknown as Bindings), RESEND_API_KEY: "re_test" } as Bindings;

describe("passwordless-access US1 — the código email (D13, FR-024, FR-026)", () => {
  it("the subject and the body carry the six digits, the body says ten minutes, and there is no link", async () => {
    const sent: { to: string; subject: string; html: string }[] = [];
    fetchMock
      .get("https://api.resend.com")
      .intercept({ method: "POST", path: "/emails" })
      .reply(200, (req) => {
        sent.push(JSON.parse(String(req.body)));
        return { id: "e" };
      });

    await sendAuthCode(withKey, "sign-in", "ana@negocio.mx", "482913");

    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe("ana@negocio.mx");
    expect(sent[0].subject).toBe("482913 es tu código para entrar — Devolada");
    expect(sent[0].html).toContain("482913");
    expect(sent[0].html).toContain("Escribe este código en Devolada para entrar:");
    expect(sent[0].html).toContain("Vence en 10 minutos.");
    expect(sent[0].html).toContain("Si no fuiste tú, ignora este mensaje.");
    expect(sent[0].html).not.toMatch(/href|http|<a[\s>]/i);
    /* the word is código: never the plumbing's */
    expect(`${sent[0].subject} ${sent[0].html}`).not.toMatch(/\b(OTP|token|enlace)\b/i);
  });

  it("without RESEND_API_KEY the código is written to the log, exactly as sentCode reads it", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await sendAuthCode(env as unknown as Bindings, "sign-in", "ana@negocio.mx", "482913");
    expect(log).toHaveBeenCalledWith("[código:sign-in] ana@negocio.mx → 482913");
    log.mockRestore();
  });
});
