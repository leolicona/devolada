import { Alert, Amount, Button, Card, Pending, Skeleton } from "@devolada/ui";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Check, ChevronDown, EyeOff, Info, Link2, X } from "lucide-react";
import {
  BENCH_FIELDS,
  FIELDS_WITHOUT_ABSENT,
  type BenchField,
  type BenchMark,
  type BenchMarks,
  type BenchReading,
  type BenchReceiptDetail,
} from "@devolada/api/reader-schema";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { api, ApiError } from "@/lib/api";
import { API_BASE } from "@/lib/base";
import { cn } from "@/lib/utils";

/* Operador → Lector → one bench receipt (receipt-reader-tuning D17, D19;
   contracts/reader-api.md "Detail"). The picture above one column per
   model's reading, the nine fields in the same order in every column, and
   a three-way mark per field. Below 768 px the columns stack. Marks,
   failures and the same-bank flag are icon + text, never
   colour alone (constitution VI). The file comes through the API client
   with the session as a blob — there is no public URL for a bench file. */

export const FIELD_LABELS: Record<BenchField, string> = {
  isReceipt: "¿Es comprobante?",
  legibility: "Legibilidad",
  trackingKey: "Clave de rastreo",
  referenceNumber: "Referencia",
  senderBank: "Banco emisor",
  receivingBank: "Banco receptor",
  amount: "Monto",
  date: "Fecha",
  destination: "Destino",
};

export const FAILURE_LABELS: Record<NonNullable<BenchReading["failureCode"]>, string> = {
  READER_UNAVAILABLE: "No respondió",
  READER_UNREADABLE: "Respuesta sin datos",
  TIMEOUT: "Tardó demasiado",
};

const MARKS: { mark: BenchMark; label: string; Icon: typeof Check }[] = [
  { mark: "right", label: "Correcto", Icon: Check },
  { mark: "wrong", label: "Incorrecto", Icon: X },
  { mark: "absent", label: "No aparece", Icon: EyeOff },
];

const LEGIBILITY = { full: "Completa", partial: "Parcial", none: "Nula" } as const;
const DESTINATION_KIND = { clabe: "CLABE", card: "Tarjeta", phone: "Celular", account: "Cuenta" } as const;

export const seconds = (ms: number) => `${(ms / 1000).toFixed(1)} s`;

const NOT_SHOWN = <span className="text-ink-faint">No se ve</span>;

function FieldValue({ reading, field }: { reading: NonNullable<BenchReading["reading"]>; field: BenchField }) {
  switch (field) {
    case "isReceipt":
      return <>{reading.isReceipt ? "Sí" : "No"}</>;
    case "legibility":
      return reading.legibility ? <>{LEGIBILITY[reading.legibility]}</> : NOT_SHOWN;
    case "amount":
      return reading.amountCents == null ? NOT_SHOWN : <Amount cents={reading.amountCents} />;
    case "destination":
      return reading.destination.digits ? (
        <span className="font-mono">
          {reading.destination.kind ? `${DESTINATION_KIND[reading.destination.kind]} · ` : ""}
          {reading.destination.digits}
        </span>
      ) : (
        NOT_SHOWN
      );
    case "trackingKey":
    case "referenceNumber":
      return reading[field] ? <span className="break-all font-mono">{reading[field]}</span> : NOT_SHOWN;
    default:
      return reading[field] ? <>{reading[field]}</> : NOT_SHOWN;
  }
}

/* The raw answer, verbatim, behind a disclosure — for the answer shape as
   much as for the reading (research R5) */
function RawAnswer({ raw }: { raw: string | null }) {
  if (!raw) return null;
  return (
    <Collapsible>
      <CollapsibleTrigger asChild>
        <Button size="compact" variant="ghost" className="group -ml-2 px-2">
          <ChevronDown className="size-4 transition-transform group-data-[state=open]:rotate-180" aria-hidden />
          Ver respuesta del modelo
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-all rounded-md bg-well p-3 text-xs">{raw}</pre>
      </CollapsibleContent>
    </Collapsible>
  );
}

function ReadingColumn({ reading, receiptId }: { reading: BenchReading; receiptId: string }) {
  const queryClient = useQueryClient();
  const [marks, setMarks] = useState<BenchMarks>(reading.marks);
  const save = useMutation<BenchReading, ApiError, BenchMarks>({
    mutationFn: (m) =>
      api<BenchReading>(`/platform/reader/bench/readings/${reading.id}/marks`, {
        method: "PUT",
        body: JSON.stringify({ marks: m }),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["reader-bench", receiptId] });
      void queryClient.invalidateQueries({ queryKey: ["reader-bench-list"] });
      void queryClient.invalidateQueries({ queryKey: ["reader-bench-tally"] });
    },
  });
  const changed = JSON.stringify(marks) !== JSON.stringify(reading.marks);
  const heading = `${reading.modelLabel} · v${reading.questionVersion}`;

  return (
    <Card asChild className="min-w-0 flex-1 space-y-3 p-4">
      <section aria-label={heading}>
        <div>
          <h3 className="text-sm font-semibold">{reading.modelLabel}</h3>
          <p className="text-xs text-ink-soft">
            Preguntas v{reading.questionVersion} · {reading.status === "read" ? `leído en ${seconds(reading.readerMs)}` : seconds(reading.readerMs)}
          </p>
        </div>

        {reading.status === "failed" || !reading.reading ? (
          <>
            <Alert variant="warning" layout="icon">
              <AlertTriangle aria-hidden />
              {reading.failureCode ? FAILURE_LABELS[reading.failureCode] : "No respondió"}
            </Alert>
            <RawAnswer raw={reading.rawOutput} />
          </>
        ) : (
          <>
            <dl className="space-y-3">
              {BENCH_FIELDS.map((field) => {
                const judged = reading.judged[field];
                return (
                  <div key={field} className="border-b border-line-soft pb-3 last:border-0">
                    <dt className="text-xs text-ink-soft">{FIELD_LABELS[field]}</dt>
                    <dd className="mt-1 space-y-2 text-sm">
                      <div className="flex flex-wrap items-center gap-2">
                        <FieldValue reading={reading.reading!} field={field} />
                        {/* receipt-reader-tuning D14: a flag, never a correction */}
                        {(field === "senderBank" || field === "receivingBank") && reading.reading!.sameBank && (
                          <span className="inline-flex items-center gap-1 text-xs font-medium text-ink-soft">
                            <Link2 className="size-3.5" aria-hidden />
                            Mismo banco
                          </span>
                        )}
                        {judged && reading.marks[field] === "absent" && (
                          <span className={cn("inline-flex items-center gap-1 text-xs", judged === "right" ? "text-success" : "text-error")}>
                            {judged === "right" ? <Check className="size-3.5" aria-hidden /> : <X className="size-3.5" aria-hidden />}
                            {judged === "right" ? "acertó que no aparece" : "leyó algo que no aparece"}
                          </span>
                        )}
                      </div>
                      <div role="group" aria-label={`Revisión de ${FIELD_LABELS[field]}`} className="flex flex-wrap gap-1">
                        {MARKS.filter((m) => m.mark !== "absent" || !FIELDS_WITHOUT_ABSENT.includes(field)).map(({ mark, label, Icon }) => {
                          const pressed = marks[field] === mark;
                          return (
                            <Button
                              key={mark}
                              size="compact"
                              variant={pressed ? "primary" : "secondary"}
                              className="gap-1 px-2.5"
                              aria-pressed={pressed}
                              onClick={() =>
                                setMarks((current) => {
                                  const next = { ...current };
                                  if (pressed) delete next[field];
                                  else next[field] = mark;
                                  return next;
                                })
                              }
                            >
                              <Icon className="size-4" aria-hidden />
                              {label}
                            </Button>
                          );
                        })}
                      </div>
                    </dd>
                  </div>
                );
              })}
            </dl>
            {save.error && <p className="text-sm font-medium text-error">No pudimos guardar la revisión.</p>}
            <Pending active={save.isPending} label="Guardando la revisión.">
              <Button size="compact" disabled={!changed || save.isPending} onClick={() => save.mutate(marks)}>
                Guardar revisión
              </Button>
            </Pending>
            <RawAnswer raw={reading.rawOutput} />
          </>
        )}
      </section>
    </Card>
  );
}

/* The picture through the API with the session, shown by object URL and
   revoked when the detail closes */
function useBenchFile(id: string, enabled: boolean) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!enabled) return;
    let objectUrl: string | null = null;
    let cancelled = false;
    fetch(`${API_BASE}/platform/reader/bench/${id}/file`, { credentials: "include" })
      .then(async (res) => {
        if (!res.ok) throw new Error(String(res.status));
        const blob = await res.blob();
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      })
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [id, enabled]);
  return { url, failed };
}

export function BenchReceipt({ id, onClose }: { id: string; onClose: () => void }) {
  const queryClient = useQueryClient();
  const detail = useQuery<BenchReceiptDetail, ApiError>({
    queryKey: ["reader-bench", id],
    queryFn: () => api<BenchReceiptDetail>(`/platform/reader/bench/${id}`),
  });
  const isPdf = detail.data?.mediaType === "application/pdf";
  const file = useBenchFile(id, Boolean(detail.data?.fileAvailable));
  const readAgain = useMutation<BenchReceiptDetail, ApiError>({
    mutationFn: () => api<BenchReceiptDetail>(`/platform/reader/bench/${id}/read`, { method: "POST" }),
    onSuccess: (data) => {
      queryClient.setQueryData(["reader-bench", id], data);
      void queryClient.invalidateQueries({ queryKey: ["reader-bench-list"] });
      void queryClient.invalidateQueries({ queryKey: ["reader-bench-tally"] });
    },
  });

  if (detail.isPending) return <Skeleton className="h-64 w-full" />;
  if (detail.error) return <Alert variant="destructive">No pudimos cargar este comprobante.</Alert>;
  const d = detail.data;

  return (
    <section aria-labelledby="bench-detail" className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 id="bench-detail" className="text-base font-semibold">
          Comprobante de prueba
        </h3>
        <Button size="compact" variant="secondary" onClick={onClose}>
          Volver a la lista
        </Button>
      </div>

      {d.missing.length > 0 && (
        <Alert layout="icon">
          <Info aria-hidden />
          <div className="flex flex-wrap items-center gap-3">
            <span>Falta leer con: {d.missing.map((m) => m.model).join(", ")}</span>
            <Pending active={readAgain.isPending} label={`Leyendo con ${d.missing.length} modelos`}>
              <Button size="compact" variant="secondary" disabled={readAgain.isPending || !d.fileAvailable} onClick={() => readAgain.mutate()}>
                Leer de nuevo
              </Button>
            </Pending>
          </div>
        </Alert>
      )}
      {readAgain.error && <Alert variant="destructive">No pudimos leerlo de nuevo.</Alert>}

      {/* receipt-reader-tuning D19, amended 2026-09-25 on the measured
          layout: /operador is max-w-4xl, and three columns side by side left
          each reading ~170px — every mark control stacked its three
          buttons. The picture sits above the readings instead, and the
          readings sit side by side from 768px, stacking below it. */}
      <div className="flex flex-col gap-4">
        <div className="min-w-0">
          {!d.fileAvailable ? (
            <Alert layout="icon">
              <Info aria-hidden />
              La imagen ya se borró (se guarda 15 días). Las lecturas y tu revisión se conservan.
            </Alert>
          ) : isPdf ? (
            <Button
              size="compact"
              variant="secondary"
              disabled={!file.url}
              onClick={() => file.url && window.open(file.url, "_blank", "noopener")}
            >
              Abrir PDF
            </Button>
          ) : file.url ? (
            <img src={file.url} alt="El comprobante de prueba" className="max-h-96 max-w-full rounded-md border border-line-soft object-contain" />
          ) : file.failed ? (
            <Alert variant="warning">No pudimos cargar la imagen.</Alert>
          ) : (
            <Skeleton className="h-64 w-full" />
          )}
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-4 md:flex-row">
          {d.readings.map((r) => (
            <ReadingColumn key={`${r.id}-${r.markedAt ?? 0}`} reading={r} receiptId={id} />
          ))}
        </div>
      </div>
    </section>
  );
}
