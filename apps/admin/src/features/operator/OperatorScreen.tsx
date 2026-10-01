import { Alert, Amount, Button, Card, Input, parseMoney, Pending, Skeleton } from "@devolada/ui";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Navigate } from "@tanstack/react-router";
import {
  RECEIPT_PLACEHOLDERS,
  RECEIPT_PLACEHOLDER_HELP,
  RECEIPT_TEMPLATE_MAX,
  RECEIPT_TEMPLATE_MIN,
  STORE_CHANNEL_CAPABILITIES,
  receiptTemplateProblem,
  renderReceipt,
  type BusinessesListResponse,
  type PlatformBusinessRow,
  type ProviderQuotaResponse,
  type SettingsListResponse,
} from "@devolada/api/platform-schema";
import type { CreditEntriesResponse } from "@devolada/api/credit-schema";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Combobox } from "@/components/ui/combobox";
import { BANK_OPTIONS } from "@/lib/banks";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { api, ApiError } from "@/lib/api";
import { formatAgo, formatDateTime, formatTime } from "@/lib/datetime";
import { cn } from "@/lib/utils";
import { useDisplaySettings, useSession } from "../auth/session";
import { ENTRY_LABELS } from "../credit/CreditCard";
import { STEP_COPY } from "../credit/CreditChip";
import { LandingTab } from "./LandingTab";
import { ReaderTab } from "./ReaderTab";
import { StoresTab } from "./StoresTab";
import { Switch } from "@/components/ui/switch";

/* /operador (operator-panel spec, US-L02): the platform's hands. Boring
   on purpose (IA). Five tabs — Tiendas (cash-at-stores FR-001: the store
   network) beside Reglas (D1's keys as typed fields with
   their history, under the provider's remaining calls —
   payment-without-receipt D19), Negocios (D7's map, with the adjustment
   and override forms), Landing (landing-page D17: the page's counts and requests) and
   Lector (receipt-reader-tuning D19: the model that reads receipts, its
   test bench and the results that pick it). The route is hidden unless the actor is the operator; the API guard is
   the real defense (D3). */

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
  support_whatsapp: "WhatsApp de soporte (con lada, solo dígitos)",
  support_email: "Correo de soporte",
  /* cash-at-stores D22, D31 */
  store_fee_cents: "Cargo por servicio en tiendas",
  store_receipt_template: "Mensaje del comprobante (WhatsApp)",
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

/* cash-at-stores D31: what the preview fills a draft with */
const SAMPLE_RECEIPT = {
  negocio: "WiFi Plus",
  tienda: "Abarrotes Lupita",
  folio: "DV-7K2Q9M",
  cliente: "Guadalupe Reyes",
  montoCents: 50000,
  cargoCents: 1500,
  pendienteCents: 29800,
  at: Date.UTC(2026, 9, 1, 20, 35),
  timezone: "America/Mexico_City",
  timeFormat: "12h" as const,
  estado: "Tu pago quedó registrado. Como no cubre todo tu adeudo, tu servicio sigue sin reactivarse.",
};

/* cash-at-stores D31 (FR-043): the receipt's message — a text area, the
   placeholders listed, a live preview with sample data, and the API's own
   three checks named before the save (one rule, `receiptTemplateProblem`) */
function TemplateField({ setting }: { setting: Setting }) {
  const queryClient = useQueryClient();
  const { timezone, timeFormat } = useDisplaySettings();
  const [value, setValue] = useState(setting.current ?? "");
  const save = useMutation<unknown, ApiError, string>({
    mutationFn: (v) => api(`/platform/settings/${setting.key}`, { method: "POST", body: JSON.stringify({ value: v }) }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["platform-settings"] }),
  });
  const problem = receiptTemplateProblem(value);
  const problemCopy =
    problem?.kind === "length"
      ? `El mensaje debe tener de ${RECEIPT_TEMPLATE_MIN} a ${RECEIPT_TEMPLATE_MAX} caracteres.`
      : problem?.kind === "missing_folio"
        ? "Falta {folio}: el comprobante necesita el folio."
        : problem?.kind === "unknown_placeholder"
          ? `No conocemos {${problem.name}}. Usa solo los marcadores de la lista.`
          : null;
  const changed = value.trim() !== (setting.current ?? "").trim();
  const id = `setting-${setting.key}`;
  return (
    <div className="space-y-2 border-b border-line-soft py-4 last:border-0">
      <Label htmlFor={id}>{KEY_LABELS[setting.key] ?? setting.key}</Label>
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-2">
          <Textarea id={id} rows={14} className="font-mono text-sm" value={value} onChange={(e) => setValue(e.target.value)} aria-describedby={`${id}-help`} />
          {problemCopy && (
            <p role="alert" className="text-sm font-medium text-error">
              {problemCopy}
            </p>
          )}
          <div id={`${id}-help`} className="text-sm text-ink-soft">
            <p className="font-medium text-ink">Marcadores</p>
            <ul className="mt-1 grid gap-x-4 sm:grid-cols-2">
              {RECEIPT_PLACEHOLDERS.map((p) => (
                <li key={p}>
                  <code className="font-mono">{`{${p}}`}</code> — {RECEIPT_PLACEHOLDER_HELP[p]}
                </li>
              ))}
            </ul>
          </div>
        </div>
        <div>
          <p className="text-sm font-medium">Vista previa con datos de ejemplo</p>
          <pre aria-label="Vista previa del comprobante" className="mt-1 whitespace-pre-wrap rounded-md border border-line bg-well p-3 font-body text-sm">
            {problem ? "—" : renderReceipt(value, SAMPLE_RECEIPT)}
          </pre>
        </div>
      </div>
      {setting.history.length > 0 && (
        <p className="text-xs text-ink-soft">
          {/* T085 (FR-043): the day and the author, not only the hour */}
          Último cambio: {formatDateTime(setting.history[0].createdAt, timeFormat, timezone)}
          {setting.history[0].authorEmail ? ` por ${setting.history[0].authorEmail}` : ""} · {setting.history.length} cambio
          {setting.history.length === 1 ? "" : "s"}
        </p>
      )}
      {save.error && <p className="text-sm font-medium text-error">El mensaje no se guardó: revisa el folio y los marcadores.</p>}
      <Pending active={save.isPending} label="Guardando el mensaje.">
        <Button
          size="compact"
          aria-label={`Guardar ${KEY_LABELS[setting.key] ?? setting.key}`}
          disabled={!changed || problem !== null || save.isPending}
          onClick={() => save.mutate(value)}
        >
          Guardar
        </Button>
      </Pending>
    </div>
  );
}

function SettingField({ setting }: { setting: Setting }) {
  if (setting.type === "template") return <TemplateField setting={setting} />;
  return <PlainSettingField setting={setting} />;
}

function PlainSettingField({ setting }: { setting: Setting }) {
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
          /* searchable-picker FR-009 — the same searchable picker the
             business screens use. The short enum pickers below stay a
             Select: a list you can read is not one you search. */
          <Combobox
            id={id}
            label={KEY_LABELS[setting.key] ?? setting.key}
            className="mt-1"
            placeholder="Elige el banco"
            value={value}
            options={BANK_OPTIONS}
            onValueChange={setValue}
          />
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
          <Input size="compact"
            id={id}
            className={cn("mt-1", setting.type === "clabe" && "font-mono")}
            prefix={isCents ? "$" : undefined}
            inputMode={isCents || setting.type === "int" || setting.type === "clabe" ? "decimal" : undefined}
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
        )}
        {setting.history.length > 0 && (
          <p className="mt-1 text-xs text-ink-soft">
            {/* cash-at-stores T085 (FR-008): every rule's change keeps its day and author on screen */}
            Última: {isCents ? `$${(Number(setting.history[0].value) / 100).toFixed(2)}` : setting.history[0].value} ·{" "}
            {formatDateTime(setting.history[0].createdAt, timeFormat, timezone)}
            {setting.history[0].authorEmail ? ` por ${setting.history[0].authorEmail}` : ""} · {setting.history.length} cambio
            {setting.history.length === 1 ? "" : "s"}
          </p>
        )}
        {save.error && <p className="mt-1 text-sm font-medium text-error">Valor no válido para esta regla.</p>}
      </div>
      {/* feedback-vocabulary-rollout D1/D4: an action the operator started is
          announced at the control they used. Disabled plus a changed word is
          not a signal — it is silent to a screen reader and easy to miss. */}
      <Pending active={save.isPending} label="Guardando la regla.">
        <Button size="compact"
          aria-label={`Guardar ${KEY_LABELS[setting.key] ?? setting.key}`}
          disabled={!changed || outgoing === null || outgoing === "" || save.isPending}
          onClick={() => outgoing !== null && save.mutate(outgoing)}
        >
          {save.isPending ? "Guardando…" : "Guardar"}
        </Button>
      </Pending>
    </div>
  );
}

const COUNT = new Intl.NumberFormat("es-MX");

/* payment-without-receipt D19 (FR-038): the provider's remaining calls,
   as its latest answer said, and how long ago. A platform row, so it
   names no business (constitution V). Silent while it loads, when no
   answer has carried the header yet (null), and when the read fails: the
   line is a gauge beside the rules, never a gate on them, and running out
   is handled where it happens — the payer keeps "Seguimos buscando" (D14). */
function ProviderQuotaLine() {
  const quota = useQuery<ProviderQuotaResponse, ApiError>({
    queryKey: ["platform-provider-quota"],
    queryFn: () => api<ProviderQuotaResponse>("/platform/provider-quota"),
  });
  if (!quota.data) return null;
  return (
    <p className="text-sm text-muted-foreground">
      {`Consultas restantes del proveedor: ${COUNT.format(quota.data.remaining)} (${formatAgo(quota.data.observedAt)})`}
    </p>
  );
}

function RulesTab() {
  const settings = useQuery<SettingsListResponse, ApiError>({
    queryKey: ["platform-settings"],
    queryFn: () => api<SettingsListResponse>("/platform/settings"),
  });
  return (
    <div className="space-y-4">
      <ProviderQuotaLine />
      {settings.isPending ? (
        <Skeleton className="h-40 w-full" />
      ) : settings.error ? (
        <Alert variant="destructive">No pudimos cargar las reglas.</Alert>
      ) : (
        <Card className="p-6">
          {settings.data.settings.map((s) => (
            <SettingField key={`${s.key}-${s.current ?? ""}`} setting={s} />
          ))}
        </Card>
      )}
    </div>
  );
}

/* cash-at-stores FR-007: what is missing, in the operator's words */
const CAPABILITY_COPY: Record<(typeof STORE_CHANNEL_CAPABILITIES)[number], string> = {
  customerSearch: "buscar clientes",
  customerDebt: "leer el adeudo de un cliente",
  paymentActions: "registrar pagos ni reconectar",
};

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
  /* cash-at-stores D7 (FR-006, FR-007): the switch, and why it refuses */
  const current = detail.data ?? row;
  const channel = useMutation<unknown, ApiError, boolean>({
    mutationFn: (on) => api(`/platform/businesses/${row.id}`, { method: "PATCH", body: JSON.stringify({ storeChannel: on }) }),
    onSuccess: refresh,
  });
  const missing = STORE_CHANNEL_CAPABILITIES.filter((n) => !current.capabilities.includes(n));

  return (
    <Card className="space-y-4 p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-base font-semibold">{row.name}</h3>
          <p className="text-sm text-ink-soft">{row.email}</p>
        </div>
        <Button size="compact" variant="secondary" onClick={onClose}>
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
            <Input size="compact" aria-label="Monto del ajuste" prefix="$" inputMode="decimal" value={cents} onChange={(e) => setCents(e.target.value)} />
          </div>
          <Label htmlFor={`reason-${row.id}`}>Motivo (obligatorio)</Label>
          <Textarea id={`reason-${row.id}`} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Por qué, para quien lo lea después" />
          {adjust.error && <p className="text-sm font-medium text-error">No se guardó el ajuste.</p>}
          {/* feedback-vocabulary-rollout D1/D4: an action the operator started is
          announced at the control they used. Disabled plus a changed word is
          not a signal — it is silent to a screen reader and easy to miss. */}
          <Pending active={adjust.isPending} label="Aplicando el ajuste.">
            <Button size="compact" disabled={!adjustValid || adjust.isPending} onClick={() => adjust.mutate()}>
              Registrar ajuste
            </Button>
          </Pending>
        </div>
        <div className="space-y-2 rounded-md border border-border p-4">
          <Label htmlFor={`override-${row.id}`}>Tarifa negociada (vacío = global)</Label>
          <Input size="compact" id={`override-${row.id}`} prefix="$" inputMode="decimal" value={override} onChange={(e) => setOverride(e.target.value)} />
          {patch.error && <p className="text-sm font-medium text-error">Tarifa fuera de rango.</p>}
          {/* feedback-vocabulary-rollout D1/D4: an action the operator started is
          announced at the control they used. Disabled plus a changed word is
          not a signal — it is silent to a screen reader and easy to miss. */}
          <Pending active={patch.isPending} label="Guardando el negocio.">
            <Button size="compact" variant="secondary" disabled={patch.isPending} onClick={() => patch.mutate()}>
              Guardar tarifa
            </Button>
          </Pending>
        </div>
      </div>

      <div className="space-y-2 rounded-md border border-border p-4">
        <div className="flex items-center justify-between gap-4">
          <Label htmlFor={`store-channel-${row.id}`}>Efectivo en tiendas</Label>
          <Switch
            id={`store-channel-${row.id}`}
            checked={current.storeChannel.on}
            disabled={channel.isPending || (!current.storeChannel.on && missing.length > 0)}
            onCheckedChange={(on) => channel.mutate(on)}
          />
        </div>
        <p className="text-sm text-ink-soft">
          {current.storeChannel.on
            ? "Las tiendas de la red cobran en efectivo a los clientes de este negocio."
            : "Las tiendas de la red no cobran para este negocio."}
          {current.storeHeldCents !== 0 && (
            <> Las tiendas tienen <Amount cents={current.storeHeldCents} /> de este negocio.</>
          )}
        </p>
        {!current.storeChannel.on && missing.length > 0 && (
          <p className="text-sm font-medium text-warning">
            No se puede activar: la integración de este negocio no puede {missing.map((n) => CAPABILITY_COPY[n]).join(", ")}.
          </p>
        )}
        {channel.error && (
          <p role="alert" className="text-sm font-medium text-error">
            {channel.error.code === "ONE_BUSINESS_AT_A_TIME"
              ? "Otro negocio ya cobra en tiendas. Antes de sumar otro hay que decidir qué tiendas sirven a qué negocio."
              : channel.error.code === "NOT_CAPABLE"
                ? "La integración de este negocio no puede cobrar en tiendas."
                : "No se pudo cambiar."}
          </p>
        )}
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
      <Input size="compact" type="search" aria-label="Buscar negocio" placeholder="Nombre o correo del dueño" value={q} onChange={(e) => setQ(e.target.value)} />
      {list.error && <Alert variant="destructive">No pudimos cargar los negocios.</Alert>}
      {open && <BusinessDetail row={open} onClose={() => setOpen(null)} />}
      {/* feedback-vocabulary-rollout D1/D5/D7: the region owns the wait. The shape
          holds the space while the threshold runs; `isPending` is the first
          load, never a refetch the operator did not start. */}
      <Pending
        active={list.isPending}
        label="Cargando los negocios"
        shape={
          <Skeleton className="h-24 w-full" />
        }
      >
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
                      <span className={cn("flex items-center gap-1 text-sm", step.tone)}>
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
      </Pending>
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
          <TabsTrigger value="landing">Landing</TabsTrigger>
          <TabsTrigger value="reader">Lector</TabsTrigger>
          {/* cash-at-stores FR-001 */}
          <TabsTrigger value="stores">Tiendas</TabsTrigger>
        </TabsList>
        <TabsContent value="rules" className="mt-4">
          <RulesTab />
        </TabsContent>
        <TabsContent value="businesses" className="mt-4">
          <BusinessesTab />
        </TabsContent>
        <TabsContent value="landing" className="mt-4">
          <LandingTab />
        </TabsContent>
        <TabsContent value="reader" className="mt-4">
          <ReaderTab />
        </TabsContent>
        <TabsContent value="stores" className="mt-4">
          <StoresTab />
        </TabsContent>
      </Tabs>
    </main>
  );
}
