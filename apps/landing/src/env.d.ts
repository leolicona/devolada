/// <reference types="astro/client" />

interface ImportMetaEnv {
  /* landing-page D14: the API address baked at build; unset → localhost:8787 */
  readonly PUBLIC_API_URL?: string;
}
