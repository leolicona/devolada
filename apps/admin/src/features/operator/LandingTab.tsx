import { Alert, Button, Card, Pending, Skeleton, StatusBadge } from "@devolada/ui";
import { useQuery } from "@tanstack/react-query";
import { Repeat } from "lucide-react";
import { useState } from "react";
import {
  BILLING_SYSTEMS,
  STEPS,
  type AccessRequestList,
  type AccessRequestRow,
  type BillingSystem,
  type LandingCounts,
} from "@devolada/api/landing-schema";
import { api, type ApiError } from "@/lib/api";
import { formatDateTime, isoDateIn } from "@/lib/datetime";
import { cn } from "@/lib/utils";
import { useDisplaySettings } from "../auth/session";

/* Operador → Landing (landing-page D17; FR-017, FR-024; SC-003): the
   numbers and the requests in one place, exportable, without a developer.
   A period picker; the counts by channel with the three steps and each
   step's share of visits; the requests newest first with every answer as
   typed, which form, the channel, when, and the notice's outcome. The
   "repetida" mark is icon + text, never colour alone (constitution VI);
   the list keeps both rows and shows they share a number (D23). The CSV
   is built here from the loaded list — the list is small for the life of
   this feature. Tokens only; compact controls, the back office's size. */

const PERIODS = [7, 30, 90] as const;
/* landing-page D8: the counters live on Mexico City's calendar, the
   platform's own "today" — not the operator's browser. */
const PLATFORM_TIMEZONE = "America/Mexico_City";

/* es-MX labels for the contract's values (landing-page D7, D23) — keyed by
   the schema constants, as the bank list and the role matrix are */
export const BILLING_SYSTEM_LABELS: Record<BillingSystem, string> = {
  wisphub: "WispHub",
  own_software: "Sistema propio",
  other: "Otro",
  none: "Ninguno todavía",
};
const FORM_LABELS = { hero: "inicio", full: "completo" } as const;
const STEP_LABELS = { visit: "visitas", began: "empezaron", sent: "enviaron" } as const;

function daysBefore(isoDay: string, days: number): string {
  const [y, m, d] = isoDay.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d - days)).toISOString().slice(0, 10);
}

type ChannelRow = { channel: string; visit: number; began: number; sent: number };

/* The API returns rows by (day, channel, step); the operator reads one
   line per channel over the period, with each step's share of visits
   (FR-024). Channels sort by visits, `direct` never hidden. */
export function byChannel(rows: LandingCounts["rows"]): ChannelRow[] {
  const map = new Map<string, ChannelRow>();
  for (const r of rows) {
    const row = map.get(r.channel) ?? { channel: r.channel, visit: 0, began: 0, sent: 0 };
    row[r.step] += r.count;
    map.set(r.channel, row);
  }
  return [...map.values()].sort((a, b) => b.visit - a.visit || a.channel.localeCompare(b.channel));
}

const share = (part: number, whole: number) => (whole === 0 ? "—" : `${Math.round((part / whole) * 100)} %`);

/* One line above the list: which requests are businesses the product
   serves end to end today, and which are not (SC-003) */
export function countBySystem(items: AccessRequestRow[]): string {
  const counts: Record<BillingSystem | "none_given", number> = { wisphub: 0, own_software: 0, other: 0, none: 0, none_given: 0 };
  for (const i of items) counts[i.billingSystem ?? "none_given"] += 1;
  return `por sistema: WispHub ${counts.wisphub} · propio ${counts.own_software} · otro ${counts.other} · ninguno ${counts.none} · sin respuesta ${counts.none_given}`;
}

const csvCell = (v: string | number | null) => {
  const s = v === null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/* The file the operator takes out (FR-017, D17): one row per request,
   every answer as typed, in the order shown. */
export function buildCsv(items: AccessRequestRow[], format: Parameters<typeof formatDateTime>[1]): string {
  const header = ["whatsapp", "nombre", "sistema", "formulario", "canal", "llego", "aviso", "repetida"];
  const lines = items.map((i) =>
    [
      i.whatsapp,
      i.name,
      i.billingSystem ? BILLING_SYSTEM_LABELS[i.billingSystem] : "",
      FORM_LABELS[i.form],
      i.channel,
      formatDateTime(i.createdAt, format, PLATFORM_TIMEZONE),
      i.notifiedAt ? "entregado" : i.notifyError ?? "en camino",
      i.repeated ? "sí" : "no",
    ]
      .map(csvCell)
      .join(","),
  );
  return [header.join(","), ...lines].join("\n");
}

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

export function LandingTab() {
  const { timeFormat } = useDisplaySettings();
  const [days, setDays] = useState<(typeof PERIODS)[number]>(30);
  const to = isoDateIn(PLATFORM_TIMEZONE);
  const from = daysBefore(to, days - 1);

  const counts = useQuery<LandingCounts, ApiError>({
    queryKey: ["platform-landing-counts", from, to],
    queryFn: () => api<LandingCounts>(`/platform/landing/counts?from=${from}&to=${to}`),
  });
  const requests = useQuery<AccessRequestList, ApiError>({
    queryKey: ["platform-landing-requests"],
    queryFn: () => api<AccessRequestList>("/platform/landing/requests?limit=200"),
  });

  return (
    <div className="space-y-6">
      <section aria-labelledby="landing-counts" className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="landing-counts" className="text-base font-semibold">
            Visitas y solicitudes
          </h2>
          <div className="flex gap-2" role="group" aria-label="Periodo">
            {PERIODS.map((p) => (
              <Button
                key={p}
                size="compact"
                variant={p === days ? "primary" : "secondary"}
                aria-pressed={p === days}
                onClick={() => setDays(p)}
              >
                {p} días
              </Button>
            ))}
          </div>
        </div>
        {/* landing-page D8: a visit is a page load — not a person, not a device */}
        <p className="text-sm text-ink-soft">
          Del {from} al {to} (Ciudad de México). Una visita es una carga de página, no una persona.
        </p>
        {counts.error && <Alert variant="destructive">No pudimos cargar los conteos.</Alert>}
        <Pending active={counts.isPending} label="Cargando los conteos" shape={<Skeleton className="h-24 w-full" />}>
          {counts.data && (
            <Card className="overflow-x-auto p-0">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-line-soft text-left text-xs uppercase tracking-wide text-ink-soft">
                    <th scope="col" className="p-3 font-medium">
                      Canal
                    </th>
                    {STEPS.map((s) => (
                      <th key={s} scope="col" className="p-3 text-right font-medium">
                        {STEP_LABELS[s]}
                      </th>
                    ))}
                    <th scope="col" className="p-3 text-right font-medium">
                      empezaron / visitas
                    </th>
                    <th scope="col" className="p-3 text-right font-medium">
                      enviaron / visitas
                    </th>
                  </tr>
                </thead>
                <tbody className="tabular-nums">
                  {byChannel(counts.data.rows).length === 0 && (
                    <tr>
                      <td colSpan={6} className="p-4 text-ink-soft">
                        Sin visitas en este periodo.
                      </td>
                    </tr>
                  )}
                  {byChannel(counts.data.rows).map((r) => (
                    <tr key={r.channel} className="border-b border-line-soft last:border-0">
                      <th scope="row" className="p-3 text-left font-medium">
                        {r.channel}
                      </th>
                      <td className="p-3 text-right">{r.visit}</td>
                      <td className="p-3 text-right">{r.began}</td>
                      <td className="p-3 text-right">{r.sent}</td>
                      <td className="p-3 text-right">{share(r.began, r.visit)}</td>
                      <td className="p-3 text-right">{share(r.sent, r.visit)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          )}
        </Pending>
      </section>

      <section aria-labelledby="landing-requests" className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="landing-requests" className="text-base font-semibold">
            Solicitudes
          </h2>
          <Button
            size="compact"
            variant="secondary"
            disabled={!requests.data || requests.data.items.length === 0}
            onClick={() => requests.data && download(`solicitudes-landing-${to}.csv`, buildCsv(requests.data.items, timeFormat))}
          >
            Exportar CSV
          </Button>
        </div>
        {requests.data && <p className="text-sm text-ink-soft">{requests.data.items.length} en total, {countBySystem(requests.data.items)}.</p>}
        {requests.error && <Alert variant="destructive">No pudimos cargar las solicitudes.</Alert>}
        <Pending active={requests.isPending} label="Cargando las solicitudes" shape={<Skeleton className="h-24 w-full" />}>
          {requests.data && (
            <Card className="overflow-x-auto p-0">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-line-soft text-left text-xs uppercase tracking-wide text-ink-soft">
                    {["WhatsApp", "Nombre", "Sistema", "Formulario", "Canal", "Llegó", "Aviso"].map((h) => (
                      <th key={h} scope="col" className="p-3 font-medium">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {requests.data.items.length === 0 && (
                    <tr>
                      <td colSpan={7} className="p-4 text-ink-soft">
                        Todavía nadie deja su WhatsApp.
                      </td>
                    </tr>
                  )}
                  {requests.data.items.map((r) => (
                    <tr key={r.id} className="border-b border-line-soft last:border-0 align-top">
                      <td className="p-3 font-mono tabular-nums">
                        <span className="block">{r.whatsapp}</span>
                        {r.repeated && (
                          /* Icon + text, never colour alone (constitution VI) */
                          <span className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-warning">
                            <Repeat className="size-3.5" aria-hidden />
                            repetida
                          </span>
                        )}
                      </td>
                      <td className={cn("p-3", !r.name && "text-ink-faint")}>{r.name ?? "—"}</td>
                      <td className={cn("p-3", !r.billingSystem && "text-ink-faint")}>
                        {r.billingSystem ? BILLING_SYSTEM_LABELS[r.billingSystem] : "sin respuesta"}
                      </td>
                      <td className="p-3">{FORM_LABELS[r.form]}</td>
                      <td className="p-3">{r.channel}</td>
                      <td className="p-3 whitespace-nowrap">{formatDateTime(r.createdAt, timeFormat, PLATFORM_TIMEZONE)}</td>
                      <td className="p-3">
                        {/* landing-page D10: the notice's outcome on the row — delivered,
                            or why not; the request is here either way (FR-018) */}
                        {r.notifiedAt ? (
                          <StatusBadge status="deliveryDelivered" />
                        ) : r.notifyError ? (
                          <span className="inline-flex flex-col gap-1">
                            <StatusBadge status="deliveryFailed" />
                            <span className="text-xs text-ink-soft">{r.notifyError}</span>
                          </span>
                        ) : (
                          <span className="text-xs text-ink-soft">en camino</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          )}
        </Pending>
      </section>
    </div>
  );
}
