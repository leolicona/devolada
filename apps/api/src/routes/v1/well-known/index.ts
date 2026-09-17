import { Hono } from "hono";
import type { Bindings, Variables } from "../../../env";
import { getJwks } from "./handler";

/* Pure router (constitution III). Mounted at /.well-known on the app
   root — OUTSIDE /v1, requireApiCredential and the rate limit (research
   D10): the key set is public and carries no business data, and the
   path is the one RFC 8615 gives it. Not the envelope, on purpose: a
   JWKS is a fixed shape every verifier already parses, and wrapping it
   would make every JOSE library's fetcher fail. */
export const wellKnownRoute = new Hono<{ Bindings: Bindings; Variables: Variables }>();

wellKnownRoute.get("/jwks.json", (c) => getJwks(c));
