import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, KeyRound, TriangleAlert } from "lucide-react";
import { Card, Skeleton, formatMoney, parseMoney } from "@devolada/ui";
import type {
  SettingsPatchRequest,
  SettingsResponse,
  WispHubTestResponse,
} from "@devolada/api/settings-schema";
import { TIMEZONES } from "@devolada/api/settings-schema";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { api, ApiError } from "@/lib/api";
import { formatTime, SAMPLE_TIME_MS } from "@/lib/datetime";

/* Configuración (US-A04): the WispHub key, the money split, and the two
   display settings that decide what "today" and "2:30 p.m." mean. */

const pesos = (cents: number) => (cents / 100).toFixed(2);

function useSaveSettings() {
  const queryClient = useQueryClient();
  return useMutation<SettingsResponse, ApiError, SettingsPatchRequest>({
    mutationFn: (body) =>
      api<SettingsResponse>("/settings", { method: "PATCH", body: JSON.stringify(body) }),
    onSuccess: (data) => {
      queryClient.setQueryData(["settings"], data);
      /* The session carries timezone, format and the key flag (D7) */
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

/* D1/D2/D3: the key is write-only, tested before it is saved, and a
   failed test never blocks the save — it only tells the ISP. */
function WispHubCard({ settings }: { settings: SettingsResponse }) {
  const save = useSaveSettings();
  const [key, setKey] = useState("");

  const test = useMutation<WispHubTestResponse, ApiError, string | undefined>({
    mutationFn: (apiKey) =>
      api<WispHubTestResponse>("/settings/wisphub/test", {
        method: "POST",
        body: JSON.stringify(apiKey ? { apiKey } : {}),
      }),
  });

  const result = test.data;
  const savedTest = save.data?.wisphubTest;

  return (
    <SectionCard title="Conexión con WispHub">
      <p className="text-sm text-muted-foreground">
        {settings.wisphub.configured ? (
          <>
            Llave guardada:{" "}
            <span className="font-mono text-foreground">••••{settings.wisphub.keyTail}</span>
          </>
        ) : (
          "Sin configurar. Sin la llave no podemos reconectar a los clientes."
        )}
      </p>

      <div>
        <Label htmlFor="wisphub-key">Nueva llave (API Key)</Label>
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
        <Button
          variant="outline"
          disabled={test.isPending}
          onClick={() => test.mutate(key.trim() || undefined)}
        >
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
              Conexión correcta. WispHub respondió con {result.sampleCustomerCount} cliente(s) de
              prueba.
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

/* D4: the platform share is the difference, computed while typing */
function MoneyCard({ settings }: { settings: SettingsResponse }) {
  const save = useSaveSettings();
  const [fee, setFee] = useState(pesos(settings.serviceFeeCents));
  const [commission, setCommission] = useState(pesos(settings.storeCommissionCents));

  const feeCents = parseMoney(fee);
  const commissionCents = parseMoney(commission);
  const valid = feeCents !== null && commissionCents !== null && commissionCents <= feeCents;
  const share = valid ? feeCents - commissionCents : null;

  return (
    <SectionCard title="Cobro y comisiones">
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="service-fee">Cargo por servicio</Label>
          {/* design-review D8: money fields carry the sign */}
          <Input
            id="service-fee"
            prefix="$"
            inputMode="decimal"
            className="mt-1"
            value={fee}
            onChange={(e) => setFee(e.target.value)}
          />
          <p className="mt-1 text-sm text-ink-soft">Lo que paga el cliente además de su mensualidad.</p>
        </div>
        <div>
          <Label htmlFor="store-commission">Comisión de la tienda</Label>
          <Input
            id="store-commission"
            prefix="$"
            inputMode="decimal"
            className="mt-1"
            value={commission}
            onChange={(e) => setCommission(e.target.value)}
          />
          <p className="mt-1 text-sm text-ink-soft">Lo que gana la tienda por cada cobro.</p>
        </div>
      </div>

      <p className="rounded-md border border-border bg-muted px-4 py-3 text-sm">
        {valid ? (
          <>
            Para la plataforma quedan{" "}
            <span className="font-semibold text-foreground">{formatMoney(share!)}</span> por cobro.
          </>
        ) : (
          <span className="font-medium text-error">
            La comisión de la tienda no puede ser mayor al cargo por servicio.
          </span>
        )}
      </p>

      <Button
        disabled={!valid || save.isPending}
        onClick={() =>
          save.mutate({ serviceFeeCents: feeCents!, storeCommissionCents: commissionCents! })
        }
      >
        {save.isPending ? "Guardando…" : "Guardar cobro y comisiones"}
      </Button>
      {save.isSuccess && !save.isPending && (
        <p role="status" className="text-sm font-medium text-success">
          Guardado.
        </p>
      )}
    </SectionCard>
  );
}

/* D5/D6: where the day starts, and how a time reads */
function DisplayCard({ settings }: { settings: SettingsResponse }) {
  const save = useSaveSettings();
  const [timezone, setTimezone] = useState<string>(settings.timezone);
  const [timeFormat, setTimeFormat] = useState<string>(settings.timeFormat);

  useEffect(() => {
    setTimezone(settings.timezone);
    setTimeFormat(settings.timeFormat);
  }, [settings.timezone, settings.timeFormat]);

  const changed = timezone !== settings.timezone || timeFormat !== settings.timeFormat;

  return (
    <SectionCard title="Zona horaria y hora">
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="timezone">Zona horaria</Label>
          <Select value={timezone} onValueChange={setTimezone}>
            <SelectTrigger id="timezone" className="mt-1" aria-label="Zona horaria">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TIMEZONES.map((tz) => (
                <SelectItem key={tz.value} value={tz.value}>
                  {tz.label} · {tz.utc}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="mt-1 text-sm text-ink-soft">
            Decide dónde empieza tu día: los totales de hoy y las fechas de los movimientos.
          </p>
        </div>

        <div>
          <Label htmlFor="time-format">Formato de hora</Label>
          <Select value={timeFormat} onValueChange={setTimeFormat}>
            <SelectTrigger id="time-format" className="mt-1" aria-label="Formato de hora">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="12h">12 horas</SelectItem>
              <SelectItem value="24h">24 horas</SelectItem>
            </SelectContent>
          </Select>
          <p className="mt-1 text-sm text-ink-soft">
            Así se verá: {formatTime(SAMPLE_TIME_MS, timeFormat === "24h" ? "24h" : "12h", timezone)}
          </p>
        </div>
      </div>

      <Button
        disabled={!changed || save.isPending}
        onClick={() =>
          save.mutate({
            timezone: timezone as SettingsPatchRequest["timezone"],
            timeFormat: timeFormat as SettingsPatchRequest["timeFormat"],
          })
        }
      >
        {save.isPending ? "Guardando…" : "Guardar zona y formato"}
      </Button>
    </SectionCard>
  );
}

export function SettingsScreen() {
  const { data, isPending } = useQuery<SettingsResponse, ApiError>({
    queryKey: ["settings"],
    queryFn: () => api<SettingsResponse>("/settings"),
  });

  return (
    <main className="max-w-3xl px-4 pt-4 lg:px-8 lg:pt-8">
      <h1 className="text-xl font-semibold">Configuración</h1>

      {isPending && (
        <div className="mt-4 space-y-4">
          {[0, 1, 2].map((k) => (
            <Card key={k} className="space-y-3 p-6">
              <Skeleton className="h-5 w-48" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-40" />
            </Card>
          ))}
        </div>
      )}

      {data && (
        <div className="mt-4 space-y-4 pb-8">
          <WispHubCard settings={data} />
          <MoneyCard settings={data} />
          <DisplayCard settings={data} />
        </div>
      )}
    </main>
  );
}
