import { Alert } from "@devolada/ui";
import { useEffect, useRef } from "react";
import { Link, Navigate, Outlet, useNavigate, useRouter } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Banknote,
  HandCoins,
  KeyRound,
  Landmark,
  LogOut,
  Mail,
  MessageCircle,
  Plug,
  Settings,
  ShieldCheck,
  WifiOff,
  Link as LinkIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { roleCan } from "@devolada/api/role-matrix";
import { logout, useSession } from "../auth/session";
import { api } from "@/lib/api";
import { VerifyEmailBanner } from "../auth/VerifyEmailBanner";
import { SignOutLink } from "../auth/SignOutLink";
import { ChooseBusinessScreen } from "../onboarding/ChooseBusinessScreen";
import { BusinessSwitcher } from "./BusinessSwitcher";
import { CreditBanner, CreditChip } from "../credit/CreditChip";
import { ObservationChip } from "../integrations/ObservationChip";

/* payments-and-classes D6: the feed is Pagos the moment Cobros exists —
   never two words for one thing, never one word for two (IA). */
const baseSections = [
  { to: "/payments", label: "Pagos", icon: Banknote, exact: false },
  { to: "/payment-requests", label: "Cobros", icon: HandCoins, exact: false },
  /* "Links", not "Enlaces SPEI": the glossary's word for this is
     "Link de pago" (SPEC.md), so "Enlace" was a synonym for a concept
     already named — and the two words wrapped onto a second line in the
     bottom bar at 360px while every neighbour stayed on one. */
  { to: "/links", label: "Links", icon: LinkIcon, exact: false },
] as const;

/* integrations-hub D1: the fifth and last section, owner/admin only —
   the law: hide, never disable. Operators read outcomes in Pagos. */
const integrationsSection = { to: "/integrations", label: "Integraciones", icon: Plug, exact: false } as const;
const settingsSection = { to: "/settings", label: "Configuración", icon: Settings, exact: false } as const;

/* operator-panel D1 (identity round): the channel is a platform setting,
   read without a session — the suspended one was just revoked. */
function SuspendedScreen() {
  const support = useQuery<{ whatsapp: string | null; email: string | null }>({
    queryKey: ["support"],
    queryFn: () => api("/support"),
    retry: false,
  });
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-5 bg-background px-8 text-center">
      <span className="flex size-16 items-center justify-center rounded-full border border-error-line bg-error-soft">
        <WifiOff className="size-8 text-error" aria-hidden />
      </span>
      <h1 className="text-xl font-semibold">Cuenta suspendida</h1>
      <p className="max-w-sm text-base text-muted-foreground">
        Tu cuenta está suspendida. Escríbenos para revisarla.
      </p>
      {support.data && (support.data.whatsapp || support.data.email) && (
        <div className="flex flex-wrap justify-center gap-2">
          {support.data.whatsapp && (
            <a href={`https://wa.me/${support.data.whatsapp}`} target="_blank" rel="noopener noreferrer" className="inline-flex">
              <Button variant="outline">
                <MessageCircle className="size-4" aria-hidden />
                WhatsApp
              </Button>
            </a>
          )}
          {support.data.email && (
            <a href={`mailto:${support.data.email}`} className="inline-flex">
              <Button variant="outline">
                <Mail className="size-4" aria-hidden />
                {support.data.email}
              </Button>
            </a>
          )}
        </div>
      )}
      <SignOutLink />
    </main>
  );
}

/* The links, in both shapes. */
function SectionLinks({ variant }: { variant: "sidebar" | "bottom" }) {
  const sidebar = variant === "sidebar";
  const { data: actor } = useSession();
  const sections = [
    ...baseSections,
    ...(roleCan(actor?.role ?? "viewer", "integrations", "manage") ? [integrationsSection] : []),
    settingsSection,
  ];

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
                : /* min-w-0 so a long label (Integraciones) shrinks inside
                     its cell instead of colliding with its neighbour
                     (design review fase 5); 11px buys the five labels
                     their one line at 360-375px */
                  "flex min-w-0 flex-1 flex-col items-center justify-center gap-1 px-1 text-[11px] font-medium text-muted-foreground"
            }
            activeProps={{
              className: sidebar ? "bg-accent-soft text-link" : "text-link font-semibold",
              "aria-current": "page",
            }}
          >
            <span className={sidebar ? "contents" : "relative"}>
              <Icon className={sidebar ? "size-4" : "size-5"} aria-hidden />
            </span>
            <span className={sidebar ? undefined : "max-w-full truncate"}>{label}</span>
          </Link>
        ))}
      </div>
    </nav>
  );
}

/* The session errors the shell answers with a screen of their own
   (business-and-memberships D4, sessions rule 2); every other one is a
   bounce to login. */
const HANDLED_CODES = ["ACCOUNT_SUSPENDED", "NO_BUSINESS", "NO_ACTIVE_BUSINESS", "MEMBERSHIP_REVOKED"];

/* Desktop-first shell (spec D2): sidebar ≥ lg, bottom bar below. */
export function Shell() {
  const { data: actor, isPending, error } = useSession();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const router = useRouter();
  /* better-auth.spec.md D12: login brings you back here, not to "/".
     Imperative on purpose, and read off the router without subscribing:
     `<Navigate>` re-navigates on every render, so a shell that re-rendered
     on location changes (useLocation) kept re-navigating during its own
     transition — measured as a heap-out-of-memory in the suite. */
  const bounced =
    !isPending && (Boolean(error) || !actor) && !(error && HANDLED_CODES.includes(error.code));
  const bouncedOnce = useRef(false);
  useEffect(() => {
    if (!bounced || bouncedOnce.current) return;
    bouncedOnce.current = true;
    const { pathname } = router.state.location;
    void navigate({ to: "/login", search: pathname === "/" ? {} : { next: pathname } });
  }, [bounced, navigate, router]);

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
  if (error || !actor) return null; /* the effect above is on its way to /login */

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
        <div className="mt-2 px-3">
          <BusinessSwitcher actor={actor} />
        </div>
        <div className="mb-6 mt-3 px-3">
          <CreditChip credit={actor.credit} />
          {actor.observing && <ObservationChip />}
        </div>
        <SectionLinks variant="sidebar" />
        {/* operator-panel D3: outside the five sections, only for the operator */}
        {actor.platformOperator && (
          <Link
            to="/operador"
            className="mt-2 flex h-10 items-center gap-3 rounded-md px-3 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
            activeProps={{ className: "bg-accent-soft text-link", "aria-current": "page" }}
          >
            <ShieldCheck className="size-4" aria-hidden />
            Operador
          </Link>
        )}
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
        <header className="space-y-2 border-b border-border bg-card px-4 py-2 lg:hidden">
          <BusinessSwitcher actor={actor} />
          <CreditChip credit={actor.credit} />
          {actor.observing && <ObservationChip />}
        </header>
        <CreditBanner credit={actor.credit} />
        {/* D5: unverified ISPs see a persistent banner; the código is
            typed right here (better-auth.spec.md D4) */}
        {!actor.emailVerified && <VerifyEmailBanner email={actor.email} className="m-4 lg:mx-8 lg:mt-6" />}
        {/* business-and-memberships D5 (2026-09-02): born without a CLABE;
            the banner is the wizard's missing step, the owner's to close */}
        {!actor.speiConfigured && (
          <Alert variant="warning" className="m-4 flex items-center justify-between gap-4 lg:mx-8 lg:mt-6">
            <span className="flex items-center gap-2">
              <Landmark className="size-4 shrink-0" aria-hidden />
              Falta la CLABE del negocio. Sin ella tus clientes no pueden pagarte por transferencia.
            </span>
            {roleCan(actor.role, "clabe", "update") && (
              <Link to="/settings" hash="spei" className="block">
                <Button variant="outline">Configurar</Button>
              </Link>
            )}
          </Alert>
        )}
        {/* Settings D8: a banner, not a wall — the admin still works
            without a key, but nothing reconnects until it is there.
            The key moved to Integraciones with the hub (BUG-013). */}
        {!actor.wisphubConfigured && (
          <Alert variant="warning" className="m-4 flex items-center justify-between gap-4 lg:mx-8 lg:mt-6">
            <span className="flex items-center gap-2">
              <KeyRound className="size-4 shrink-0" aria-hidden />
              Falta tu llave de WispHub. Sin ella no podemos reconectar a los clientes.
            </span>
            <Link to="/integrations/wisphub" className="block">
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
