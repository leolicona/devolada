import { Alert, Button, Pending } from "@devolada/ui";
import { useEffect, useLayoutEffect, useRef } from "react";
import { Link, Navigate, Outlet, useNavigate, useRouter, useRouterState } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  Banknote,
  Landmark,
  Mail,
  MessageCircle,
  Plug,
  ShieldCheck,
  Store,
  WifiOff,
  Link as LinkIcon,
} from "lucide-react";
import { roleCan } from "@devolada/api/role-matrix";
import { useSession } from "../auth/session";
import { api } from "@/lib/api";
import { SignOutLink } from "../auth/SignOutLink";
import { ChooseBusinessScreen } from "../onboarding/ChooseBusinessScreen";
import { BusinessSwitcher } from "./BusinessSwitcher";
import { CreditBanner, CreditChip, STEP_COPY } from "../credit/CreditChip";
import { CreditStrip } from "../credit/CreditStrip";
import { Avatar } from "../account/Avatar";
import { ObservationChip } from "../integrations/ObservationChip";
import { businessChanged, lastLinksAddress, linksAddress, type LinksAddress } from "../links/seen";

/* payments-and-classes D6: the feed is Pagos — never two words for one
   thing, never one word for two (IA).

   cobros-in-links FR-014: Cobros is no longer a section. Who has open
   invoices is a view of Links (the Por cobrar chip), because knowing who
   owes and sending them the link are one job, and Links sits where
   Cobros used to. */
const baseSections = [
  { to: "/payments", label: "Pagos", icon: Banknote, exact: false },
  /* "Links", not "Enlaces SPEI": the glossary's word for this is
     "Link de pago" (SPEC.md), so "Enlace" was a synonym for a concept
     already named — and the two words wrapped onto a second line in the
     bottom bar at 360px while every neighbour stayed on one. */
  { to: "/links", label: "Links", icon: LinkIcon, exact: false },
] as const;

/* cash-at-stores D23 (FR-034): the business's cash at the network's
   stores — from the first time the channel was switched on, and kept
   after, so its hand-overs and disputes stay readable. Every role reads it. */
const cashPointsSection = { to: "/puntos-de-pago", label: "Puntos de pago", icon: Store, exact: false } as const;

/* integrations-hub D1: the fifth and last section, owner/admin only —
   the law: hide, never disable. Operators read outcomes in Pagos. */
const integrationsSection = { to: "/integrations", label: "Integraciones", icon: Plug, exact: false } as const;
/* account-hub D1: the fifth section is the person — the avatar, labelled
   Cuenta, at both widths. D3: its accessible name says the credit step
   from "Saldo bajo" on, and the avatar wears the glyph. */
const accountSection = { to: "/settings", label: "Cuenta", icon: null, exact: false } as const;

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
              <Button size="compact" variant="secondary">
                <MessageCircle className="size-4" aria-hidden />
                WhatsApp
              </Button>
            </a>
          )}
          {support.data.email && (
            <a href={`mailto:${support.data.email}`} className="inline-flex">
              <Button size="compact" variant="secondary">
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
  /* cobros-in-links SC-005: on Links, the entry carries the page's own
     address. The remembered one is written by the page after it renders,
     a step behind, and this list read it before the write with nothing to
     re-render it after — so Ctrl-click, middle-click and "copy link"
     opened the address from before the last keystroke (review of
     2026-09-28). A string, so the list re-renders only when the address
     moves, and only while on Links. */
  const linksHere = useRouterState({
    select: (state) => {
      const match = state.matches.find((m) => m.routeId === "/app/links");
      return match ? JSON.stringify(linksAddress(match.search)) : null;
    },
  });
  const linksSearch = () => (linksHere !== null ? (JSON.parse(linksHere) as LinksAddress) : lastLinksAddress(actor?.id));
  const sections = [
    ...baseSections,
    ...(actor?.storeChannel?.since != null ? [cashPointsSection] : []),
    ...(roleCan(actor?.role ?? "viewer", "integrations", "manage") ? [integrationsSection] : []),
    accountSection,
  ];
  const step = actor?.credit.step ?? "ok";
  const accountName = step === "ok" ? undefined : `Cuenta, ${STEP_COPY[step].label.toLowerCase()}`;

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
            /* cobros-in-links SC-005 (FR-009): the way back to Links is the
               view and the text the operator left there, not a blank page.
               Every other section opens as it always did. */
            search={to === "/links" ? linksSearch : undefined}
            /* The highlight follows the path alone. With the search counted,
               the Links entry compared the page's address with the one it
               last remembered — a step behind while the operator typed or
               changed view — and lost `aria-current` on its own page
               (review of 2026-09-28). */
            activeOptions={{ exact, includeSearch: false }}
            aria-label={Icon === null ? accountName : undefined}
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
              {Icon === null ? (
                <Avatar name={actor?.userName ?? ""} size="xs" step={step} />
              ) : (
                <Icon className={sidebar ? "size-4" : "size-5"} aria-hidden />
              )}
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
const HANDLED_CODES = ["ACCOUNT_SUSPENDED", "NO_BUSINESS", "NO_ACTIVE_BUSINESS", "MEMBERSHIP_REVOKED", "WRONG_ACTOR"];

/* cash-at-stores D2 (FR-013): a store's account in the business panel —
   never the business wizard. It is not a business and cannot make one. */
function StoreAccountScreen() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-5 bg-background px-8 text-center">
      <span className="flex size-16 items-center justify-center rounded-full border border-info-line bg-info-soft">
        <Store className="size-8 text-info" aria-hidden />
      </span>
      <h1 className="text-xl font-semibold">Esta cuenta es de una tienda.</h1>
      <p className="max-w-sm text-base text-muted-foreground">
        Entra en <span className="font-medium text-foreground">red.devoladapago.com</span>.
      </p>
      <SignOutLink />
    </main>
  );
}

/* Desktop-first shell (spec D2): sidebar ≥ lg, bottom bar below. */
export function Shell() {
  const { data: actor, isPending, error } = useSession();
  const navigate = useNavigate();
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

  /* cobros-in-links (review of 2026-09-28): the business changing under
     this tab — through its own switcher, or through another tab's that
     this session has just caught up with — is when the tab's Links
     memory decides what to forget (seen.ts). The first business a tab
     sees is not a change. A layout effect, so it runs before the page
     the new business mounts starts writing its own memory. */
  const businessId = actor?.id;
  const lastBusiness = useRef<string | undefined>(undefined);
  useLayoutEffect(() => {
    if (businessId === undefined) return;
    if (lastBusiness.current !== undefined && lastBusiness.current !== businessId) businessChanged(businessId);
    lastBusiness.current = businessId;
  }, [businessId]);

  /* feedback-vocabulary-rollout D1/D5. The word used to appear the instant the
     request left, so a session check answered from cache flashed a full screen
     of "Cargando…" and took it away again — the flicker the threshold exists to
     prevent. It rides as the shape so nothing shows until the wait is real. */
  if (isPending) {
    return (
      <Pending
        active
        label="Cargando tu sesión."
        shape={
          <main className="flex min-h-dvh items-center justify-center bg-background">
            <p className="text-sm text-ink-soft">Cargando…</p>
          </main>
        }
      >
        {null}
      </Pending>
    );
  }
  if (error?.code === "ACCOUNT_SUSPENDED") return <SuspendedScreen />;
  if (error?.code === "WRONG_ACTOR") return <StoreAccountScreen />;
  /* business-and-memberships D4: the three ways a session has no business */
  if (error?.code === "NO_BUSINESS") return <Navigate to="/nuevo-negocio" />;
  if (error?.code === "NO_ACTIVE_BUSINESS") return <ChooseBusinessScreen reason="choose" />;
  if (error?.code === "MEMBERSHIP_REVOKED") return <ChooseBusinessScreen reason="revoked" />;
  if (error || !actor) return null; /* the effect above is on its way to /login */

  return (
    <div className="min-h-dvh bg-background lg:flex">
      {/* Sidebar (desktop) */}
      <aside className="hidden w-60 shrink-0 flex-col border-r border-border bg-card p-4 lg:flex">
        <p className="px-3 text-lg font-semibold tracking-tight">Devolada</p>
        <div className="mt-2 px-3">
          <BusinessSwitcher actor={actor} />
        </div>
        <div className="mb-6 mt-3 flex flex-col gap-2 px-3">
          <CreditChip credit={actor.credit} className="flex w-full" />
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
      </aside>

      <div className="flex-1 pb-20 lg:pb-0">
        {/* design-review D5: the cap lives here, once. Uncapped, a row's
            name and its amount ended up a screen apart on a wide monitor —
            the Stripe dashboard the brief points at caps its content too. */}
        <div className="mx-auto w-full max-w-7xl">
        {/* account-hub D8 (PR B, 2026-09-02): the phone has no header. The
            business, the switcher and the balance live one tap away in
            Cuenta; the avatar in the bottom bar wears the credit step (D3);
            "Saldo bajo" is the strip below, Sin saldo and Pausa keep their
            banners. The 48px row this replaced had itself replaced three
            rows the same day — the page title is the first thing now. */}
        <CreditStrip credit={actor.credit} businessId={actor.id} canTopUp={roleCan(actor.role, "credit", "manage")} />
        <CreditBanner credit={actor.credit} canTopUp={roleCan(actor.role, "credit", "manage")} />
        {/* business-and-memberships D5 (2026-09-02): born without a CLABE;
            the banner is the wizard's missing step, the owner's to close.
            receipt-triage D32 (converge T061): any account opens the
            channel now — a CLABE, a debit card or a phone — so the banner
            asks for an account, not for a CLABE.
            Both banners stack under sm: a sentence in a 130px column next
            to a wide button pushed Pagos below the fold on a phone (design
            review identidad-2). */}
        {!actor.speiConfigured && (
          <Alert variant="warning" className="m-4 flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4 lg:mx-8 lg:mt-6">
            <span className="flex items-center gap-2">
              <Landmark className="size-4 shrink-0" aria-hidden />
              Falta la cuenta donde te pagan: una CLABE, una tarjeta de débito o un celular. Sin ella tus
              clientes no pueden pagarte por transferencia.
            </span>
            {roleCan(actor.role, "clabe", "update") && (
              <Link to="/settings/direct-payment" hash="spei" className="block">
                <Button size="compact" variant="secondary">Configurar</Button>
              </Link>
            )}
          </Alert>
        )}
        {/* Settings D8: a banner, not a wall — the admin still works
            without an integration, but nothing is collected until one is
            there. integrations-hub D10: the shell names no provider — an
            ISP is one kind of business — and points at the catalog. */}
        {!actor.integrationConfigured && (
          <Alert variant="warning" className="m-4 flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4 lg:mx-8 lg:mt-6">
            <span className="flex items-center gap-2">
              <Plug className="size-4 shrink-0" aria-hidden />
              {/* cobros-in-links FR-014: "cobros", the thing, not a section —
                  the Cobros section is gone, and a capital named a place the
                  menu no longer has (review of 2026-09-28) */}
              Conecta el sistema con el que cobras. Sin una integración no hay cobros que validar.
            </span>
            <Link to="/integrations" className="block">
              <Button size="compact" variant="secondary">Ver integraciones</Button>
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
