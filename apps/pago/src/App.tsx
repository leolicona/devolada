import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Alert, Card } from "@devolada/ui";
import { LinkIcon } from "lucide-react";
import { PaymentPage } from "./features/pago/PaymentPage";

/* One page, no router (direct-payment spec D9): the only route is
   /p/<token>. Anything else is an address error, not a navigation. */

const queryClient = new QueryClient();

export function tokenFromPath(pathname: string): string | null {
  return /^\/p\/([^/]+)\/?$/.exec(pathname)?.[1] ?? null;
}

export function App() {
  const token = tokenFromPath(window.location.pathname);
  return (
    <QueryClientProvider client={queryClient}>
      <div className="mx-auto min-h-dvh w-full max-w-md px-4 py-6">
        {token ? (
          <PaymentPage token={token} />
        ) : (
          <Card className="p-6">
            <Alert layout="icon">
              <LinkIcon aria-hidden />
              Este enlace no es válido. Pide a tu proveedor de internet tu link de pago.
            </Alert>
          </Card>
        )}
      </div>
    </QueryClientProvider>
  );
}
