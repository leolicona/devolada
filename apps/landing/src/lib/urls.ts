/* The two addresses the page points at (landing-page D14;
   contracts/landing-page.md, Build-time inputs).

   The API address is baked at build from PUBLIC_API_URL with the same
   localhost fallback the admin uses. The sign-in link is derived from the
   site host — `app.<host>/login` — so dev and prod each point at their own
   panel without a second variable; under `astro dev` it points at the local
   panel instead. */
export const API_URL = import.meta.env.PUBLIC_API_URL ?? "http://localhost:8787";

export function loginUrlFor(site: string | undefined, dev: boolean): string {
  if (dev || !site) return "http://localhost:5174/login";
  return `https://app.${new URL(site).host}/login`;
}

export const LOGIN_URL = loginUrlFor(import.meta.env.SITE, import.meta.env.DEV);
