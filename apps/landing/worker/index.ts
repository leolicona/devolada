import { CHANNEL_PATTERN } from "@devolada/api/landing-schema";

/* The script in front of the page (landing-page D3, D4, D12;
   contracts/landing-page.md, "The Worker"). Runs on every request
   (`run_worker_first`), before asset matching:

   1. a `www.` host answers 301 to the same URL without it, path and query
      intact (FR-001) — a domain-level redirect a `_redirects` file cannot
      express (measured 2026-09-19 in the Workers documentation);
   2. the asset comes from the ASSETS binding; when it is HTML and the
      address carries a channel tag that matches the shared charset, every
      hidden `channel` input gets the tag — so the tag reaches the request
      whether or not scripts run (FR-025, D4);
   3. every response carries the security headers and the CSP, with the
      bound API_ORIGIN in connect-src and form-action (FR-027, D12). Headers
      from a `_headers` file are not applied to a Worker's own responses. */

export interface Env {
  ASSETS: Fetcher;
  /* landing-page D12/D14: the API's origin for this environment, a var */
  API_ORIGIN: string;
}

function withHeaders(response: Response, url: URL, env: Env): Response {
  /* A fresh Response: the binding's answer and a redirect both come with
     immutable headers. */
  const res = new Response(response.body, response);
  res.headers.set(
    "Content-Security-Policy",
    [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self'",
      "img-src 'self' data:",
      "font-src 'self'",
      `connect-src 'self' ${env.API_ORIGIN}`,
      `form-action 'self' ${env.API_ORIGIN}`,
      "frame-ancestors 'none'",
      "base-uri 'self'",
    ].join("; "),
  );
  res.headers.set("X-Content-Type-Options", "nosniff");
  res.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  res.headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  /* HSTS only where it means something; under `wrangler dev` on http it
     would pin nothing and confuse a browser. */
  if (url.protocol === "https:") res.headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  return res;
}

/* D4: the tag as typed when it matches; anything else leaves the inputs
   empty and the API records `direct`. */
function channelOf(url: URL): string | null {
  const tag = url.searchParams.get("ch");
  return tag && CHANNEL_PATTERN.test(tag) ? tag : null;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.hostname.startsWith("www.")) {
      url.hostname = url.hostname.slice(4);
      return withHeaders(new Response(null, { status: 301, headers: { Location: url.toString() } }), url, env);
    }

    const asset = await env.ASSETS.fetch(request);
    const tag = channelOf(url);
    const isHtml = (asset.headers.get("content-type") ?? "").includes("text/html");
    const response =
      tag && isHtml
        ? new HTMLRewriter()
            .on('input[name="channel"]', {
              element(el) {
                el.setAttribute("value", tag);
              },
            })
            .transform(asset)
        : asset;
    return withHeaders(response, url, env);
  },
} satisfies ExportedHandler<Env>;
