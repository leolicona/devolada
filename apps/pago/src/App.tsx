import { useCallback, useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { PaymentPage } from "./features/pago/PaymentPage";
import { RootScreen } from "./features/pago/RootScreen";

/* Two routes, still no router (direct-payment D9 keeps this app small):
   /p/<token> is the payment page, everything else is the bare origin —
   which is a doorway now rather than an error (US-D08 D2). */

/* One client for the app's whole life, which is one payer on one link.
   Exported so a test can empty it between scenarios: the cache is a
   module-level cache, and a test that starts from a previous test's
   answers is not a test (constitution IV). Leaving it in place made a
   form mount against the *previous* scenario's status and freeze its
   initial values, while the copy above it re-rendered from the fresh
   one — the two disagreed on screen and only the copy was right. */
export const queryClient = new QueryClient();

export function tokenFromPath(pathname: string): string | null {
  return /^\/p\/([^/]+)\/?$/.exec(pathname)?.[1] ?? null;
}

export function App() {
  const [path, setPath] = useState(() => window.location.pathname);

  /* Opening a saved link is a URL change, not a page load: the address
     bar ends on /p/<token>, so a reload or a bookmark still works.
     `replaceState` on purpose — the doorway is not a place to go Back
     to; Back should leave the site. */
  const open = useCallback((to: string) => {
    window.history.replaceState({}, "", to);
    setPath(to);
  }, []);

  const token = tokenFromPath(path);
  return (
    <QueryClientProvider client={queryClient}>
      <div className="mx-auto min-h-dvh w-full max-w-md px-4 py-6">
        {token ? <PaymentPage token={token} /> : <RootScreen onOpen={open} />}
      </div>
    </QueryClientProvider>
  );
}
