import { useEffect, type ReactNode } from "react";
import { Link, Outlet, useNavigate, useRouter, useRouterState } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { Amount, Card } from "@devolada/ui";
import { ChevronLeft, ChevronRight, Eye, Fingerprint, Landmark, LogOut, Plug, SlidersHorizontal, Users, type LucideIcon } from "lucide-react";
import { roleCan } from "@devolada/api/role-matrix";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { logout, useSession, type BusinessActor } from "../auth/session";
import { ROLE_LABELS } from "../auth/roles";
import { BusinessSwitcher } from "../shell/BusinessSwitcher";
import { STEP_COPY } from "../credit/CreditChip";
import { Avatar } from "./Avatar";

/* Cuenta (account-hub spec, US-A05): the person's door. D4: a hub of
   sub-pages under /settings; D5: business first, the person's things
   below, the way out last; D6: two columns from lg, a stack below. */

/* D4: the anchors the rest of the admin linked to for months keep
   landing where their card went. `hash` is the id on the sub-page that
   holds the card now — `#cargo` lands on the SPEI card, where the one
   service fee lives since settings D9, and `#zona` on Preferencias since
   the page split in two (settings D11). */
const HASH_HOMES: Record<string, { to: string; hash?: string }> = {
  saldo: { to: "/settings/credit" },
  usuarios: { to: "/settings/users" },
  sesion: { to: "/settings" },
  cargo: { to: "/settings/direct-payment", hash: "spei" },
  spei: { to: "/settings/direct-payment", hash: "spei" },
  politica: { to: "/settings/direct-payment", hash: "politica" },
  zona: { to: "/settings/preferences", hash: "zona" },
};

export function AccountLayout() {
  const { data: actor } = useSession();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const atIndex = pathname.replace(/\/+$/, "") === "/settings";
  if (!actor) return null;
  return (
    <main className="max-w-5xl px-4 pt-4 lg:px-8 lg:pt-8">
      {/* One h1 for the section; on a phone's sub-page it steps aside for
          the sub-page's own title (D6) */}
      <h1 className={cn("text-xl font-semibold", !atIndex && "sr-only lg:not-sr-only")}>Cuenta</h1>
      <div className="mt-4 lg:grid lg:grid-cols-[17rem_minmax(0,1fr)] lg:gap-8">
        <aside className={cn("pb-8", !atIndex && "hidden lg:block")} aria-label="Cuenta, secciones">
          <AccountRail actor={actor} />
        </aside>
        <div className={cn("min-w-0 pb-8", atIndex && "hidden lg:block")}>
          <Outlet />
        </div>
      </div>
    </main>
  );
}

type Row = { to: string; label: string; icon: LucideIcon; detail: ReactNode };

function RailRow({ row }: { row: Row }) {
  const Icon = row.icon;
  return (
    <li>
      <Link
        to={row.to}
        className="flex items-center gap-3 rounded-md px-3 py-2.5 text-foreground hover:bg-muted"
        activeProps={{ className: "bg-accent-soft", "aria-current": "page" }}
      >
        <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{row.label}</span>
          {/* espaciado review T6: 14px like every other line in the area,
              and wrapping rather than truncating — at 14px "CLABE, cargo
              por servicio y tolerancia" no longer fits the 17rem rail, and
              a cut-off description is worse than a small one when the
              description is what a reader scans to pick the row. */}
          <span className="block text-sm text-ink-soft">{row.detail}</span>
        </span>
        <ChevronRight className="size-4 shrink-0 text-muted-foreground lg:hidden" aria-hidden />
      </Link>
    </li>
  );
}

function RailGroup({ id, title, rows }: { id: string; title: string; rows: Row[] }) {
  if (rows.length === 0) return null;
  return (
    <section aria-labelledby={id} className="mt-5">
      <h2 id={id} className="px-3 text-xs font-semibold uppercase tracking-wide text-ink-soft">
        {title}
      </h2>
      <ul className="mt-1">
        {rows.map((row) => (
          <RailRow key={row.to} row={row} />
        ))}
      </ul>
    </section>
  );
}

function AccountRail({ actor }: { actor: BusinessActor }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const step = STEP_COPY[actor.credit.step];
  const StepIcon = step.icon;

  /* D5: the rows obey the matrix the cards already obey — hide, never
     disable (brief law) */
  const negocio: Row[] = [
    ...(roleCan(actor.role, "credit", "manage")
      ? [
          {
            to: "/settings/credit",
            label: "Saldo y recargas",
            icon: StepIcon,
            detail: (
              <>
                <Amount cents={actor.credit.balanceCents} /> · {step.label}
              </>
            ),
          },
        ]
      : []),
    /* D11: two rows, each saying what is behind it — "Configuración"
       inside a settings hub named nothing */
    ...(roleCan(actor.role, "settings", "update")
      ? [
          {
            to: "/settings/direct-payment",
            label: "Pago directo y conciliación",
            icon: Landmark,
            detail: "CLABE, cargo por servicio y tolerancia",
          },
        ]
      : []),
    ...(roleCan(actor.role, "integrations", "manage")
      ? [
          {
            to: "/integrations",
            label: "Integraciones",
            icon: Plug,
            detail: actor.observing ? (
              <span className="inline-flex items-center gap-1 text-info">
                <Eye className="size-4" aria-hidden />
                Modo observación
              </span>
            ) : (
              "El sistema con el que cobras"
            ),
          },
        ]
      : []),
    ...(roleCan(actor.role, "members", "invite_below_admin")
      ? [{ to: "/settings/users", label: "Usuarios", icon: Users, detail: "Quién entra y con qué rol" }]
      : []),
    ...(roleCan(actor.role, "settings", "update")
      ? [{ to: "/settings/preferences", label: "Preferencias", icon: SlidersHorizontal, detail: "Zona horaria y formato de hora" }]
      : []),
  ];
  const cuenta: Row[] = [
    { to: "/settings/security", label: "Entrar con huella o rostro", icon: Fingerprint, detail: "Tus passkeys" },
  ];

  async function onSignOut() {
    await logout().catch(() => {});
    queryClient.clear();
    void navigate({ to: "/login" });
  }

  return (
    <div>
      {/* The identity card (D5): who, where, as what.
          espaciado review T5: the `Card` atom, so this is 10px like every
          other card instead of the 14px modal radius it had picked. */}
      <Card className="p-4">
        <div className="flex items-center gap-3">
          <Avatar name={actor.userName} size="lg" step={actor.credit.step} />
          <div className="min-w-0">
            <p className="truncate font-semibold">{actor.userName}</p>
            <p className="truncate text-sm text-ink-soft">{actor.email}</p>
          </div>
        </div>
        {/* Where, and as what: the switcher's plain label carries the role
            (IA: "role badge shown here"); a menu when there are several */}
        <div className="mt-3 border-t border-line-soft pt-3">
          <BusinessSwitcher actor={actor} />
        </div>
      </Card>

      <RailGroup id="hub-negocio" title="Negocio" rows={negocio} />
      <RailGroup id="hub-cuenta" title="Tu cuenta" rows={cuenta} />

      {/* BUG-016: the one door out, for every role, at every width */}
      <Button variant="outline" className="mt-6 w-full justify-start" onClick={() => void onSignOut()}>
        <LogOut className="size-4" aria-hidden />
        Cerrar sesión
      </Button>
    </div>
  );
}

/* /settings itself: on a phone the rail is the page; on a monitor the
   right column shows the person, read-only (D6, D7). The old anchors are
   redirected from here (D4). */
export function AccountIndex() {
  const { data: actor } = useSession();
  const router = useRouter();
  const navigate = useNavigate();
  useEffect(() => {
    const hash = router.state.location.hash;
    const home = hash ? HASH_HOMES[hash] : undefined;
    if (!home || home.to === "/settings") return;
    void navigate({ to: home.to, hash: home.hash, replace: true });
  }, [router, navigate]);
  if (!actor) return null;
  return (
    <Card className="p-6">
      <h2 className="text-base font-semibold">Tu cuenta</h2>
      <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-ink-soft">Nombre</dt>
          <dd className="font-medium">{actor.userName}</dd>
        </div>
        <div>
          <dt className="text-ink-soft">Correo</dt>
          <dd className="font-medium">{actor.email}</dd>
        </div>
        <div>
          <dt className="text-ink-soft">Negocio</dt>
          <dd className="font-medium">{actor.name}</dd>
        </div>
        <div>
          <dt className="text-ink-soft">Rol</dt>
          <dd className="font-medium">{ROLE_LABELS[actor.role]}</dd>
        </div>
      </dl>
      <p className="mt-4 text-sm text-ink-soft">
        Para cambiar tu nombre o tu contraseña, escríbenos. Pronto podrás hacerlo desde aquí.
      </p>
    </Card>
  );
}

/* The sub-page frame: the way back on a phone, and a title only when the
   page holds more than one card (espaciado-y-tipografía review T2, D3).
   A page that is one card whose heading already says the row's words —
   Saldo y recargas, Usuarios, Entrar con huella o rostro, Zona horaria y
   hora — would say them twice; the settings page killed its own index on
   that same argument (settings D10). Pago directo y conciliación keeps
   its title because it names two cards that are called something else.
   The size is `text-lg`, the ramp's "section titles" (T1): at `text-xl`
   it matched the hub's own `h1` — 24px against 24px, side by side in two
   columns, the longer string reading as the page's real name. */
export function SubPage({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <div>
      <Link to="/settings" className="mb-3 inline-flex items-center gap-1 text-sm text-link hover:underline lg:hidden">
        <ChevronLeft className="size-4" aria-hidden />
        Volver a Cuenta
      </Link>
      {title && <h2 className="mb-4 text-lg font-semibold">{title}</h2>}
      {children}
    </div>
  );
}
