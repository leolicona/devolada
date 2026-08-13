import type { Bindings } from "../env";

/* Cliente del IdP Agnostic Auth. Usa el service binding si existe
   (producción) o HTTP directo a AUTH_BASE_URL (dev). */

/* El envelope real difiere de la guía: `error` es un string de código
   y el detalle viene en `message` / `details`. */
type Envelope<T> = {
  success: boolean;
  data: T;
  error?: string | { code?: string };
  message?: string;
};

export class ErrorAuth extends Error {
  constructor(
    public codigo: string,
    public status: number,
    detalle?: string,
  ) {
    super(detalle ? `${codigo}: ${detalle}` : codigo);
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
      const codigo =
        (typeof json.error === "string" ? json.error : json.error?.code) ?? `auth ${path} falló`;
      throw new ErrorAuth(codigo, res.status, json.message);
    }
    return json.data;
  }

  /* Valida credenciales contra hash+salt almacenados y emite tokens.
     Contrato real (difiere de la guía): appId, identity, attemptedPassword,
     storedHash, storedSalt. */
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

  /* Magic link: invitaciones de tienda, verificación de correo, recuperación */
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
