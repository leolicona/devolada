import { useSyncExternalStore } from "react";

/* cash-at-stores D32: the store app on a computer. From the tokens' `lg`
   breakpoint (1024px, where the panel's sidebar appears too) the sections
   move to a side menu and *Cobrar* and *Mi caja* show two halves. The
   frame is CSS (both menus in the page, one shown); this hook is for the
   screens whose tree itself differs — a heading level, a table instead
   of a list, a half beside another — so no hidden copy of a screen sits
   in the page with its own focus and live region. Keep the query equal
   to `--breakpoint-lg` in packages/ui/src/styles/tokens.css. */
export const WIDE_QUERY = "(min-width: 1024px)";

function subscribe(onChange: () => void) {
  const query = window.matchMedia(WIDE_QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

export function useWide(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(WIDE_QUERY).matches,
    () => false,
  );
}
