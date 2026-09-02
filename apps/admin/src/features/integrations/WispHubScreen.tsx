import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ArrowLeft, CheckCircle2, KeyRound, TriangleAlert } from "lucide-react";
import { Alert, Card, Skeleton, formatMoney, parseMoney } from "@devolada/ui";
import type {
  IntegrationsResponse,
  WisphubIntegration,
  WisphubPatchRequest,
  WispHubTestResponse,
} from "@devolada/api/integrations-schema";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { api, ApiError } from "@/lib/api";

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

/* settings D1/D2/D3, moved verbatim: write-only key, tested before it
   is saved, and a failed test never blocks the save. */
function KeyCard({ wisphub }: { wisphub: WisphubIntegration }) {
  const save = useSaveIntegration();
  const [key, setKey] = useState("");

  const test = useMutation<WispHubTestResponse, ApiError, string | undefined>({
    mutationFn: (apiKey) =>
      api<WispHubTestResponse>("/integrations/wisphub/test", {
        method: "POST",
        body: JSON.stringify(apiKey ? { apiKey } : {}),
      }),
  });
  const result = test.data;
  const savedTest = save.data?.wisphubTest;

  return (
    <SectionCard title="Llave (API Key)">
      <p className="text-sm text-muted-foreground">
        {wisphub.configured ? (
          <>
            Llave guardada: <span className="font-mono text-foreground">••••{wisphub.keyTail}</span>
          </>
        ) : (
          "Sin conectar. Con la llave, Devolada lee la deuda de tus clientes y tus Cobros."
        )}
      </p>
      <div>
        <Label htmlFor="wisphub-key">Nueva llave</Label>
        <Input
          id="wisphub-key"
          className="mt-1 font-mono"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          placeholder="01q9K2Rf.M02bG…"
          autoComplete="off"
        />
        <p className="mt-1 text-sm text-ink-soft">
          La llave nunca se muestra completa después de guardarla.
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" disabled={test.isPending} onClick={() => test.mutate(key.trim() || undefined)}>
          <KeyRound className="size-4" aria-hidden />
          {test.isPending ? "Probando…" : "Probar conexión"}
        </Button>
        <Button
          disabled={save.isPending || key.trim().length < 8}
          onClick={() => save.mutate({ wisphubApiKey: key.trim() })}
        >
          {save.isPending ? "Guardando…" : "Guardar llave"}
        </Button>
      </div>
      {result && (
        <p
          role="status"
          className={`flex items-start gap-2 text-sm font-medium ${result.ok ? "text-success" : "text-error"}`}
        >
          {result.ok ? (
            <>
              <CheckCircle2 className="mt-0.5 size-4 shrink-0" aria-hidden />
              Conexión correcta. WispHub respondió con {result.sampleCustomerCount} cliente(s) de prueba.
            </>
          ) : (
            <>
              <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
              {result.code === "WISPHUB_AUTH_FAILED"
                ? "WispHub rechazó esta llave. Revísala en tu panel."
                : result.code === "WISPHUB_NOT_CONFIGURED"
                  ? "Escribe una llave para probarla."
                  : "No pudimos hablar con WispHub ahora. Puede ser una falla temporal."}
            </>
          )}
        </p>
      )}
      {savedTest && !result && (
        <p role="status" className="text-sm font-medium text-muted-foreground">
          {savedTest.ok
            ? "Llave guardada y probada."
            : "Llave guardada, pero la prueba falló. Puedes volver a probarla."}
        </p>
      )}
    </SectionCard>
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
                <Input
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
                <Input
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
      <Button
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
        <Switch
          id="actions-enabled"
          checked={wisphub.actionsEnabled}
          disabled={save.isPending}
          onCheckedChange={(v) => save.mutate({ actionsEnabled: v })}
        />
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
        <Switch
          id="provisional-release"
          checked={wisphub.provisionalReleaseEnabled}
          disabled={save.isPending}
          onCheckedChange={(v) => save.mutate({ provisionalReleaseEnabled: v })}
        />
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

      {integrations.isPending && (
        <div className="mt-4 space-y-4">
          <Skeleton className="h-40 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      )}
      {integrations.error && (
        <Alert variant="destructive" className="mt-4">
          No pudimos cargar la integración.{" "}
          <button type="button" className="underline" onClick={() => void integrations.refetch()}>
            Reintentar
          </button>
        </Alert>
      )}
      {integrations.data && (
        <div className="mt-4 space-y-4 pb-8">
          <KeyCard wisphub={integrations.data.wisphub} />
          <MappingCard key={JSON.stringify(integrations.data.wisphub.mapping)} wisphub={integrations.data.wisphub} />
          <SwitchesCard wisphub={integrations.data.wisphub} />
        </div>
      )}
    </main>
  );
}
