import { useCallback, useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { PaymentPage } from "./features/pago/PaymentPage";
import { RootScreen } from "./features/pago/RootScreen";

/* Two routes, still no router (direct-payment D9 keeps this app small):
   /p/<token> is the payment page, everything else is the bare origin —
   which is a doorway now rather than an error (US-D08 D2). */

const queryClient = new QueryClient();

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
