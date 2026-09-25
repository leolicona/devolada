import { Alert, Button, Card, Pending, Skeleton } from "@devolada/ui";
import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Check, Info, X } from "lucide-react";
import {
  BENCH_FIELDS,
  type BenchListResponse,
  type BenchReceiptDetail,
  type BenchTallyResponse,
  type ReaderStateResponse,
} from "@devolada/api/reader-schema";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { api, ApiError } from "@/lib/api";
import { API_BASE } from "@/lib/base";
import { formatDateTime } from "@/lib/datetime";
import { useDisplaySettings } from "../auth/session";
import { BenchReceipt, FIELD_LABELS, seconds } from "./BenchReceipt";

/* Operador → Lector (receipt-reader-tuning D19; contracts/reader-api.md).
   Three cards: the model that reads every receipt of this environment
   (Story 1), the test bench where every listed model reads the same
   receipt side by side (Story 3), and the results that decide the prod
   model. Compact controls, tokens only, status as icon + text. */

function ModelCard() {
  const queryClient = useQueryClient();
  const { timezone, timeFormat } = useDisplaySettings();
  const state = useQuery<ReaderStateResponse, ApiError>({
    queryKey: ["reader-state"],
    queryFn: () => api<ReaderStateResponse>("/platform/reader"),
  });
  const [picked, setPicked] = useState<string | null>(null);
  const choose = useMutation<ReaderStateResponse, ApiError, string>({
    mutationFn: (modelId) =>
      api<ReaderStateResponse>("/platform/reader/model", { method: "POST", body: JSON.stringify({ modelId }) }),
    onSuccess: (data) => {
      queryClient.setQueryData(["reader-state"], data);
      setPicked(null);
      void queryClient.invalidateQueries({ queryKey: ["reader-state"] });
    },
  });

  if (state.isPending) return <Skeleton className="h-40 w-full" />;
  if (state.error) return <Alert variant="destructive">No pudimos cargar el modelo del lector.</Alert>;
  const s = state.data;
  const labelOf = (id: string) => s.models.find((m) => m.id === id)?.label ?? id;
  const selected = picked ?? s.activeModel;
  const single = s.models.length < 2;

  return (
    <Card className="space-y-4 p-6">
      <div>
        <h2 className="text-base font-semibold">Modelo que lee los comprobantes</h2>
        <p className="text-sm text-ink-soft">Lo usan todas las lecturas de este ambiente a partir de la siguiente.</p>
      </div>
      {!s.readerAvailable && (
        <Alert variant="warning" layout="icon">
          <AlertTriangle aria-hidden />
          Este ambiente no tiene lector; los comprobantes van directo al proveedor.
        </Alert>
      )}
      {s.choice === "stale" && (
        <Alert variant="warning" layout="icon">
          <AlertTriangle aria-hidden />
          La elección anterior ({s.staleChoice}) ya no está disponible; lee el modelo por defecto.
        </Alert>
      )}
      <p className="text-sm">
        <span className="font-medium">{labelOf(s.activeModel)}</span>
        {s.activeModel === s.defaultModel && <span className="text-ink-soft"> · Por defecto</span>}
        <span className="text-ink-soft"> · preguntas v{s.questionVersion}</span>
      </p>
      <p className="text-sm text-ink-soft">
        {s.fallbacksLast7Days > 0 && <Info className="mr-1 inline size-4 align-text-bottom" aria-hidden />}
        Respaldos en los últimos 7 días: {s.fallbacksLast7Days}
        {s.fallbacksLast7Days > 0 && " · El modelo elegido falló y leyó el modelo por defecto."}
      </p>
      <div className="grid gap-2 sm:grid-cols-[1fr_auto] sm:items-end">
        <div>
          <Label htmlFor="reader-model">Modelo</Label>
          <Select value={selected} onValueChange={setPicked} disabled={single}>
            <SelectTrigger id="reader-model" className="mt-1" aria-label="Modelo">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {s.models.map((m) => (
                <SelectItem key={m.id} value={m.id}>
                  {m.label}
                  {m.id === s.defaultModel ? " (por defecto)" : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {single && <p className="mt-1 text-xs text-ink-soft">Este ambiente tiene un solo modelo.</p>}
        </div>
        <Pending active={choose.isPending} label="Guardando el modelo.">
          <Button
            size="compact"
            disabled={single || selected === s.activeModel || choose.isPending}
            onClick={() => choose.mutate(selected)}
          >
            Usar este modelo
          </Button>
        </Pending>
      </div>
      {choose.error && <p className="text-sm font-medium text-error">No pudimos guardar el modelo.</p>}
      {s.history.length > 0 && (
        <div>
          <h3 className="text-sm font-medium">Cambios recientes</h3>
          <ul className="mt-1 space-y-1 text-xs text-ink-soft">
            {s.history.map((h) => (
              <li key={`${h.value}-${h.createdAt}`}>
                {labelOf(h.value)} · {h.authorUserId} · {formatDateTime(h.createdAt, timeFormat, timezone)}
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}

const TYPE_LABEL = (mediaType: string) => (mediaType === "application/pdf" ? "PDF" : "Imagen");

function BenchCard({ modelCount }: { modelCount: number }) {
  const queryClient = useQueryClient();
  const { timezone, timeFormat } = useDisplaySettings();
  const input = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [duplicate, setDuplicate] = useState(false);
  const list = useQuery<BenchListResponse, ApiError>({
    queryKey: ["reader-bench-list"],
    queryFn: () => api<BenchListResponse>("/platform/reader/bench"),
  });
  /* A direct fetch with the session, as the top-up's proof upload does
     (CreditCard.tsx): the API client sends JSON */
  const upload = useMutation<BenchReceiptDetail, ApiError, File>({
    mutationFn: async (file) => {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch(`${API_BASE}/platform/reader/bench`, { method: "POST", credentials: "include", body: form });
      const json = (await res.json()) as { success: boolean; data: BenchReceiptDetail; error?: { code?: string } };
      if (!res.ok || !json.success) throw new ApiError(json.error?.code ?? "UNKNOWN_ERROR", res.status);
      return json.data;
    },
    onSuccess: (data) => {
      queryClient.setQueryData(["reader-bench", data.id], data);
      setDuplicate(Boolean(data.duplicate));
      setOpen(data.id);
      void queryClient.invalidateQueries({ queryKey: ["reader-bench-list"] });
      void queryClient.invalidateQueries({ queryKey: ["reader-bench-tally"] });
    },
  });
  const uploadError =
    upload.error?.code === "PROOF_TOO_LARGE"
      ? "El archivo pesa más de 1 MB."
      : upload.error?.code === "PROOF_UNSUPPORTED_TYPE"
        ? "Sube una imagen o un PDF."
        : upload.error?.code === "READER_UNAVAILABLE"
          ? "Este ambiente no tiene lector; no hay nada que comparar."
          : upload.error
            ? "No pudimos subir el comprobante."
            : null;

  return (
    <Card className="space-y-4 p-6">
      <div>
        <h2 className="text-base font-semibold">Banco de pruebas</h2>
        <p className="text-sm text-ink-soft">
          Sube un comprobante: lo leen todos los modelos disponibles, sin crear pagos ni gastar créditos.
        </p>
      </div>
      <input
        ref={input}
        type="file"
        accept="image/*,application/pdf"
        className="sr-only"
        aria-label="Comprobante de prueba"
        tabIndex={-1}
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) upload.mutate(file);
        }}
      />
      <Pending active={upload.isPending} label={`Leyendo con ${modelCount} modelos…`}>
        <div className="flex flex-wrap items-center gap-3">
          <Button size="compact" disabled={upload.isPending} onClick={() => input.current?.click()}>
            Subir comprobante
          </Button>
          {upload.isPending && (
            <span className="text-sm text-ink-soft" aria-hidden>
              Leyendo con {modelCount} modelos…
            </span>
          )}
        </div>
      </Pending>
      {uploadError && <p className="text-sm font-medium text-error">{uploadError}</p>}
      {duplicate && open && (
        <Alert layout="icon">
          <Info aria-hidden />
          Este comprobante ya estaba en el banco.
        </Alert>
      )}

      {open ? (
        <BenchReceipt
          id={open}
          onClose={() => {
            setOpen(null);
            setDuplicate(false);
          }}
        />
      ) : (
        <Pending active={list.isPending} label="Cargando el banco de pruebas" shape={<Skeleton className="h-24 w-full" />}>
          {list.error && <Alert variant="destructive">No pudimos cargar el banco de pruebas.</Alert>}
          {list.data && list.data.items.length === 0 && (
            <p className="text-sm text-ink-soft">Todavía no hay comprobantes de prueba.</p>
          )}
          {list.data && list.data.items.length > 0 && (
            <ul className="divide-y divide-line-soft rounded-md border border-line-soft">
              {list.data.items.map((item) => {
                const marked = Math.min(...item.readings.map((r) => r.marked), 9);
                return (
                  <li key={item.id}>
                    <button
                      type="button"
                      className="flex w-full flex-wrap items-center gap-x-4 gap-y-1 p-3 text-left text-sm hover:bg-well focus-visible:bg-well"
                      onClick={() => {
                        setDuplicate(false);
                        setOpen(item.id);
                      }}
                    >
                      <span className="whitespace-nowrap">{formatDateTime(item.createdAt, timeFormat, timezone)}</span>
                      <span className="text-ink-soft">{TYPE_LABEL(item.mediaType)}</span>
                      {item.readings.map((r) => (
                        <span key={r.id} className="inline-flex items-center gap-1">
                          {r.status === "read" ? <Check className="size-3.5" aria-hidden /> : <X className="size-3.5" aria-hidden />}
                          {r.modelLabel}: {r.status === "read" ? `leído en ${seconds(r.readerMs)}` : "falló"}
                        </span>
                      ))}
                      <span className="text-ink-soft">{item.readings.length ? marked : 0} de 9 revisados</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </Pending>
      )}
    </Card>
  );
}

/* The two fields with most wrong answers, for "Más errores en" */
export function worstFields(wrong: BenchTallyResponse["rows"][number]["wrongByField"]): string {
  const ranked = BENCH_FIELDS.map((f) => [f, wrong[f] ?? 0] as const)
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2);
  return ranked.length ? ranked.map(([f, n]) => `${FIELD_LABELS[f]} (${n})`).join(", ") : "—";
}

function ResultsCard() {
  const { timezone, timeFormat } = useDisplaySettings();
  const tally = useQuery<BenchTallyResponse, ApiError>({
    queryKey: ["reader-bench-tally"],
    queryFn: () => api<BenchTallyResponse>("/platform/reader/bench/tally"),
  });
  return (
    <Card className="space-y-3 p-6">
      <h2 className="text-base font-semibold">Resultados</h2>
      {tally.error && <Alert variant="destructive">No pudimos cargar los resultados.</Alert>}
      <Pending active={tally.isPending} label="Cargando los resultados" shape={<Skeleton className="h-24 w-full" />}>
        {tally.data && (
          <>
            <p className="text-sm text-ink-soft">Al {formatDateTime(tally.data.asOf, timeFormat, timezone)}</p>
            {tally.data.rows.length === 0 ? (
              <p className="text-sm text-ink-soft">Sube un comprobante al banco de pruebas para empezar.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-line-soft text-left text-xs uppercase tracking-wide text-ink-soft">
                      {["Modelo", "Versión", "Lecturas", "Fallas", "Campos revisados", "Correctos", "9 de 10 en", "Más errores en"].map((h) => (
                        <th key={h} scope="col" className="p-2 font-medium">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="tabular-nums">
                    {tally.data.rows.map((r) => (
                      <tr key={`${r.model}-${r.questionVersion}`} className="border-b border-line-soft last:border-0 align-top">
                        <th scope="row" className="p-2 text-left font-medium">
                          {r.modelLabel}
                        </th>
                        <td className="p-2">v{r.questionVersion}</td>
                        <td className="p-2">{r.readings}</td>
                        <td className="p-2">{r.failures}</td>
                        <td className="p-2">{r.judged}</td>
                        <td className="p-2">
                          {r.right}
                          {r.judged > 0 ? ` (${Math.round((r.right / r.judged) * 100)} %)` : ""}
                        </td>
                        <td className="p-2">{r.p90Ms == null ? "—" : seconds(r.p90Ms)}</td>
                        <td className="p-2">{worstFields(r.wrongByField)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </Pending>
    </Card>
  );
}

export function ReaderTab() {
  const state = useQuery<ReaderStateResponse, ApiError>({
    queryKey: ["reader-state"],
    queryFn: () => api<ReaderStateResponse>("/platform/reader"),
  });
  return (
    <div className="space-y-6">
      <ModelCard />
      <BenchCard modelCount={state.data?.models.length ?? 1} />
      <ResultsCard />
    </div>
  );
}
