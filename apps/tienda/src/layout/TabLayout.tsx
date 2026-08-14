import { useEffect, useState } from "react";
import { Link, Outlet } from "@tanstack/react-router";
import { ListOrdered, Search, Wallet, WifiOff } from "lucide-react";

/* Mobile data drops mid-shift; the shopkeeper must know why nothing
   loads (store-invitation spec D4). */
function useOnline(): boolean {
  const [online, setOnline] = useState(() => navigator.onLine);
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

const tabs = [
  { to: "/", label: "Cobrar", icon: Search },
  { to: "/cashbox", label: "Caja", icon: Wallet },
  { to: "/ledger", label: "Movimientos", icon: ListOrdered },
] as const;

/* 3 fixed bottom tabs at --size-tabbar (64px), thumb zone. The active tab
   is marked by weight + accent bar, never color alone. */
export function TabLayout() {
  const online = useOnline();
  return (
    <div className="mx-auto flex min-h-dvh max-w-content flex-col bg-surface">
      {!online && (
        <p
          role="status"
          className="flex items-center justify-center gap-2 border-b border-warning-line bg-warning-soft px-4 py-2 text-sm font-medium text-warning"
        >
          <WifiOff className="size-4 shrink-0" aria-hidden />
          Sin conexión. Revisa tu internet.
        </p>
      )}
      <div className="flex-1 pb-20">
        <Outlet />
      </div>
      <nav
        aria-label="Navegación principal"
        className="fixed inset-x-0 bottom-0 border-t border-line bg-card pb-[env(safe-area-inset-bottom)]"
      >
        <div className="mx-auto flex h-16 max-w-content">
          {tabs.map(({ to, label, icon: Icon }) => (
            <Link
              key={to}
              to={to}
              className="relative flex flex-1 flex-col items-center justify-center gap-1 text-xs font-medium text-ink-soft"
              activeOptions={{ exact: to === "/" }}
              activeProps={{
                className: "text-link font-semibold",
                "aria-current": "page",
              }}
            >
              {({ isActive }) => (
                <>
                  {isActive && (
                    <span className="absolute top-0 h-0.5 w-10 rounded-full bg-accent" aria-hidden />
                  )}
                  <Icon className="size-5" aria-hidden />
                  {label}
                </>
              )}
            </Link>
          ))}
        </div>
      </nav>
    </div>
  );
}
