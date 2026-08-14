import { Alert } from "@devolada/ui";
import { Link, Navigate, Outlet } from "@tanstack/react-router";
import { useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import {
  ArrowDownToLine,
  Banknote,
  KeyRound,
  LogOut,
  MailWarning,
  Settings,
  Store,
  WifiOff,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { logout, resendVerification, useSession } from "../auth/session";
import { usePendingDropCount } from "../cash-drops/usePendingDrops";

const sections = [
  { to: "/", label: "Cobros", icon: Banknote, exact: true },
  { to: "/stores", label: "Tiendas", icon: Store, exact: false },
  { to: "/cash-drops", label: "Entregas", icon: ArrowDownToLine, exact: false },
  { to: "/settings", label: "Configuración", icon: Settings, exact: false },
] as const;

/* D8: the count rides the same query as the Entregas screen. Text, not
   only a dot — a badge that says nothing is decoration (FRONTEND law). */
function PendingCount({ count, className = "ml-auto" }: { count: number; className?: string }) {
  if (!count) return null;
  return (
    <span
      className={`rounded-full bg-warning-soft px-2 py-0.5 text-xs font-semibold text-warning ${className}`}
      aria-label={`${count} ${count === 1 ? "entrega pendiente" : "entregas pendientes"}`}
    >
      {count}
    </span>
  );
}

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

/* The links, in both shapes. It owns the pending query, so it only runs
   once the session is known (this renders after the Shell's guards). */
function SectionLinks({ variant }: { variant: "sidebar" | "bottom" }) {
  const pendingDrops = usePendingDropCount();
  const sidebar = variant === "sidebar";

  return (
    <nav
      /* Both navs are always in the DOM; CSS decides which one shows.
         Sharing a name leaves a screen reader with two identical
         "Secciones" landmarks and no way to tell them apart (US-P04). */
      aria-label={sidebar ? "Secciones" : "Secciones, barra inferior"}
      className={
        sidebar
          ? "flex flex-1 flex-col gap-1"
          : "fixed inset-x-0 bottom-0 border-t border-border bg-card pb-[env(safe-area-inset-bottom)] lg:hidden"
      }
    >
      <div className={sidebar ? "contents" : "flex h-16"}>
        {sections.map(({ to, label, icon: Icon, exact }) => (
          <Link
            key={to}
            to={to}
            activeOptions={{ exact }}
            className={
              sidebar
                ? "flex h-10 items-center gap-3 rounded-md px-3 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
                : "flex flex-1 flex-col items-center justify-center gap-1 text-xs font-medium text-muted-foreground"
            }
            activeProps={{
              className: sidebar ? "bg-accent-soft text-link" : "text-link font-semibold",
              "aria-current": "page",
            }}
          >
            <span className={sidebar ? "contents" : "relative"}>
              <Icon className={sidebar ? "size-4" : "size-5"} aria-hidden />
              {!sidebar && to === "/cash-drops" && (
                <PendingCount count={pendingDrops} className="absolute -right-3 -top-1" />
              )}
            </span>
            {label}
            {sidebar && to === "/cash-drops" && <PendingCount count={pendingDrops} />}
          </Link>
        ))}
      </div>
    </nav>
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

  return (
    <div className="min-h-dvh bg-background lg:flex">
      {/* Sidebar (desktop) */}
      <aside className="hidden w-60 shrink-0 flex-col border-r border-border bg-card p-4 lg:flex">
        <p className="mb-6 px-3 text-lg font-semibold tracking-tight">Devolada</p>
        <SectionLinks variant="sidebar" />
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
        {/* Settings D8: a banner, not a wall — the admin still works
            without a key, but nothing reconnects until it is there */}
        {!actor.wisphubConfigured && (
          <Alert variant="warning" className="m-4 flex items-center justify-between gap-4 lg:mx-8 lg:mt-6">
            <span className="flex items-center gap-2">
              <KeyRound className="size-4 shrink-0" aria-hidden />
              Falta tu llave de WispHub. Sin ella no podemos reconectar a los clientes.
            </span>
            <Link to="/settings">
              <Button variant="outline">Configurar</Button>
            </Link>
          </Alert>
        )}
        <Outlet />
      </div>

      {/* Bottom bar (mobile) */}
      <SectionLinks variant="bottom" />
    </div>
  );
}
