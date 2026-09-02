import { Alert, Amount, Card, Skeleton, parseMoney } from "@devolada/ui";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Navigate } from "@tanstack/react-router";
import { BANKS } from "@devolada/api/settings-schema";
import type { BusinessesListResponse, PlatformBusinessRow, SettingsListResponse } from "@devolada/api/platform-schema";
import type { CreditEntriesResponse } from "@devolada/api/credit-schema";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { api, ApiError } from "@/lib/api";
import { formatTime } from "@/lib/datetime";
import { useDisplaySettings, useSession } from "../auth/session";
import { ENTRY_LABELS } from "../credit/CreditCard";
import { STEP_COPY } from "../credit/CreditChip";

/* /operador (operator-panel spec, US-L02): the platform's hands. Boring
   on purpose (IA). Two tabs — Reglas (D1's keys as typed fields with
   their history) and Negocios (D7's map, with the adjustment and override
   forms). The route is hidden unless the actor is the operator; the API
   guard is the real defense (D3). */

const KEY_LABELS: Record<string, string> = {
  validation_fee_cents: "Tarifa por validación",
  welcome_bonus_validations: "Bono de bienvenida (validaciones)",
  negative_cap_cents: "Tope de saldo negativo",
  topup_min_cents: "Mínimo de recarga",
  topup_clabe: "CLABE para recargas",
  topup_bank: "Banco de la CLABE",
  topup_beneficiary: "Beneficiario de la CLABE",
  default_timezone: "Zona horaria por defecto",
  default_tolerance_cents: "Tolerancia de conciliación por defecto",
  default_over_treatment: "Sobrante por defecto",
  default_fee_payer: "Quién paga el cargo por defecto",
};
const ENUM_OPTIONS: Record<string, { value: string; label: string }[]> = {
  default_over_treatment: [
    { value: "flag", label: "Se marca para devolver" },
    { value: "credit", label: "Queda a favor del cliente" },
  ],
  default_timezone: [
    { value: "America/Mexico_City", label: "Centro (Ciudad de México)" },
    { value: "America/Hermosillo", label: "Pacífico (Sonora)" },
    { value: "America/Tijuana", label: "Noroeste (Baja California)" },
  ],
  default_fee_payer: [
    { value: "isp", label: "El negocio absorbe el cargo" },
    { value: "customer", label: "El cliente paga el cargo" },
  ],
};

type Setting = SettingsListResponse["settings"][number];

function SettingField({ setting }: { setting: Setting }) {
  const queryClient = useQueryClient();
  const { timezone, timeFormat } = useDisplaySettings();
  const isCents = setting.type === "cents";
  const initial = setting.current ?? "";
  const [value, setValue] = useState(isCents && initial ? (Number(initial) / 100).toFixed(2) : initial);
  const save = useMutation<unknown, ApiError, string | number>({
    mutationFn: (v) => api(`/platform/settings/${setting.key}`, { method: "POST", body: JSON.stringify({ value: v }) }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["platform-settings"] }),
  });
  const outgoing: string | number | null = isCents ? parseMoney(value) : setting.type === "int" ? Number(value) : value.trim();
  const changed = String(outgoing ?? "") !== String(setting.current ?? "");
  const id = `setting-${setting.key}`;

  return (
    <div className="grid gap-2 border-b border-line-soft py-4 last:border-0 sm:grid-cols-[1fr_auto] sm:items-end">
      <div>
        <Label htmlFor={id}>{KEY_LABELS[setting.key] ?? setting.key}</Label>
        {setting.type === "bank" ? (
          <Select value={value} onValueChange={setValue}>
            <SelectTrigger id={id} className="mt-1" aria-label={KEY_LABELS[setting.key]}>
              <SelectValue placeholder="Elige el banco" />
            </SelectTrigger>
            <SelectContent>
              {[...BANKS].sort((a, b) => a.localeCompare(b, "es")).map((b) => (
                <SelectItem key={b} value={b}>
                  {b}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : setting.type === "enum" ? (
          <Select value={value} onValueChange={setValue}>
            <SelectTrigger id={id} className="mt-1" aria-label={KEY_LABELS[setting.key]}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(ENUM_OPTIONS[setting.key] ?? []).map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <Input
            id={id}
            className={`mt-1 ${setting.type === "clabe" ? "font-mono" : ""}`}
            prefix={isCents ? "$" : undefined}
            inputMode={isCents || setting.type === "int" || setting.type === "clabe" ? "decimal" : undefined}
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
        )}
        {setting.history.length > 0 && (
          <p className="mt-1 text-xs text-ink-soft">
            Última: {isCents ? `$${(Number(setting.history[0].value) / 100).toFixed(2)}` : setting.history[0].value} ·{" "}
            {formatTime(setting.history[0].createdAt, timeFormat, timezone)} · {setting.history.length} cambio
            {setting.history.length === 1 ? "" : "s"}
          </p>
        )}
        {save.error && <p className="mt-1 text-sm font-medium text-error">Valor no válido para esta regla.</p>}
      </div>
      <Button
        aria-label={`Guardar ${KEY_LABELS[setting.key] ?? setting.key}`}
        disabled={!changed || outgoing === null || outgoing === "" || save.isPending}
        onClick={() => outgoing !== null && save.mutate(outgoing)}
      >
        {save.isPending ? "Guardando…" : "Guardar"}
      </Button>
    </div>
  );
}

function RulesTab() {
  const settings = useQuery<SettingsListResponse, ApiError>({
    queryKey: ["platform-settings"],
    queryFn: () => api<SettingsListResponse>("/platform/settings"),
  });
  if (settings.isPending) return <Skeleton className="h-40 w-full" />;
  if (settings.error) return <Alert variant="destructive">No pudimos cargar las reglas.</Alert>;
  return (
    <Card className="p-6">
      {settings.data.settings.map((s) => (
        <SettingField key={`${s.key}-${s.current ?? ""}`} setting={s} />
      ))}
    </Card>
  );
}

function BusinessDetail({ row, onClose }: { row: PlatformBusinessRow; onClose: () => void }) {
  const queryClient = useQueryClient();
  const { timezone, timeFormat } = useDisplaySettings();
  const detail = useQuery<PlatformBusinessRow & CreditEntriesResponse, ApiError>({
    queryKey: ["platform-business", row.id],
    queryFn: () => api(`/platform/businesses/${row.id}`),
  });
  const [cents, setCents] = useState("");
  const [sign, setSign] = useState<"+" | "-">("+");
  const [reason, setReason] = useState("");
  const [override, setOverride] = useState(row.feeOverrideCents === null ? "" : (row.feeOverrideCents / 100).toFixed(2));
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["platform-business", row.id] });
    void queryClient.invalidateQueries({ queryKey: ["platform-businesses"] });
  };
  const adjust = useMutation<unknown, ApiError>({
    mutationFn: () =>
      api(`/platform/businesses/${row.id}/adjustments`, {
        method: "POST",
        body: JSON.stringify({ cents: (sign === "-" ? -1 : 1) * (parseMoney(cents) ?? 0), reason: reason.trim() }),
      }),
    onSuccess: () => {
      setCents("");
      setReason("");
      refresh();
    },
  });
  const patch = useMutation<unknown, ApiError>({
    mutationFn: () =>
      api(`/platform/businesses/${row.id}`, {
        method: "PATCH",
        body: JSON.stringify({ feeOverrideCents: override.trim() === "" ? null : parseMoney(override) }),
      }),
    onSuccess: refresh,
  });
  const adjustValid = (parseMoney(cents) ?? 0) > 0 && reason.trim().length >= 10;

  return (
    <Card className="space-y-4 p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-base font-semibold">{row.name}</h3>
          <p className="text-sm text-ink-soft">{row.email}</p>
        </div>
        <Button variant="outline" onClick={onClose}>
          Cerrar
        </Button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2 rounded-md border border-border p-4">
          <p className="text-sm font-medium">Ajustar saldo</p>
          <div className="flex gap-2">
            <Select value={sign} onValueChange={(v) => setSign(v as "+" | "-")}>
              <SelectTrigger className="w-20" aria-label="Signo del ajuste">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="+">+</SelectItem>
                <SelectItem value="-">−</SelectItem>
              </SelectContent>
            </Select>
            <Input aria-label="Monto del ajuste" prefix="$" inputMode="decimal" value={cents} onChange={(e) => setCents(e.target.value)} />
          </div>
          <Label htmlFor={`reason-${row.id}`}>Motivo (obligatorio)</Label>
          <Textarea id={`reason-${row.id}`} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Por qué, para quien lo lea después" />
          {adjust.error && <p className="text-sm font-medium text-error">No se guardó el ajuste.</p>}
          <Button disabled={!adjustValid || adjust.isPending} onClick={() => adjust.mutate()}>
            Registrar ajuste
          </Button>
        </div>
        <div className="space-y-2 rounded-md border border-border p-4">
          <Label htmlFor={`override-${row.id}`}>Tarifa negociada (vacío = global)</Label>
          <Input id={`override-${row.id}`} prefix="$" inputMode="decimal" value={override} onChange={(e) => setOverride(e.target.value)} />
          {patch.error && <p className="text-sm font-medium text-error">Tarifa fuera de rango.</p>}
          <Button variant="outline" disabled={patch.isPending} onClick={() => patch.mutate()}>
            Guardar tarifa
          </Button>
        </div>
      </div>

      {detail.data && (
        <ul className="divide-y divide-line-soft" aria-label="Movimientos del negocio">
          {detail.data.entries.map((e) => (
            <li key={e.id} className="flex items-baseline gap-3 py-2 text-sm">
              <span className="min-w-0 flex-1">
                {ENTRY_LABELS[e.kind]}
                {e.reason && <span className="ml-2 text-ink-soft">· {e.reason}</span>}
              </span>
              <span className="shrink-0 text-ink-soft">{formatTime(e.createdAt, timeFormat, timezone)}</span>
              <span className="shrink-0 font-medium">{e.cents > 0 ? "+" : ""}<Amount cents={e.cents} /></span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function BusinessesTab() {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<PlatformBusinessRow | null>(null);
  const list = useQuery<BusinessesListResponse, ApiError>({
    queryKey: ["platform-businesses", q],
    queryFn: () => api<BusinessesListResponse>(`/platform/businesses${q ? `?q=${encodeURIComponent(q)}` : ""}`),
  });
  return (
    <div className="space-y-4">
      <Input type="search" aria-label="Buscar negocio" placeholder="Nombre o correo del dueño" value={q} onChange={(e) => setQ(e.target.value)} />
      {list.isPending && <Skeleton className="h-24 w-full" />}
      {list.error && <Alert variant="destructive">No pudimos cargar los negocios.</Alert>}
      {open && <BusinessDetail row={open} onClose={() => setOpen(null)} />}
      {list.data && (
        <Card className="p-0">
          <ul className="divide-y divide-line-soft">
            {list.data.businesses.length === 0 && <li className="p-4 text-sm text-ink-soft">Sin negocios con ese nombre o correo.</li>}
            {list.data.businesses.map((b) => {
              const step = STEP_COPY[b.step];
              const Icon = step.icon;
              return (
                <li key={b.id}>
                  <button type="button" className="flex w-full items-center gap-4 p-4 text-left hover:bg-muted" onClick={() => setOpen(b)}>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium">{b.name}</span>
                      <span className="block text-sm text-ink-soft">{b.email}</span>
                    </span>
                    <span className={`flex items-center gap-1 text-sm ${step.tone}`}>
                      <Icon className="size-4" aria-hidden />
                      {step.label}
                    </span>
                    <Amount cents={b.balanceCents} className="w-24 text-right text-sm font-semibold" />
                    {/* design-review 2026-09-01 (should fix): the override
                        was a bare asterisk — a riddle three months later.
                        The effective fee shows, worded. */}
                    <span className="w-24 text-right text-sm text-ink-soft">
                      <Amount cents={b.feeOverrideCents ?? b.feeCents} />
                      {b.feeOverrideCents !== null && (
                        <span className="block text-xs">negociada</span>
                      )}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </Card>
      )}
    </div>
  );
}

export function OperatorScreen() {
  const { data: actor } = useSession();
  if (actor && !actor.platformOperator) return <Navigate to="/" />;
  return (
    <main className="max-w-4xl px-4 pt-4 lg:px-8 lg:pt-8">
      <h1 className="text-xl font-semibold">Operador</h1>
      <Tabs defaultValue="rules" className="mt-4">
        <TabsList>
          <TabsTrigger value="rules">Reglas</TabsTrigger>
          <TabsTrigger value="businesses">Negocios</TabsTrigger>
        </TabsList>
        <TabsContent value="rules" className="mt-4">
          <RulesTab />
        </TabsContent>
        <TabsContent value="businesses" className="mt-4">
          <BusinessesTab />
        </TabsContent>
      </Tabs>
    </main>
  );
}
