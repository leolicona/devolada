import { Link, Outlet } from "@tanstack/react-router";
import { ListOrdered, Search, Wallet } from "lucide-react";

const tabs = [
  { to: "/", label: "Cobrar", icon: Search },
  { to: "/cashbox", label: "Caja", icon: Wallet },
  { to: "/ledger", label: "Movimientos", icon: ListOrdered },
] as const;

/* 3 fixed bottom tabs at --size-tabbar (64px), thumb zone. The active tab
   is marked by weight + accent bar, never color alone. */
export function TabLayout() {
  return (
    <div className="mx-auto flex min-h-dvh max-w-[40rem] flex-col bg-surface">
      <div className="flex-1 pb-20">
        <Outlet />
      </div>
      <nav
        aria-label="Navegación principal"
        className="fixed inset-x-0 bottom-0 border-t border-line bg-card pb-[env(safe-area-inset-bottom)]"
      >
        <div className="mx-auto flex h-16 max-w-[40rem]">
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
