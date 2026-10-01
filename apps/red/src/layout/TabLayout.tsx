import { useEffect, useState } from "react";
import { Link, Navigate, Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { HandCoins, ListOrdered, WifiOff, Wallet } from "lucide-react";
import { Pending, Skeleton } from "@devolada/ui";
import { STORE_SUSPENDED_EVENT } from "@/lib/api";
import { useSession } from "@/features/auth/session";
import { SuspendedScreen, WrongAccountScreen } from "@/features/auth/Gate";

/* cash-at-stores D26: three tabs — *Cobrar*, *Caja*, *Movimientos* — at
   the bottom, where a thumb reaches, each 64px (the decisive size: a tab
   is how the shopkeeper moves between the counter and the drawer).
   Signing out and the passkey live in *Caja* (`cashbox` D3). */

const TABS = [
  { to: "/", label: "Cobrar", icon: HandCoins, match: (p: string) => p === "/" || p.startsWith("/cobro") },
  { to: "/caja", label: "Caja", icon: Wallet, match: (p: string) => p.startsWith("/caja") },
  { to: "/movimientos", label: "Movimientos", icon: ListOrdered, match: (p: string) => p.startsWith("/movimientos") },
] as const;

/* D26: no service worker and no offline work — a collection needs the
   debt live — but a lost signal is said, never shown as a frozen screen */
function useOnline() {
  const [online, setOnline] = useState(() => (typeof navigator === "undefined" ? true : navigator.onLine));
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);
  return online;
}

export function TabLayout() {
  const session = useSession();
  const online = useOnline();
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [suspended, setSuspended] = useState(false);

  useEffect(() => {
    const onSuspended = () => setSuspended(true);
    window.addEventListener(STORE_SUSPENDED_EVENT, onSuspended);
    return () => window.removeEventListener(STORE_SUSPENDED_EVENT, onSuspended);
  }, []);

  if (suspended || session.error?.code === "STORE_SUSPENDED") return <SuspendedScreen />;
  if (session.error?.code === "WRONG_ACTOR") return <WrongAccountScreen />;
  if (session.error) {
    /* no session, or an unverified one: the sign-in, which offers the código */
    return <Navigate to="/entrar" />;
  }

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col">
      {!online && (
        <p role="status" className="flex items-center gap-2 bg-warning-soft px-4 py-3 text-sm font-medium text-warning">
          <WifiOff className="size-4 shrink-0" aria-hidden />
          Sin conexión. Revisa tu internet.
        </p>
      )}
      <main className="flex-1 px-4 pb-6 pt-4">
        <Pending active={session.isPending} label="Cargando tu tienda" shape={<Skeleton className="h-24 w-full" />}>
          {session.data && <Outlet />}
        </Pending>
      </main>
      <nav aria-label="Secciones" className="sticky bottom-0 z-sticky grid grid-cols-3 border-t border-line bg-card">
        {TABS.map(({ to, label, icon: Icon, match }) => {
          const current = match(pathname);
          return (
            <Link
              key={to}
              to={to}
              aria-current={current ? "page" : undefined}
              onClick={(e) => {
                /* the same tab again is a fresh start of that tab */
                if (current && to === "/") {
                  e.preventDefault();
                  void navigate({ to: "/", replace: true });
                }
              }}
              className={`flex h-16 flex-col items-center justify-center gap-1 text-sm font-medium ${
                current ? "text-link" : "text-ink-soft"
              }`}
            >
              <Icon className="size-5" aria-hidden />
              {label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
