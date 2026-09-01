import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, KeyRound, TriangleAlert } from "lucide-react";
import { Amount, Card, Skeleton, formatMoney, parseMoney } from "@devolada/ui";
import type {
  SettingsPatchRequest,
  SettingsResponse,
  WispHubTestResponse,
} from "@devolada/api/settings-schema";
import { PasskeyCard } from "../auth/PasskeyCard";
import { BANKS, TIMEZONES } from "@devolada/api/settings-schema";
import { roleCan, type Role } from "@devolada/api/role-matrix";
import { useSession } from "../auth/session";
import { UsersCard } from "./UsersCard";
import type { Bank } from "@devolada/api/settings-schema";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
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

/* The general service fee. With the store network retired it survives
   as the fallback the SPEI fee inherits when unset (direct-payment D3). */
function MoneyCard({ settings }: { settings: SettingsResponse }) {
  const save = useSaveSettings();
  const [fee, setFee] = useState(pesos(settings.serviceFeeCents));

  const feeCents = parseMoney(fee);
  const valid = feeCents !== null;

  return (
    <SectionCard title="Cargo por servicio">
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
        <p className="mt-1 text-sm text-ink-soft">
          Lo que paga el cliente además de su cargo del periodo. El pago
          directo por SPEI usa este monto cuando no tiene uno propio.
        </p>
      </div>

      <Button
        disabled={!valid || save.isPending}
        onClick={() => save.mutate({ serviceFeeCents: feeCents! })}
      >
        {save.isPending ? "Guardando…" : "Guardar cargo por servicio"}
      </Button>
      {save.isSuccess && !save.isPending && (
        <p role="status" className="text-sm font-medium text-success">
          Guardado.
        </p>
      )}
    </SectionCard>
  );
}

/* Pago directo por SPEI (direct-payment spec, US-D05). D4: the account
   is the ISP's own — the money never touches Devolada. D3: the SPEI fee
   is separate; empty falls back to the store fee. */
function SpeiCard({ settings, canEditClabe }: { settings: SettingsResponse; canEditClabe: boolean }) {
  const save = useSaveSettings();
  const [clabe, setClabe] = useState(settings.spei.clabe ?? "");
  /* D16: the picker's own type — the API takes a name from the vocabulary
     or nothing, and "" is what "not configured yet" looks like here. */
  const [bank, setBank] = useState<Bank | "">((settings.spei.bank as Bank | null) ?? "");
  const [beneficiary, setBeneficiary] = useState(settings.spei.beneficiaryName ?? "");
  const [fee, setFee] = useState(
    settings.spei.serviceFeeCents === null ? "" : pesos(settings.spei.serviceFeeCents),
  );

  const clabeValid = /^\d{18}$/.test(clabe.trim());
  /* Empty = clear: fall back to the store fee (D3) */
  const feeCents = fee.trim() === "" ? null : parseMoney(fee);
  const feeValid = fee.trim() === "" || feeCents !== null;
  /* claimed-amount D5: the beneficiary name is recommended, not required —
     empty is a valid configuration, and the API takes ≥3 chars or null */
  const beneficiaryValid = beneficiary.trim() === "" || beneficiary.trim().length >= 3;
  const valid = (canEditClabe ? clabeValid : true) && bank.trim().length >= 2 && beneficiaryValid && feeValid;

  return (
    <SectionCard title="Pago directo por SPEI">
      <p className="text-sm text-muted-foreground">
        {settings.spei.configured
          ? "Tus clientes con banco pueden pagar por transferencia desde su link de pago."
          : "Aún no está activo. Con tu CLABE, tus clientes con banco podrán pagar por transferencia."}
      </p>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Label htmlFor="spei-clabe">CLABE</Label>
          {canEditClabe ? (
            <Input
              id="spei-clabe"
              className="mt-1 font-mono"
              inputMode="numeric"
              maxLength={18}
              value={clabe}
              onChange={(e) => setClabe(e.target.value)}
              placeholder="18 dígitos"
              autoComplete="off"
            />
          ) : (
            /* business-and-memberships D3: the CLABE is the owner's area.
               An admin sees it (it is their business's account) and
               changes everything around it — the field is not offered. */
            <p id="spei-clabe" className="mt-1 font-mono text-sm">
              {settings.spei.clabe ?? "Sin configurar"}
            </p>
          )}
          {canEditClabe && clabe.trim() !== "" && !clabeValid && (
            <p className="mt-1 text-sm font-medium text-error">La CLABE debe tener 18 dígitos.</p>
          )}
          <p className="mt-1 text-sm text-ink-soft">
            La cuenta donde recibes las transferencias. El dinero llega directo a ti.
          </p>
        </div>
        <div>
          <Label htmlFor="spei-bank">Banco</Label>
          {settings.spei.bankUnknown && (
            /* BUG-008: the bank was saved before the list existed and no
               longer resolves, so the channel is closed until it is picked
               again. Silence here meant every payment failing invisibly. */
            <p role="status" className="mt-1 flex items-start gap-2 text-sm text-danger">
              <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
              <span>
                El banco guardado (<strong>{settings.spei.bank}</strong>) ya no está en la lista, así
                que los pagos por transferencia están desactivados. Elígelo de nuevo para
                reactivarlos.
              </span>
            </p>
          )}
          {/* D16: this name travels as `beneficiary.bank` on every
              validation this ISP ever runs, so a value the provider does
              not recognise does not lose one payment — it loses all of
              them, and silently: apiCEP answers `invalid`, never an error.
              Typed free-hand this said "STP, BBVA, Banorte…", and two of
              those three are not names it accepts. */}
          <Select value={bank} onValueChange={(v) => setBank(v as Bank)}>
            <SelectTrigger id="spei-bank" className="mt-1" aria-label="Banco">
              <SelectValue placeholder="Elige tu banco" />
            </SelectTrigger>
            <SelectContent>
              {[...BANKS]
                .sort((a, b) => a.localeCompare(b, "es-MX"))
                .map((b) => (
                  <SelectItem key={b} value={b}>
                    {b}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label htmlFor="spei-beneficiary">Nombre del beneficiario (opcional)</Label>
          <Input
            id="spei-beneficiary"
            className="mt-1"
            value={beneficiary}
            onChange={(e) => setBeneficiary(e.target.value)}
            placeholder="Como aparece en tu cuenta"
          />
          <p className="mt-1 text-sm text-ink-soft">
            Recomendado: es lo que tu cliente compara antes de transferir.
          </p>
        </div>
        <div>
          <Label htmlFor="spei-fee">Cargo por servicio SPEI</Label>
          <Input
            id="spei-fee"
            prefix="$"
            inputMode="decimal"
            className="mt-1"
            value={fee}
            onChange={(e) => setFee(e.target.value)}
            placeholder={pesos(settings.serviceFeeCents)}
          />
          <p className="mt-1 text-sm text-ink-soft">
            Vacío usa el cargo por servicio general ({formatMoney(settings.serviceFeeCents)}).
          </p>
        </div>
      </div>

      <Button
        disabled={!valid || save.isPending}
        onClick={() =>
          save.mutate({
            ...(canEditClabe ? { speiClabe: clabe.trim() } : {}),
            speiBank: bank === "" ? null : bank,
            /* D5: empty clears — the API takes ≥3 chars or null */
            speiBeneficiaryName: beneficiary.trim() === "" ? null : beneficiary.trim(),
            speiServiceFeeCents: feeCents,
          })
        }
      >
        {save.isPending ? "Guardando…" : "Guardar pago directo"}
      </Button>
      {save.isSuccess && !save.isPending && (
        <p role="status" className="text-sm font-medium text-success">
          Guardado.
        </p>
      )}
    </SectionCard>
  );
}

/* Reconexión con pago incompleto (partial-payment D2/D4, US-D10): one
   percentage and one floor, both must hold. Like the money card, the
   screen computes what the numbers mean instead of describing them —
   this is the arithmetic D3 says the owner has to look at before
   choosing (the founding case, $499 of $649, is 77%). */
function ReconnectionCard({ settings }: { settings: SettingsResponse }) {
  const save = useSaveSettings();
  const [percent, setPercent] = useState(String(settings.reconnection.thresholdPercent));
  const [floor, setFloor] = useState(pesos(settings.reconnection.floorCents));
  const [provisional, setProvisional] = useState(settings.reconnection.provisionalReleaseEnabled);

  const pct = /^\d{1,3}$/.test(percent.trim()) ? Number.parseInt(percent.trim(), 10) : null;
  const floorCents = parseMoney(floor);
  const valid = pct !== null && pct <= 100 && floorCents !== null;

  /* The one-line explanation the spec asks for, computed from the values
     on screen so it is never out of date. */
  const meaning =
    !valid
      ? null
      : pct === 0 && floorCents === 0
        ? "Cualquier pago reactiva el servicio."
        : `El servicio regresa cuando el pago cubre ${
            pct === 100 ? "todo el adeudo" : `al menos el ${pct}% del adeudo`
          }${floorCents > 0 ? ` y no es menor a ${formatMoney(floorCents)}` : ""}.`;

  return (
    <SectionCard title="Reconexión con pago incompleto">
      <p className="text-sm text-muted-foreground">
        Cuando una transferencia no cubre todo el adeudo, estos límites deciden si el servicio se
        reactiva. El pago se registra siempre.
      </p>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="reconnection-percent">Porcentaje mínimo del adeudo</Label>
          <Input
            id="reconnection-percent"
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
          <Label htmlFor="reconnection-floor">Mínimo en pesos</Label>
          <Input
            id="reconnection-floor"
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

      <p className="rounded-md border border-border bg-muted px-4 py-3 text-sm">
        {meaning ? (
          <span>
            {meaning}{" "}
            <span className="text-ink-soft">El cargo por servicio no cuenta para este cálculo.</span>
          </span>
        ) : (
          <span className="font-medium text-error">
            El porcentaje debe ser un número entero entre 0 y 100, y el mínimo un monto válido.
          </span>
        )}
      </p>

      {/* provisional-release D10 (US-D15): one switch, no dials. The rule
          is fixed and reasoned in the spec; the threshold and floor above
          apply to it unchanged, so the ISP keeps ONE reconnection policy. */}
      <div className="flex items-start justify-between gap-4 rounded-md border border-border px-4 py-3">
        <div>
          <Label htmlFor="provisional-release">Proteger el servicio mientras Banxico confirma</Label>
          <p className="mt-1 text-sm text-ink-soft">
            Cuando el comprobante trae evidencia de buena fe, el cliente suspendido se reconecta
            provisionalmente y el cliente al corriente no se corta mientras se valida su
            transferencia. Si Banxico no la confirma, el corte vuelve a aplicar y ese cliente
            pierde esta vía rápida por 90 días.
          </p>
        </div>
        {/* The accessible name comes from the Label above via htmlFor —
            an aria-label here would override that association instead of
            adding to it */}
        <Switch id="provisional-release" checked={provisional} onCheckedChange={setProvisional} />
      </div>

      <Button
        disabled={!valid || save.isPending}
        onClick={() =>
          save.mutate({
            reconnectionThresholdPercent: pct!,
            reconnectionFloorCents: floorCents!,
            provisionalReleaseEnabled: provisional,
          })
        }
      >
        {save.isPending ? "Guardando…" : "Guardar reconexión"}
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
  /* business-and-memberships D3: cards render by area — a role that
     cannot use a section does not see it (the brief's law: hide, never
     disable). The passkey is the user's own and shows for every role. */
  const { data: actor } = useSession();
  const role: Role = actor?.role ?? "viewer";
  const canSettings = roleCan(role, "settings", "update");
  const canClabe = roleCan(role, "clabe", "update");
  const canMembers = roleCan(role, "members", "invite_below_admin");

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
          {canSettings && <WispHubCard settings={data} />}
          {canSettings && <MoneyCard settings={data} />}
          {canSettings && <SpeiCard settings={data} canEditClabe={canClabe} />}
          {canSettings && <ReconnectionCard settings={data} />}
          {canSettings && <DisplayCard settings={data} />}
          {canMembers && actor && <UsersCard role={role} selfUserId={actor.userId} />}
          <PasskeyCard />
        </div>
      )}
    </main>
  );
}
