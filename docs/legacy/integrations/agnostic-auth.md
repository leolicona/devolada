# Agnostic Auth — real contract (RETIRED)

> **Retired 2026-08-15.** Devolada no longer calls this service: sessions
> moved into `apps/api` with Better Auth (`docs/auth/better-auth.spec.md`).
> The service itself keeps running for other projects. This file stays as
> the history of why we left: the signing key lived in the IdP's KV
> (`appConfig.jwtSecret ?? env.JWT_SECRET` — two keys where this file
> documented one), a wrong value broke every session for a day (TD-001),
> its magic links pointed at the registered domain instead of ours, its
> 15-minute tokens killed WhatsApp invitations, and its `verifyToken`
> cannot verify tokens issued for apps with a per-app secret.

Stateless IdP on Cloudflare Workers. **This file documents the contract verified against the real API (2026-08-13), which differs from the official integration guide.** On conflict, this file wins.

- Base (dev, HTTP): `https://agnostic-auth.leolicona-dev.workers.dev`
- Production: service binding `AGNOSTIC_AUTH_API` → `agnostic-auth` worker
- Single client: `apps/api/src/auth/agnostic.ts`. No frontend app talks to the IdP.

## App registration

No endpoint; written directly to KV from `~/software-projects/agnostic-auth/auth-service/`:

```sh
npx wrangler kv key put --binding=APP_REGISTRY --preview false --remote "devolada" \
  '{"appId":"devolada","redirectUrl":"https://tienda.devolada.app","callbackUrl":"https://api.devolada.app/auth/callback","tokenTtlSeconds":900}'
```

The `devolada` app was registered on 2026-08-13.

## Discrepancies vs the official guide (verified)

1. `POST /auth/verify-password` requires:
   ```json
   { "appId": "...", "identity": "...", "attemptedPassword": "...", "storedHash": "...", "storedSalt": "..." }
   ```
   The guide says `{ password, hash, salt }` — it's wrong.
2. Real error envelope: `{ "success": false, "error": "<code string>", "message": "...", "details": {...} }`. The guide shows `error` as an object — it's wrong.
3. Validation errors arrive as `error: "Validation failed"` + per-field `details`.

## Endpoints we use

| Endpoint | Use in Devolada |
|----------|-----------------|
| `POST /auth/hash` `{password}` → `{hash, salt}` | Credential creation (ISP signup, store invitation) |
| `POST /auth/verify-password` (see above) → `{jwt, refreshToken}` | Store login (identity=phone) and admin login (identity=email) |
| `POST /auth/refresh` `{appId, refreshToken}` → `{jwt, refreshToken}` | Middleware transparent refresh |
| `POST /auth/token/revoke` `{appId, refreshToken}` | Logout |
| `POST /auth/initiate` `{appId, identity}` → `{token, magicLink}` | Store invitation, email verification, password recovery |
| `POST /auth/verify` `{appId, token}` → `{jwt, refreshToken}` | Magic-token redemption |

## JWT

- HS256, signed with a secret held by the deployed worker (not readable from outside).
- Verified in `apps/api` with `AUTH_JWT_SECRET`; without it (dev only) decoded without signature verification → TD-001.
- Payload: use `identity ?? sub` as the actor's identity.

## Responsibility split

Agnostic Auth issues and renews tokens; **Devolada decides everything else**: cookies (HTTP-only `gm_access`/`gm_refresh`), per-request actor status in the DB, and which identity maps to a store or an ISP.
