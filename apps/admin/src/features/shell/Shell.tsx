import { Link, Navigate, Outlet } from "@tanstack/react-router";
import { useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import {
  ArrowDownToLine,
  Banknote,
  LogOut,
  MailWarning,
  Settings,
  Store,
  WifiOff,
} from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { logout, resendVerification, useSession } from "../auth/session";

const sections = [
  { to: "/", label: "Cobros", icon: Banknote, exact: true },
  { to: "/stores", label: "Tiendas", icon: Store, exact: false },
  { to: "/cash-drops", label: "Entregas", icon: ArrowDownToLine, exact: false },
  { to: "/settings", label: "Configuración", icon: Settings, exact: false },
] as const;

function SuspendedScreen() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-5 bg-background px-8 text-center">
      <span className="flex size-16 items-center justify-center rounded-full border border-error-line bg-error-soft">
        <WifiOff className="size-8 text-error" aria-hidden />
      </span>
      <h1 className="text-xl font-semibold">Cuenta suspendida</h1>
      <p className="max-w-sm text-base text-muted-foreground">
        Tu cuenta está suspendida. Escríbenos para revisarla.
      </p>
    </main>
  );
}

/* Desktop-first shell (spec D2): sidebar ≥ lg, bottom bar below. */
export function Shell() {
  const { data: actor, isPending, error } = useSession();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  if (isPending) {
    return (
      <main className="flex min-h-dvh items-center justify-center bg-background">
        <p className="text-sm text-ink-faint">Cargando…</p>
      </main>
    );
  }
  if (error?.code === "ACCOUNT_SUSPENDED") return <SuspendedScreen />;
  if (error || !actor) return <Navigate to="/login" />;

  async function onLogout() {
    await logout().catch(() => {});
    queryClient.clear();
    void navigate({ to: "/login" });
  }

  const nav = (
    <nav aria-label="Secciones" className="flex flex-1 flex-col gap-1">
      {sections.map(({ to, label, icon: Icon, exact }) => (
        <Link
          key={to}
          to={to}
          activeOptions={{ exact }}
          className="flex h-10 items-center gap-3 rounded-md px-3 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
          activeProps={{ className: "bg-accent-soft text-link", "aria-current": "page" }}
        >
          <Icon className="size-4" aria-hidden />
          {label}
        </Link>
      ))}
    </nav>
  );

  return (
    <div className="min-h-dvh bg-background lg:flex">
      {/* Sidebar (desktop) */}
      <aside className="hidden w-60 shrink-0 flex-col border-r border-border bg-card p-4 lg:flex">
        <p className="mb-6 px-3 text-lg font-semibold tracking-tight">Devolada</p>
        {nav}
        <div className="border-t border-border pt-3">
          <p className="truncate px-3 text-sm text-muted-foreground">{actor.email}</p>
          <Button variant="ghost" size="default" className="mt-1 w-full justify-start" onClick={() => void onLogout()}>
            <LogOut className="size-4" aria-hidden />
            Cerrar sesión
          </Button>
        </div>
      </aside>

      <div className="flex-1 pb-20 lg:pb-0">
        {/* D5: unverified ISPs see a persistent banner */}
        {!actor.emailVerified && (
          <Alert variant="warning" className="m-4 flex items-center justify-between gap-4 lg:mx-8 lg:mt-6">
            <span className="flex items-center gap-2">
              <MailWarning className="size-4 shrink-0" aria-hidden />
              Confirma tu correo para poder registrar tiendas.
            </span>
            <Button
              variant="outline"
              onClick={() => void resendVerification().catch(() => {})}
            >
              Reenviar correo
            </Button>
          </Alert>
        )}
        <Outlet />
      </div>

      {/* Bottom bar (mobile) */}
      <nav
        aria-label="Secciones"
        className="fixed inset-x-0 bottom-0 border-t border-border bg-card pb-[env(safe-area-inset-bottom)] lg:hidden"
      >
        <div className="flex h-16">
          {sections.map(({ to, label, icon: Icon, exact }) => (
            <Link
              key={to}
              to={to}
              activeOptions={{ exact }}
              className="flex flex-1 flex-col items-center justify-center gap-1 text-xs font-medium text-muted-foreground"
              activeProps={{ className: "text-link font-semibold", "aria-current": "page" }}
            >
              <Icon className="size-5" aria-hidden />
              {label}
            </Link>
          ))}
        </div>
      </nav>
    </div>
  );
}

/* Honest placeholders: each section is its own upcoming task. */
export function SectionPlaceholder({ title, next }: { title: string; next: string }) {
  return (
    <main className="px-4 pt-4 lg:px-8 lg:pt-8">
      <h1 className="text-xl font-semibold">{title}</h1>
      <p className="mt-6 max-w-lg rounded-md border border-border bg-muted px-4 py-3 text-sm text-muted-foreground">
        {next} llega con la siguiente tarea del plan.
      </p>
    </main>
  );
}
