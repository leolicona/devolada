import type { Bindings } from "../env";

/* Client for the Agnostic Auth IdP. Uses the service binding when present
   (production) or plain HTTP against AUTH_BASE_URL (dev). */

/* The real envelope differs from the official guide: `error` is a code
   string and the detail comes in `message` / `details`. */
type Envelope<T> = {
  success: boolean;
  data: T;
  error?: string | { code?: string };
  message?: string;
};

export class AuthError extends Error {
  constructor(
    public code: string,
    public status: number,
    detail?: string,
  ) {
    super(detail ? `${code}: ${detail}` : code);
  }
}

export class AgnosticAuth {
  constructor(private env: Bindings) {}

  private async post<T>(path: string, body: Record<string, unknown>): Promise<T> {
    const init: RequestInit = {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    };
    const res = this.env.AGNOSTIC_AUTH_API
      ? await this.env.AGNOSTIC_AUTH_API.fetch(`http://auth.local${path}`, init)
      : await fetch(`${this.env.AUTH_BASE_URL}${path}`, init);

    const json = (await res.json()) as Envelope<T>;
    if (!res.ok || !json.success) {
      const code =
        (typeof json.error === "string" ? json.error : json.error?.code) ?? `auth ${path} failed`;
      throw new AuthError(code, res.status, json.message);
    }
    return json.data;
  }

  /* Validates credentials against stored hash+salt and issues tokens.
     Real contract (differs from the guide): appId, identity,
     attemptedPassword, storedHash, storedSalt. */
  verifyPassword(identity: string, password: string, hash: string, salt: string) {
    return this.post<{ jwt: string; refreshToken: string }>("/auth/verify-password", {
      appId: this.env.AUTH_APP_ID,
      identity,
      attemptedPassword: password,
      storedHash: hash,
      storedSalt: salt,
    });
  }

  refresh(refreshToken: string) {
    return this.post<{ jwt: string; refreshToken: string }>("/auth/refresh", {
      appId: this.env.AUTH_APP_ID,
      refreshToken,
    });
  }

  revoke(refreshToken: string) {
    return this.post<Record<string, never>>("/auth/token/revoke", {
      appId: this.env.AUTH_APP_ID,
      refreshToken,
    });
  }

  hash(password: string) {
    return this.post<{ hash: string; salt: string }>("/auth/hash", { password });
  }

  /* Magic link: store invitations, email verification, password recovery */
  initiate(identity: string) {
    return this.post<{ token: string; magicLink: string }>("/auth/initiate", {
      appId: this.env.AUTH_APP_ID,
      identity,
    });
  }

  verify(token: string) {
    return this.post<{ jwt: string; refreshToken: string }>("/auth/verify", {
      appId: this.env.AUTH_APP_ID,
      token,
    });
  }
}
