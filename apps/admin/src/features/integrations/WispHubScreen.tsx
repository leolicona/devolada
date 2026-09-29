import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ArrowLeft, CheckCircle2, KeyRound, TriangleAlert } from "lucide-react";
import {
  Button,
  Card,
  formatMoney,
  Input,
  ListError,
  parseMoney,
  Pending,
  Skeleton,
  StatusBadge,
} from "@devolada/ui";
import type {
  IntegrationsResponse,
  WisphubIntegration,
  WisphubPatchRequest,
  WispHubTestResponse,
  WispHubUnverifiableWrite,
  WispHubVerifiableRead,
} from "@devolada/api/integrations-schema";
/* provider-address-per-isp D3: the catalogue is compiled into both
   sides, so the picker renders the same list the API resolves against.
   The admin uses `key`, `label` and `kind` — never `host`: this app does
   not talk to WispHub, and an endpoint is not something an ISP should be
   reading or copying (ARCHITECTURE.md). */
import { INSTALLATIONS, type InstallationKey } from "@devolada/api/installations";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { api, ApiError } from "@/lib/api";
import { cn } from "@/lib/utils";

/* The WispHub detail (integrations-hub D3/D4/D8/D9, US-I01–I03): the
   key (settings D1–D3 verbatim, moved), the class→action mapping with
   the threshold living in the short row, the master switch, and the
   provisional switch. Built on the copied shadcn primitives (Select,
   Switch, Input) themed by our tokens. */

const pesos = (cents: number) => (cents / 100).toFixed(2);

function useSaveIntegration() {
  const queryClient = useQueryClient();
  return useMutation<IntegrationsResponse, ApiError, WisphubPatchRequest>({
    mutationFn: (body) =>
      api<IntegrationsResponse>("/integrations/wisphub", { method: "PATCH", body: JSON.stringify(body) }),
    onSuccess: (data) => {
      queryClient.setQueryData(["integrations"], data);
      /* the chip and integrationConfigured ride the session */
      void queryClient.invalidateQueries({ queryKey: ["session"] });
      void queryClient.invalidateQueries({ queryKey: ["feed"] });
    },
  });
}

function SectionCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card className="p-6">
      <h2 className="text-base font-semibold">{title}</h2>
      <div className="mt-4 space-y-4">{children}</div>
    </Card>
  );
}

/* provider-address-per-isp FR-005/FR-007, US1: the closed choice.

   The entries are named the way an ISP recognises them — where they sign
   in — and never as an endpoint. There is no free-text field anywhere on
   this screen, by design and not by omission: a typo in an address is a
   credential sent to a stranger, so an installation Devolada has not
   vetted is neither selectable nor reachable (FR-005). */
function InstallationPicker({
  value,
  onChange,
  disabled,
}: {
  value: InstallationKey;
  onChange: (key: InstallationKey) => void;
  disabled?: boolean;
}) {
  const selected = INSTALLATIONS.find((i) => i.key === value) ?? INSTALLATIONS[0];
  return (
    <Select value={value} onValueChange={(v) => onChange(v as InstallationKey)} disabled={disabled}>
      {/* The trigger renders the choice itself rather than `SelectValue`,
          so the test marker travels with it: seeing "Pruebas" only while
          the list is open is exactly how a live business connects to a
          sandbox without noticing (FR-007). */}
      <SelectTrigger id="wisphub-installation" className="mt-1">
        <span className="flex min-w-0 items-center gap-2">
          <span className="truncate">{selected.label}</span>
          {selected.kind === "test" && <StatusBadge status="installationTest" />}
        </span>
      </SelectTrigger>
      <SelectContent>
        {INSTALLATIONS.map((installation) => (
          <SelectItem key={installation.key} value={installation.key} textValue={installation.label}>
            <span className="flex items-center gap-2">
              {installation.label}
              {/* constitution VI: icon + text, never colour alone */}
              {installation.kind === "test" && <StatusBadge status="installationTest" />}
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/* settings D1/D2/D3, moved verbatim: write-only key, tested before it
   is saved, and a failed test never blocks the save.

   provider-address-per-isp US1 joins them: an address and a credential
   are one connection, and a key without the installation it belongs to
   is the failure this feature exists to end. */
function KeyCard({ wisphub }: { wisphub: WisphubIntegration }) {
  const save = useSaveIntegration();
  const [key, setKey] = useState("");
  /* Seeded with what is actually in use, not with the stored choice: a
     business that never chose still sees the truth, and saving turns
     that truth into a choice of its own (FR-004). */
  const [installation, setInstallation] = useState<InstallationKey>(
    wisphub.installation ?? wisphub.effectiveInstallation.key,
  );
  /* The patch waiting on a confirmation, or null when none is (T044). */
  const [pending, setPending] = useState<WisphubPatchRequest | null>(null);
  const inUse = wisphub.effectiveInstallation;
  const moved = installation !== inUse.key;

  /* T044: a key and an address are ONE connection, so they travel as one
     patch. Saving the key alone while the picker had moved sent it to be
     tested against the address the ISP was walking away from, and
     answered "wisphub.net rechazó esta llave" for a key that was
     perfectly good — the exact sentence this feature exists to stop
     showing, arriving through the panel's own button order. The API has
     accepted both in one patch since T017, and re-tests against the one
     being saved (FR-009); this is the screen catching up to its own
     contract. */
  const submit = (patch: WisphubPatchRequest) => {
    const full = moved ? { ...patch, installation } : patch;
    /* A business that already collects gets the question first, whether
       the installation moved on its own or rode along with a key. */
    if (moved && wisphub.configured) {
      setPending(full);
      return;
    }
    save.mutate(full);
  };

  const test = useMutation<WispHubTestResponse, ApiError, string | undefined>({
    mutationFn: (apiKey) =>
      api<WispHubTestResponse>("/integrations/wisphub/test", {
        method: "POST",
        body: JSON.stringify({
          ...(apiKey ? { apiKey } : {}),
          /* T045: while the pick differs from what is in use, the test is
             about the door on screen. Sending nothing means the stored
             one, which is what an unmoved picker wants. */
          ...(moved ? { installation } : {}),
        }),
      }),
  });
  const result = test.data;
  const savedTest = save.data?.wisphubTest;

  return (
    <SectionCard title="Conexión con WispHub">
      {/* FR-004: the installation in use carries the same weight as the
          key's tail — same block, same type, same emphasis. "Which
          WispHub am I on" is answered even for a business that never
          chose, because that is precisely the business most likely to be
          on the wrong one. */}
      <dl className="space-y-2 text-sm text-muted-foreground">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <dt>Instalación en uso:</dt>
          <dd className="flex flex-wrap items-center gap-2">
            <span className="font-medium text-foreground">{inUse.label}</span>
            {inUse.kind === "test" && <StatusBadge status="installationTest" />}
            {inUse.assumed && <StatusBadge status="installationAssumed" />}
          </dd>
        </div>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <dt>{wisphub.configured ? "Llave guardada:" : "Llave:"}</dt>
          <dd className="font-medium text-foreground">
            {wisphub.configured ? (
              <span className="font-mono">••••{wisphub.keyTail}</span>
            ) : (
              "sin conectar"
            )}
          </dd>
        </div>
      </dl>
      <p className="text-sm text-ink-soft">
        {inUse.assumed
          ? "Nadie eligió esta instalación: es la que Devolada usa por omisión. Si entras a WispHub en otra dirección, elígela abajo — tu llave solo sirve en la tuya."
          : !wisphub.configured
            ? /* cobros-in-links FR-014: the thing, not the retired section */
              "Con la llave, Devolada lee la deuda de tus clientes y tus cobros."
            : null}
      </p>
      <div>
        <Label htmlFor="wisphub-installation">¿Dónde entras a WispHub?</Label>
        <InstallationPicker value={installation} onChange={setInstallation} disabled={save.isPending} />
        {/* FR-006: the ISP whose installation is not listed is told so
            plainly and shown how to ask, instead of being left with a
            failing connection or an empty choice. */}
        <p className="mt-1 text-sm text-ink-soft">
          ¿No está la tuya? Devolada solo se conecta a las instalaciones que ya revisó, y agregar una
          es un cambio que hacemos nosotros. Escríbenos con la dirección donde entras y la agregamos.
        </p>
        {moved && (
          <div className="mt-2">
            {/* feedback-vocabulary-rollout D1/D4: the wait is announced at
                the control that started it. */}
            <Pending
              active={
                save.isPending &&
                save.variables?.installation !== undefined &&
                save.variables?.wisphubApiKey === undefined
              }
              label="Guardando la instalación."
            >
              <Button
                size="compact"
                variant="secondary"
                disabled={save.isPending}
                onClick={() => submit({})}
              >
                {save.isPending ? "Guardando…" : "Guardar instalación"}
              </Button>
            </Pending>
          </div>
        )}
        {/* Changing the installation of a business that already collects
            reaches the spec's *Deferred* outcomes, so it is a conscious
            act rather than a stray click (/speckit-analyze finding U1).
            The copy names what is NOT protected, in the ISP's terms. */}
        <AlertDialog open={pending !== null} onOpenChange={(open) => !open && setPending(null)}>
          <AlertDialogContent>
            <AlertDialogTitle>¿Cambiar a {INSTALLATIONS.find((i) => i.key === installation)?.label}?</AlertDialogTitle>
            <AlertDialogDescription>
              Devolada volverá a leer tus clientes desde esa instalación. Los que existan ahí con el
              mismo usuario conservan su link de pago. Los que no: su link sigue abierto y quien lo
              tenga guardado puede pagar, pero la reconexión fallará porque ese cliente no existe ahí
              — lo verás en la cola. Y si un usuario existe en la otra instalación pero es de otra
              persona, el link quedaría ligado a quien no es. Revisa tu lista de clientes después de
              cambiar.
            </AlertDialogDescription>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancelar</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => {
                  if (pending) save.mutate(pending);
                  setPending(null);
                }}
              >
                Cambiar instalación
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
      <div>
        <Label htmlFor="wisphub-key">Nueva llave</Label>
        <Input size="compact"
          id="wisphub-key"
          className="mt-1 font-mono"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          placeholder="01q9K2Rf.M02bG…"
          autoComplete="off"
        />
        <p className="mt-1 text-sm text-ink-soft">
          La llave nunca se muestra completa después de guardarla.
          {/* T044: the key save carries the pick, so the screen says so
              before the button is pressed rather than after. */}
          {moved &&
            ` Al guardarla también se guardará ${INSTALLATIONS.find((i) => i.key === installation)?.label} como tu instalación.`}
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        {/* feedback-vocabulary-rollout D1/D4: an action the operator started is
          announced at the control they used. Disabled plus a changed word is
          not a signal — it is silent to a screen reader and easy to miss. */}
        <Pending active={test.isPending} label="Probando la conexión.">
          <Button size="compact" variant="secondary" disabled={test.isPending} onClick={() => test.mutate(key.trim() || undefined)}>
            <KeyRound className="size-4" aria-hidden />
            {test.isPending ? "Probando…" : "Probar conexión"}
          </Button>
        </Pending>
        {/* feedback-vocabulary-rollout D1/D4: an action the operator started is
          announced at the control they used. Disabled plus a changed word is
          not a signal — it is silent to a screen reader and easy to miss. */}
        <Pending
          active={save.isPending && save.variables?.wisphubApiKey !== undefined}
          label="Guardando la llave."
        >
          <Button size="compact"
            disabled={save.isPending || key.trim().length < 8}
            onClick={() => submit({ wisphubApiKey: key.trim() })}
          >
            {save.isPending ? "Guardando…" : "Guardar llave"}
          </Button>
        </Pending>
      </div>
      {/* The result of the last test, typed or saved — save-then-test is
          the path an ISP actually uses, so the saved answer gets the same
          words as the typed one instead of a vaguer sentence (T029). */}
      {(result ?? savedTest) && <TestOutcome result={(result ?? savedTest)!} saved={!result} />}
      {test.error && (
        <p role="status" className="flex items-start gap-2 text-sm font-medium text-error">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
          {test.error.code === "WISPHUB_NOT_CONFIGURED"
            ? "Escribe una llave para probarla."
            : "No pudimos hacer la prueba ahora. Vuelve a intentar."}
        </p>
      )}
    </SectionCard>
  );
}

/* provider-address-per-isp US2 (FR-010/FR-011): three failures that must
   read as three different problems, each naming the installation tried.

   The line this replaces was "WispHub rechazó esta llave. Revísala en tu
   panel." — shown for all three, and wrong in the one case that matters
   most: a perfectly good key pointed at the wrong installation. An ISP
   who follows that advice goes and rotates a key that was never the
   problem. */
const OUTCOME_COPY: Record<
  WispHubTestResponse["outcome"],
  (installation: string) => { title: string; advice: string }
> = {
  OK: (installation) => ({
    title: `Conexión correcta con ${installation}.`,
    advice: "",
  }),
  INSTALLATION_UNREACHABLE: (installation) => ({
    title: `${installation} no respondió.`,
    /* Deliberately says nothing about the key: we learned nothing about
       it, and guessing is what the old single message did. */
    advice:
      "No es tu llave: no pudimos hablar con esa instalación. Puede ser algo pasajero — vuelve a probar en unos minutos, y si sigue igual avísanos.",
  }),
  KEY_REJECTED: (installation) => ({
    title: `${installation} rechazó esta llave.`,
    /* The installation first, the key second: a key is valid on ONE
       installation, so the wrong address is the likelier of the two and
       the cheaper to check. */
    advice:
      "Revisa primero la instalación: una llave solo sirve donde la generaste. Si entras a WispHub en otra dirección, elígela arriba y vuelve a probar. Si es la correcta, entonces sí revisa la llave en tu panel de WispHub.",
  }),
  PERMISSION_MISSING: (installation) => ({
    title: `Tu llave entra a ${installation}, pero le falta un permiso.`,
    advice:
      "La llave es válida. Al usuario que la generó le falta un permiso que Devolada necesita — agrégaselo en tu panel de WispHub y vuelve a probar.",
  }),
};

/* What each probe is, in the ISP's words. Never an endpoint. */
const READ_LABELS: Record<WispHubVerifiableRead, string> = {
  customers: "leer tus clientes",
  invoices: "leer tus facturas",
  payment_methods: "leer tus formas de pago",
};

/* D7: the four writes are never attempted, because each one writes into
   your real billing. Named here so a healthy connection never claims
   more than it proved. */
const WRITE_LABELS: Record<WispHubUnverifiableWrite, string> = {
  create_invoice: "crear una factura",
  register_payment: "registrar un pago",
  auto_activate: "activar la reconexión automática del cliente",
  payment_promise: "crear una promesa de pago",
};

function TestOutcome({ result, saved }: { result: WispHubTestResponse; saved: boolean }) {
  const copy = OUTCOME_COPY[result.outcome](result.triedInstallation.label);
  return (
    <div role="status" className="space-y-2 text-sm">
      <p
        className={cn(
          "flex items-start gap-2 font-medium",
          result.ok ? "text-success" : "text-error",
        )}
      >
        {result.ok ? (
          <CheckCircle2 className="mt-0.5 size-4 shrink-0" aria-hidden />
        ) : (
          <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
        )}
        <span>
          {saved && "Guardado. "}
          {copy.title}
        </span>
      </p>
      {copy.advice && <p className="text-ink-soft">{copy.advice}</p>}
      {result.verified.length > 0 && (
        <p className="text-ink-soft">
          Comprobamos que la llave puede {result.verified.map((r) => READ_LABELS[r]).join(", ")}.
        </p>
      )}
      {result.missingPermission && (
        <p className="text-ink-soft">
          El permiso que falta es el de {READ_LABELS[result.missingPermission]}.
        </p>
      )}
      {/* FR-011 as amended: the honest half. A connection is not claimed
          to prove what cannot be proven without writing into the ISP's
          live billing — those are exercised by the first real payment,
          where the cola de acciones already shows the outcome. */}
      {result.ok && (
        <p className="text-ink-soft">
          No comprobamos si la llave puede {Object.values(WRITE_LABELS).join(", ")}: hacerlo
          escribiría en tu facturación real. Esos permisos se prueban con el primer pago, y si
          alguno falta lo verás en la cola de acciones de ese pago.
        </p>
      )}
    </div>
  );
}

const ACTION_LABELS = {
  register_and_reconnect: "Registrar y reconectar",
  register_only: "Solo registrar",
} as const;
type Action = keyof typeof ACTION_LABELS;

function ActionSelect({
  id,
  value,
  onChange,
}: {
  id: string;
  value: Action;
  onChange: (a: Action) => void;
}) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v as Action)}>
      <SelectTrigger id={id} className="mt-1">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {(Object.keys(ACTION_LABELS) as Action[]).map((a) => (
          <SelectItem key={a} value={a}>
            {ACTION_LABELS[a]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/* D3: three fixed rows, two actions each — "nada" is not offered (money
   that arrived and goes unregistered makes the books lie). The
   threshold and floor live inside the short row, where they vote. */
function MappingCard({ wisphub }: { wisphub: WisphubIntegration }) {
  const save = useSaveIntegration();
  const [exact, setExact] = useState<Action>(wisphub.mapping.exact);
  const [short, setShort] = useState<Action>(wisphub.mapping.short);
  const [over, setOver] = useState<Action>(wisphub.mapping.over);
  const [percent, setPercent] = useState(String(wisphub.thresholdPercent));
  const [floor, setFloor] = useState(pesos(wisphub.floorCents));

  const pct = /^\d{1,3}$/.test(percent.trim()) ? Number.parseInt(percent.trim(), 10) : null;
  const floorCents = parseMoney(floor);
  const valid = pct !== null && pct <= 100 && floorCents !== null;

  const meaning =
    !valid || short !== "register_and_reconnect"
      ? null
      : pct === 0 && floorCents === 0
        ? "Cualquier pago reactiva el servicio."
        : `El servicio regresa cuando el pago cubre ${
            pct === 100 ? "todo el adeudo" : `al menos el ${pct}% del adeudo`
          }${floorCents > 0 ? ` y no es menor a ${formatMoney(floorCents)}` : ""}.`;

  return (
    <SectionCard title="Qué ejecuta cada clase">
      <p className="text-sm text-muted-foreground">
        Cada pago confirmado se clasifica (exacto, pago parcial, sobrante) y su clase decide la
        acción en WispHub. Un pago inválido o no encontrado nunca ejecuta nada.
      </p>
      <div className="space-y-4">
        <div>
          <Label htmlFor="map-exact">Exacto</Label>
          <ActionSelect id="map-exact" value={exact} onChange={setExact} />
        </div>
        <div className="rounded-md border border-border p-4">
          <Label htmlFor="map-short">Pago parcial</Label>
          <ActionSelect id="map-short" value={short} onChange={setShort} />
          {short === "register_and_reconnect" && (
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="map-percent">Porcentaje mínimo del adeudo</Label>
                <Input size="compact"
                  id="map-percent"
                  inputMode="numeric"
                  className="mt-1"
                  value={percent}
                  onChange={(e) => setPercent(e.target.value)}
                />
                <p className="mt-1 text-sm text-ink-soft">
                  100 significa solo con el pago completo; 0 reactiva con cualquier pago.
                </p>
              </div>
              <div>
                <Label htmlFor="map-floor">Mínimo en pesos</Label>
                <Input size="compact"
                  id="map-floor"
                  prefix="$"
                  inputMode="decimal"
                  className="mt-1"
                  value={floor}
                  onChange={(e) => setFloor(e.target.value)}
                />
                <p className="mt-1 text-sm text-ink-soft">
                  Evita que un pago simbólico reactive un adeudo grande. $0.00 lo desactiva.
                </p>
              </div>
            </div>
          )}
          {meaning && (
            <p className="mt-3 rounded-md border border-border bg-muted px-4 py-3 text-sm">
              {meaning}{" "}
              <span className="text-ink-soft">El cargo por servicio no cuenta para este cálculo.</span>
            </p>
          )}
        </div>
        <div>
          <Label htmlFor="map-over">Sobrante</Label>
          <ActionSelect id="map-over" value={over} onChange={setOver} />
        </div>
      </div>
      {!valid && (
        <p className="text-sm font-medium text-error">
          El porcentaje debe ser un número entero entre 0 y 100, y el mínimo un monto válido.
        </p>
      )}
      {/* feedback-vocabulary-rollout D1/D4: an action the operator started is
          announced at the control they used. Disabled plus a changed word is
          not a signal — it is silent to a screen reader and easy to miss. */}
      <Pending active={save.isPending} label="Guardando la integración.">
        <Button size="compact"
          disabled={!valid || save.isPending}
          onClick={() =>
            save.mutate({
              exactAction: exact,
              shortAction: short,
              overAction: over,
              thresholdPercent: pct!,
              floorCents: floorCents!,
            })
          }
        >
          {save.isPending ? "Guardando…" : "Guardar mapeo"}
        </Button>
      </Pending>
      {save.isSuccess && !save.isPending && (
        <p role="status" className="text-sm font-medium text-success">
          Guardado.
        </p>
      )}
    </SectionCard>
  );
}

/* D4 + D8: the two switches. They save on toggle — a gate should not
   wait behind a Save button. */
function SwitchesCard({ wisphub }: { wisphub: WisphubIntegration }) {
  const save = useSaveIntegration();
  return (
    <SectionCard title="Ejecución">
      <div className="flex items-start justify-between gap-4 rounded-md border border-border px-4 py-3">
        <div>
          <Label htmlFor="actions-enabled">Ejecutar acciones automáticamente</Label>
          <p className="mt-1 text-sm text-ink-soft">
            Apagado es <strong>modo observación</strong>: Devolada no escribe nada en WispHub — ni
            registra pagos ni reconecta — mientras sigue validando y clasificando. Tú ejecutas a
            mano, y cada fila de Pagos te dice qué habría hecho.
          </p>
        </div>
        {/* feedback-vocabulary-rollout D1/D4. Both switches share one save
            mutation, so `save.isPending` alone would breathe on both when the
            operator toggled one — three controls claiming a wait that belongs
            to a single one. `variables` names the switch that was hit. */}
        <Pending
          active={save.isPending && save.variables?.actionsEnabled !== undefined}
          label="Guardando la ejecución automática."
        >
          <Switch
            id="actions-enabled"
            checked={wisphub.actionsEnabled}
            disabled={save.isPending}
            onCheckedChange={(v) => save.mutate({ actionsEnabled: v })}
          />
        </Pending>
      </div>
      <div className="flex items-start justify-between gap-4 rounded-md border border-border px-4 py-3">
        <div>
          <Label htmlFor="provisional-release">Proteger el servicio mientras Banxico confirma</Label>
          <p className="mt-1 text-sm text-ink-soft">
            Cuando el comprobante trae evidencia de buena fe, el cliente suspendido se reconecta
            provisionalmente y el cliente al corriente no se corta mientras se valida su
            transferencia. En modo observación esta protección también se pausa.
          </p>
        </div>
        <Pending
          active={save.isPending && save.variables?.provisionalReleaseEnabled !== undefined}
          label="Guardando la protección del servicio."
        >
          <Switch
            id="provisional-release"
            checked={wisphub.provisionalReleaseEnabled}
            disabled={save.isPending}
            onCheckedChange={(v) => save.mutate({ provisionalReleaseEnabled: v })}
          />
        </Pending>
      </div>
    </SectionCard>
  );
}

export function WispHubScreen() {
  const integrations = useQuery<IntegrationsResponse, ApiError>({
    queryKey: ["integrations"],
    queryFn: () => api<IntegrationsResponse>("/integrations"),
  });

  return (
    <main className="max-w-3xl px-4 pt-4 lg:px-8 lg:pt-8">
      <Link to="/integrations" className="flex items-center gap-1 text-sm text-link hover:underline">
        <ArrowLeft className="size-4" aria-hidden /> Integraciones
      </Link>
      <h1 className="mt-2 text-xl font-semibold">WispHub</h1>

      {integrations.error && (
        <ListError
          what="la integración"
          onRetry={() => integrations.refetch()}
          className="mt-4"
        />
      )}
      {/* feedback-vocabulary-rollout D1/D5/D7: the region owns the wait. The shape
          holds the space while the threshold runs; `isPending` is the first
          load, never a refetch the operator did not start. */}
      <Pending
        active={integrations.isPending}
        label="Cargando la integración"
        shape={
          <div className="mt-4 space-y-4">
            <Skeleton className="h-40 w-full" />
            <Skeleton className="h-64 w-full" />
          </div>
        }
      >
        {integrations.data && (
          <div className="mt-4 space-y-4 pb-8">
            <KeyCard wisphub={integrations.data.wisphub} />
            <MappingCard key={JSON.stringify(integrations.data.wisphub.mapping)} wisphub={integrations.data.wisphub} />
            <SwitchesCard wisphub={integrations.data.wisphub} />
          </div>
        )}
      </Pending>
    </main>
  );
}
