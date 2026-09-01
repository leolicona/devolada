import { Alert } from "@devolada/ui";
import { Link, Navigate, Outlet } from "@tanstack/react-router";
import { useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import {
  Banknote,
  KeyRound,
  LogOut,
  Settings,
  WifiOff,
  Link as LinkIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { logout, useSession } from "../auth/session";
import { VerifyEmailBanner } from "../auth/VerifyEmailBanner";
import { ChooseBusinessScreen } from "../onboarding/ChooseBusinessScreen";
import { BusinessSwitcher } from "./BusinessSwitcher";

const sections = [
  { to: "/", label: "Cobros", icon: Banknote, exact: true },
  /* "Links", not "Enlaces SPEI": the glossary's word for this is
     "Link de pago" (SPEC.md), so "Enlace" was a synonym for a concept
     already named — and the two words wrapped onto a second line in the
     bottom bar at 360px while every neighbour stayed on one. */
  { to: "/links", label: "Links", icon: LinkIcon, exact: false },
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

/* The links, in both shapes. */
function SectionLinks({ variant }: { variant: "sidebar" | "bottom" }) {
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
            </span>
            {label}
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
        <p className="text-sm text-ink-soft">Cargando…</p>
      </main>
    );
  }
  if (error?.code === "ACCOUNT_SUSPENDED") return <SuspendedScreen />;
  /* business-and-memberships D4: the three ways a session has no business */
  if (error?.code === "NO_BUSINESS") return <Navigate to="/nuevo-negocio" />;
  if (error?.code === "NO_ACTIVE_BUSINESS") return <ChooseBusinessScreen reason="choose" />;
  if (error?.code === "MEMBERSHIP_REVOKED") return <ChooseBusinessScreen reason="revoked" />;
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
        <p className="px-3 text-lg font-semibold tracking-tight">Devolada</p>
        <div className="mb-6 mt-2 px-3">
          <BusinessSwitcher actor={actor} />
        </div>
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
        {/* design-review D5: the cap lives here, once. Uncapped, a row's
            name and its amount ended up a screen apart on a wide monitor —
            the Stripe dashboard the brief points at caps its content too. */}
        <div className="mx-auto w-full max-w-7xl">
        {/* The switcher rides the top on phones; the sidebar holds it on desktop */}
        <header className="border-b border-border bg-card px-4 py-2 lg:hidden">
          <BusinessSwitcher actor={actor} />
        </header>
        {/* D5: unverified ISPs see a persistent banner; the código is
            typed right here (better-auth.spec.md D4) */}
        {!actor.emailVerified && <VerifyEmailBanner email={actor.email} />}
        {/* Settings D8: a banner, not a wall — the admin still works
            without a key, but nothing reconnects until it is there */}
        {!actor.wisphubConfigured && (
          <Alert variant="warning" className="m-4 flex items-center justify-between gap-4 lg:mx-8 lg:mt-6">
            <span className="flex items-center gap-2">
              <KeyRound className="size-4 shrink-0" aria-hidden />
              Falta tu llave de WispHub. Sin ella no podemos reconectar a los clientes.
            </span>
            <Link to="/settings" className="block">
              <Button variant="outline">Configurar</Button>
            </Link>
          </Alert>
        )}
          <Outlet />
        </div>
      </div>

      {/* Bottom bar (mobile) */}
      <SectionLinks variant="bottom" />
    </div>
  );
}
