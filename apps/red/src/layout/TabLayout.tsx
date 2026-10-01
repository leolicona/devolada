import { useEffect, useState } from "react";
import { Link, Navigate, Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { HandCoins, ListOrdered, WifiOff, Wallet } from "lucide-react";
import { ListError, Pending, Skeleton } from "@devolada/ui";
import { STORE_SUSPENDED_EVENT } from "@/lib/api";
import { useSession } from "@/features/auth/session";
import { SuspendedScreen, WrongAccountScreen } from "@/features/auth/Gate";

/* cash-at-stores D26: three tabs — *Cobrar*, *Caja*, *Movimientos* — at
   the bottom, where a thumb reaches, each 64px (the decisive size: a tab
   is how the shopkeeper moves between the counter and the drawer).
   Signing out and the passkey live in *Caja* (`cashbox` D3). From 1024px
   the same three sections are a side menu (D32). */

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

/* D26, D32: the three sections, in both shapes. Both are in the page and
   CSS shows one, as the panel's shell does; two names, so a screen reader
   can tell the two landmarks apart (US-P04). */
function Sections({ variant, pathname }: { variant: "side" | "bar"; pathname: string }) {
  const navigate = useNavigate();
  const side = variant === "side";
  return (
    <nav
      aria-label={side ? "Secciones" : "Secciones, barra inferior"}
      className={side ? "flex flex-col gap-1" : "sticky bottom-0 z-sticky grid grid-cols-3 border-t border-line bg-card lg:hidden"}
    >
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
            className={
              side
                ? `flex h-12 items-center gap-3 rounded-md px-3 text-base font-medium ${
                    current ? "bg-accent-soft text-link" : "text-ink-soft hover:bg-well hover:text-ink"
                  }`
                : `flex h-16 flex-col items-center justify-center gap-1 text-sm font-medium ${current ? "text-link" : "text-ink-soft"}`
            }
          >
            <Icon className="size-5" aria-hidden />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}

export function TabLayout() {
  const session = useSession();
  const online = useOnline();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [suspended, setSuspended] = useState(false);

  useEffect(() => {
    const onSuspended = () => setSuspended(true);
    window.addEventListener(STORE_SUSPENDED_EVENT, onSuspended);
    return () => window.removeEventListener(STORE_SUSPENDED_EVENT, onSuspended);
  }, []);

  if (suspended || session.error?.code === "STORE_SUSPENDED") return <SuspendedScreen />;
  if (session.error?.code === "WRONG_ACTOR") return <WrongAccountScreen />;
  /* no session, or an unverified one: the sign-in, which offers the código.
     T074 (FR-010, D26): only an answer that SAYS so signs the shopkeeper
     out of view — a lost signal or a server error keeps the layout, its
     banner and whatever the session already knew */
  if (session.error && (session.error.status === 401 || session.error.code === "EMAIL_NOT_VERIFIED")) {
    return <Navigate to="/entrar" />;
  }

  return (
    <div className="min-h-dvh lg:flex">
      {/* D32: from 1024px the sections move to a side menu — the panel's
          shell recipe (Shell.tsx), at the store app's 48px */}
      <aside className="hidden w-60 shrink-0 flex-col border-r border-line bg-card p-4 lg:sticky lg:top-0 lg:flex lg:h-dvh">
        <p className="px-3 text-lg font-semibold tracking-tight">Devolada</p>
        <p className="mb-6 mt-1 break-words px-3 text-sm text-ink-soft">{session.data?.name}</p>
        <Sections variant="side" pathname={pathname} />
      </aside>
      <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col lg:mx-0 lg:min-w-0 lg:max-w-none lg:flex-1">
        {!online && (
          <p role="status" className="flex items-center gap-2 bg-warning-soft px-4 py-3 text-sm font-medium text-warning">
            <WifiOff className="size-4 shrink-0" aria-hidden />
            Sin conexión. Revisa tu internet.
          </p>
        )}
        <main className="flex-1 px-4 pb-6 pt-4 lg:px-8 lg:pt-8">
          {/* D32: the content stops at 72rem on a wide screen */}
          <div className="lg:mx-auto lg:max-w-6xl">
            <Pending active={session.isPending} label="Cargando tu tienda" shape={<Skeleton className="h-24 w-full" />}>
              {session.data ? <Outlet /> : session.error ? <ListError what="tu tienda" onRetry={() => session.refetch()} /> : null}
            </Pending>
          </div>
        </main>
        <Sections variant="bar" pathname={pathname} />
      </div>
    </div>
  );
}
