import { useEffect, useId, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  Amount,
  AmountBreakdown,
  Button,
  Card,
  cn,
  Field,
  Input,
  Skeleton,
  StatusBadge,
} from "@devolada/ui";
import { BANKS } from "@devolada/api/direct-payments-schema";
import type {
  DirectPaymentStatusResponse,
  LinkStatusResponse,
  PayResponse,
  ProofReading,
  ProofUploadResponse,
} from "@devolada/api/direct-payments-schema";
import { NativeSelect } from "../../components/ui/native-select";
import {
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  Copy,
  CloudUpload,
  ScanLine,
  ShieldCheck,
  Store,
  TriangleAlert,
} from "lucide-react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { api, ApiError } from "@/api";
import { forgetLink, rememberLink } from "@/links";
import { forgetStep, readStep, rememberStep, type Step } from "@/step";

/* The customer's payment page (direct-payment spec D9, D10): es-MX,
   "pago" never "cobro". Four flows — loading, instructions, verifying,
   result — plus the edge states the UI contract enumerates.

   The instructions flow is itself two steps (D19), because the payment
   has an interruption at its centre: the transfer happens in the bank
   app. Step 1 is only what gets typed there; step 2 is only the proof. */

const POLL_MS = 5000;

/* Transfer apps want paste, so every SPEI value carries a copy button. */
function CopyButton({
  value,
  text = "Copiar",
  /* Read by assistive tech only. Several buttons on the card show the
     same word, and the field name is what tells them apart — appended
     rather than substituted, so the visible text stays the start of the
     accessible name (WCAG 2.5.3). */
  srSuffix,
  variant = "secondary",
  className,
}: {
  value: string;
  text?: string;
  srSuffix?: string;
  variant?: "secondary" | "ghost";
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      variant={variant}
      className={cn("h-10 shrink-0 px-3 text-sm", className)}
      onClick={() => {
        void navigator.clipboard?.writeText(value);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }}
    >
      {copied ? <CheckCircle2 className="size-4" aria-hidden /> : <Copy className="size-4" aria-hidden />}
      {copied ? "Copiado" : text}
      {srSuffix && <span className="sr-only"> {srSuffix}</span>}
    </Button>
  );
}

/* One SPEI field with its copy button. */
function CopyField({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2">
      <div className="min-w-0">
        <p className="text-sm text-ink-soft">{label}</p>
        <p className="break-all font-mono text-sm text-ink">{value}</p>
      </div>
      <CopyButton value={value} srSuffix={label} />
    </div>
  );
}

/* Error copy for a rejected submission — only the enumerated public
   codes reach here (schema `publicPaymentError` + envelope codes). */
const payErrors: Record<string, string> = {
  TOO_MANY_ATTEMPTS: "Demasiados intentos por ahora. Espera una hora e intenta de nuevo.",
  NOTHING_DUE: "Tu cuenta ya está al corriente. No hay nada que pagar.",
  TRANSFER_ALREADY_USED: "Esta transferencia ya fue utilizada para otro pago.",
  SPEI_NOT_CONFIGURED: "El pago por transferencia no está disponible por ahora.",
  VALIDATION_ERROR: "Revisa los datos de tu transferencia e intenta de nuevo.",
  /* D17: two different sentences, because they are two different facts.
     One is what the bank says; the other is that nobody said anything. */
  TRANSFER_CONTRADICTED: "Tu banco reporta que esta transferencia no se completó. Revísala en tu app e intenta de nuevo.",
  TRANSFER_NOT_FOUND:
    "No encontramos tu transferencia en Banxico. Si ya la hiciste, contacta a tu proveedor de internet con tu comprobante para que la registre.",
};
const payErrorCopy = (code: string) =>
  payErrors[code] ?? "No pudimos recibir tu comprobante. Intenta de nuevo en unos minutos.";

type TransferDraft = { trackingKey?: string | null; senderBank?: string | null; date?: string | null };

function TransferForm({
  onSubmit,
  busy,
  draft,
  submitLabel = "Verificar mi pago",
}: {
  onSubmit: (t: { trackingKey: string; senderBank: string; date: string }) => void;
  busy: boolean;
  /* D18: what the reader proposed. Every field is editable and none is
     trusted — the payer is the one who confirms, and a field the gate
     did not pass arrives here empty rather than pre-filled with
     something that merely looks confirmable. */
  draft?: TransferDraft;
  submitLabel?: string;
}) {
  const [trackingKey, setTrackingKey] = useState(draft?.trackingKey ?? "");
  const [senderBank, setSenderBank] = useState(draft?.senderBank ?? "");
  /* validation-status-ux D6: a draft with no date arrives empty — the
     machine did not read one, and pre-filling *today* invents a value
     that merely looks confirmed. Only the manual door, where the payer
     types everything, keeps today as the honest same-day prior. */
  const [date, setDate] = useState(
    draft ? (draft.date ?? "") : new Date().toISOString().slice(0, 10),
  );
  /* D16/BUG-006: the same shape the API enforces, so the button is
     honest — a key that cannot validate never gets a paid call. */
  const valid =
    /^[A-Za-z0-9]{6,30}$/.test(trackingKey.trim()) &&
    senderBank !== "" &&
    /^\d{4}-\d{2}-\d{2}$/.test(date);
  return (
    <div className="space-y-4">
      <Field label="Clave de rastreo">
        {/* BUG-009: a real clave runs to 28 characters, and in the body
            font at 16px that is 327px of text in a 276px field on a
            360px phone — the tail simply was not on screen. Mono at
            text-sm fits it whole, and mono is what the value deserves
            anyway: it is a code being proofread, where `0` and `O` have
            to look different. */}
        <Input
          value={trackingKey}
          onChange={(e) => setTrackingKey(e.target.value)}
          placeholder="Está en tu comprobante"
          className="font-mono text-sm"
          autoComplete="off"
        />
      </Field>
      <Field label="Banco desde el que pagaste">
        {/* D16: typed free-hand, this field was the quietest way to lose a
            real payment — apiCEP answers `invalid` for a name it does not
            know, which reads exactly like a transfer that never happened.
            Sorted for scanning; the constant keeps the provider's order. */}
        <NativeSelect required value={senderBank} onChange={(e) => setSenderBank(e.target.value)}>
          <option value="" disabled>
            Elige tu banco
          </option>
          {[...BANKS]
            .sort((a, b) => a.localeCompare(b, "es-MX"))
            .map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
        </NativeSelect>
      </Field>
      <Field label="Fecha de la transferencia">
        <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      </Field>
      <Button
        size="critical"
        disabled={!valid || busy}
        onClick={() => onSubmit({ trackingKey: trackingKey.trim(), senderBank: senderBank.trim(), date })}
      >
        <ShieldCheck className="size-5" aria-hidden />
        {busy ? "Enviando…" : submitLabel}
      </Button>
    </div>
  );
}

function ReceiptForm({ onSubmit, busy }: { onSubmit: (file: File) => void; busy: boolean }) {
  const [file, setFile] = useState<File | null>(null);
  const [tooBig, setTooBig] = useState(false);
  const inputId = useId();
  return (
    <div className="space-y-4">
      {/* The label is the tap target, and the input behind it is
          visually hidden. A bare `<input type="file">` paints the
          platform's own control — "Choose File · No file chosen", in
          English, on a page that is es-MX by law (D10) — and gives the
          payer a 20px hit area on the one action step 2 exists for.

          PDF too: several banks hand out the comprobante as one, and
          apiCEP reads it (D12). */}
      <label
        htmlFor={inputId}
        className="flex cursor-pointer flex-col items-center gap-2 rounded-sm border border-dashed border-line-input bg-well px-4 py-8 text-center"
      >
        <CloudUpload className="size-6 text-ink-soft" aria-hidden />
        <span className="break-all text-base font-medium text-ink">
          {file ? file.name : "Toca para subir tu captura"}
        </span>
        <span className="text-sm text-ink-soft">
          Captura o comprobante de tu transferencia · imagen o PDF, hasta 1 MB
        </span>
      </label>
      <input
        id={inputId}
        type="file"
        accept="image/*,application/pdf"
        className="sr-only"
        onChange={(e) => {
          const picked = e.target.files?.[0] ?? null;
          setTooBig(Boolean(picked && picked.size > 1_000_000));
          setFile(picked);
        }}
      />
      {tooBig && (
        <Alert variant="warning" layout="icon">
          <TriangleAlert aria-hidden />
          El archivo pesa más de 1 MB. Toma la captura de nuevo o usa los datos de tu transferencia.
        </Alert>
      )}
      <Button size="critical" disabled={!file || tooBig || busy} onClick={() => file && onSubmit(file)}>
        <CloudUpload className="size-5" aria-hidden />
        {busy ? "Subiendo…" : "Enviar comprobante"}
      </Button>
    </div>
  );
}

export function PaymentPage({ token }: { token: string }) {
  const queryClient = useQueryClient();
  const [payment, setPayment] = useState<PayResponse | null>(null);
  /* D18: the reading waiting for the payer to confirm it */
  const [draft, setDraft] = useState<{ proofId: string; reading: ProofReading } | null>(null);
  /* D18: a correction re-submits, and the image has to travel with it */
  const [proofId, setProofId] = useState<string | null>(null);
  /* D19: which half of the payment this payer is on. Seeded from the
     device, because coming back from the bank app is a fresh page load
     more often than it is the same one. */
  const [step, setStep] = useState<Step>(() => readStep(token));
  const goTo = (next: Step) => {
    setStep(next);
    rememberStep(token, next);
  };
  /* The fallback door, opened on purpose and never closed again (D19) */
  const [manualDoor, setManualDoor] = useState(false);
  /* validation-status-ux D7: the live payment a fresh proof supersedes —
     set when the payer walks out of "Verificando" through "Subir otro
     comprobante", cleared when the new submission lands. */
  const [resubmitOf, setResubmitOf] = useState<string | null>(null);
  /* validation-status-ux D2: the correction door inside the calm phase.
     Opening it is deliberate; it never opens itself. */
  const [correcting, setCorrecting] = useState(false);

  const link = useQuery<LinkStatusResponse, ApiError>({
    queryKey: ["link", token],
    queryFn: () => api<LinkStatusResponse>(`/direct-payments/links/${token}`),
    retry: false,
  });

  /* US-D08 D2: this device keeps the link it was handed, so the customer
     can come back next month without asking the ISP again. Nothing is
     announced — nothing was asked of them. */
  const linkData = link.data;
  useEffect(() => {
    if (!linkData) return;
    rememberLink(token, linkData.customerName ?? linkData.ispName);
    /* D19: nothing left to pay means the last payment is over — give the
       step back, so next month starts where the next payment starts. */
    if (linkData.status === "no_debt") forgetStep(token);
  }, [linkData, token]);

  /* A link the ISP removed is dropped rather than offered forever. Only
     on 404: a network failure or a WispHub outage must not erase the way
     back into an account that still exists. */
  const linkError = link.error;
  useEffect(() => {
    if (linkError?.status === 404) forgetLink(token);
  }, [linkError, token]);

  /* US-D03/US-D04: poll while the verdict or the reconnection is open */
  const poll = useQuery<DirectPaymentStatusResponse, ApiError>({
    queryKey: ["status", payment?.directPaymentId],
    queryFn: () => api<DirectPaymentStatusResponse>(`/direct-payments/${payment!.directPaymentId}/status`),
    enabled: payment !== null,
    refetchInterval: (query) => {
      const s = query.state.data;
      if (!s) return POLL_MS;
      const open =
        s.status === "validating" ||
        (s.status === "confirmed" && s.reconnectionStatus !== "reconnected") ||
        /* A partial that met the threshold can still have its reconnection
           in the queue (WispHub down). `withheld` is terminal; `queued` is
           a promise the page has to keep watching, or "en unos minutos"
           never turns into "ya está activo". */
        (s.status === "partial" && s.reconnectionStatus === "queued");
      return open ? POLL_MS : false;
    },
  });

  /* D19: a confirmed payment gives the step back. `validating` does not
     — that payer has not finished, and a reload must not drop them back
     onto a CLABE they already used. */
  const settled = poll.data?.status ?? payment?.status;
  useEffect(() => {
    if (settled === "confirmed") forgetStep(token);
  }, [settled, token]);

  const pay = useMutation<
    PayResponse,
    ApiError,
    {
      proofId?: string;
      transfer?: object;
      supersedes?: string;
      receiptStatus?: string;
      receiptAmountCents?: number;
    }
  >({
    mutationFn: (body) =>
      api<PayResponse>(`/direct-payments/links/${token}/pay`, {
        method: "POST",
        body: JSON.stringify(body),
      }),
    onSuccess: (result) => {
      setPayment(result);
      setResubmitOf(null);
      setCorrecting(false);
    },
  });

  /* D18 — the machine reads, the human confirms, the direct door
     validates. Uploading no longer pays: it produces a draft the payer
     looks at. Everything that can go wrong on the way here degrades into
     "the payer fills it in", because the reader is help and never an
     authority — it cannot reject anybody. */
  const upload = useMutation<
    { proofId: string; reading: ProofReading | null } | PayResponse,
    ApiError,
    File
  >({
    mutationFn: async (file) => {
      const form = new FormData();
      form.append("file", file);
      const { proofId } = await api<ProofUploadResponse>(
        `/direct-payments/links/${token}/proof`,
        { method: "POST", body: form },
      );
      setProofId(proofId);
      let reading: ProofReading | null = null;
      try {
        reading = await api<ProofReading>(`/direct-payments/links/${token}/read`, {
          method: "POST",
          body: JSON.stringify({ proofId }),
        });
      } catch {
        /* The reader being down is not the payer's problem: fall through
           to the provider's OCR door, which is what shipped before this
           step existed. */
      }
      if (!reading || reading.source === "provider-ocr") {
        /* A PDF, or no reading at all — the provider's OCR still takes
           both, so pay the way we always did */
        return api<PayResponse>(`/direct-payments/links/${token}/pay`, {
          method: "POST",
          body: JSON.stringify({
            proofId,
            ...(resubmitOf ? { supersedes: resubmitOf } : {}),
          }),
        });
      }
      /* D18: a reading that failed the gate is the one case where the
         payer must be asked *before* anything is spent — there is a
         visibly empty field and nothing to try. */
      const gated =
        reading.isReceipt === false ||
        reading.gate.trackingKey !== "ok" ||
        reading.gate.senderBank !== "ok" ||
        /* validation-status-ux D6: an unread date is a missing field,
           like clave and banco — never silently today's. */
        reading.date == null;
      if (gated) return { proofId, reading };

      /* partial-payment D1/D12: the amount printed on the receipt is what
         travels to Banxico, so a transfer that fell short is findable and
         lands as a `partial` row — a short reading is a valid submission,
         never a refusal. Only a reading *above* the debt is stopped here:
         that is a misread, not a payment (nobody's receipt claims more
         than they sent), and its lookup can only ever answer a faceless
         `not_found` six hours long. */
      const expected = link.data?.totalCents;
      if (
        reading.amountCents != null &&
        expected != null &&
        reading.amountCents > expected
      ) {
        return { proofId, reading };
      }

      /* The gate passed, so try it silently. If the reading is right —
         and we have no measurement saying how often it is — nobody is
         asked anything, which is the whole reason not to put a
         confirmation in front of every payer. */
      return api<PayResponse>(`/direct-payments/links/${token}/pay`, {
        method: "POST",
        body: JSON.stringify({
          proofId,
          ...(resubmitOf ? { supersedes: resubmitOf } : {}),
          transfer: {
            trackingKey: reading.trackingKey,
            senderBank: reading.senderBank,
            /* D6 gated null dates above, so this fallback never fires;
               it only keeps the shape total for the type. */
            date: reading.date ?? new Date().toISOString().slice(0, 10),
          },
          receiptStatus: reading.receiptStatus ?? undefined,
          /* The server holds the real rule (D18): it has the fresh debt
             and refuses with AMOUNT_MISMATCH. The check above is only a
             short-circuit so our own page answers instantly. */
          receiptAmountCents: reading.amountCents ?? undefined,
        }),
      });
    },
    onSuccess: (result) => {
      if ("directPaymentId" in result) {
        setPayment(result);
        setResubmitOf(null);
        setCorrecting(false);
      } else setDraft(result as { proofId: string; reading: ProofReading });
    },
  });

  /* ——— 1. Cargando ——— */
  if (link.isPending) {
    return (
      <Card className="space-y-3 p-6">
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-2/3" />
      </Card>
    );
  }

  if (link.isError) {
    return (
      <Card className="p-6">
        {link.error.status === 404 ? (
          <Alert layout="icon">
            <TriangleAlert aria-hidden />
            Este link de pago no existe. Pide a tu proveedor de internet el link correcto.
          </Alert>
        ) : (
          <Alert variant="warning" layout="icon">
            <TriangleAlert aria-hidden />
            No pudimos consultar tu cuenta en este momento. Intenta de nuevo en unos minutos.
          </Alert>
        )}
      </Card>
    );
  }

  const data = link.data;

  /* ——— Result states (5–9): the submitted payment's lifecycle ——— */
  const busy = pay.isPending || upload.isPending;
  const status =
    poll.data ??
    (payment
      ? {
          status: payment.status,
          validationAttempts: 1,
          nextValidationAt: null,
          error: payment.error,
          trackingKey: null,
          senderBank: null,
          transferDate: null,
          receiptStatus: null,
        }
      : null);
  if (payment && status) {
    const retry = () => {
      setPayment(null);
      setCorrecting(false);
      pay.reset();
      upload.reset();
      void queryClient.invalidateQueries({ queryKey: ["link", token] });
    };
    /* validation-status-ux D7: the payer who knows the receipt is wrong
       walks back to step 2, and the fresh submission supersedes this
       payment — without that, they would race their own tracking-key
       claim and be told TRANSFER_ALREADY_USED by themselves. */
    const startOverWithReceipt = () => {
      setResubmitOf(payment.directPaymentId);
      setPayment(null);
      setCorrecting(false);
      pay.reset();
      upload.reset();
      goTo("proof");
      void queryClient.invalidateQueries({ queryKey: ["link", token] });
    };
    return (
      <Card className="space-y-4 p-6" aria-live="polite">
        <header>
          <h1 className="text-lg font-semibold">{data.ispName}</h1>
          {data.customerName && <p className="text-sm text-ink-soft">{data.customerName}</p>}
        </header>

        {status.status === "validating" && (
          <>
            <StatusBadge status="validating" size="md" />
            {(() => {
              const notFound = status.error === "TRANSFER_NOT_FOUND";
              /* D18: the receipt's own Estatus is the one discriminator
                 we have. "En proceso" means the bank has not released
                 the transfer — there is nothing for the payer to
                 correct, at any attempt (validation-status-ux D1). */
              const enProceso = /proceso/i.test(status.receiptStatus ?? "");

              if (!notFound) {
                return (
                  <p className="text-sm text-ink-soft">
                    Estamos verificando tu transferencia. Esto puede tomar unos minutos; puedes
                    dejar esta página abierta.
                  </p>
                );
              }

              /* validation-status-ux D1–D5: honesty staged over time.
                 The clock is `validationAttempts` — the inline attempt
                 is #1 and the D7 slots [2,8,20,45,120,360] follow, so
                 the 45-minute attempt is #5: calm through 20 minutes,
                 the open form from 45. The long-wait copy keys on
                 distance instead — it exists to name the hour exactly
                 when the next attempt is far away. */
              const nextAt = status.nextValidationAt ?? null;
              const farAway = nextAt != null && nextAt - Date.now() > 90 * 60 * 1000;
              const escalated = status.validationAttempts >= 5;
              const nextHour = nextAt
                ? new Date(nextAt).toLocaleTimeString("es-MX", {
                    hour: "numeric",
                    minute: "2-digit",
                  })
                : null;
              const showForm = !enProceso && (correcting || (escalated && !farAway));

              return (
                <div className="space-y-4">
                  {enProceso ? (
                    <p className="text-sm text-ink-soft">
                      Tu comprobante dice “{status.receiptStatus}”: tu banco todavía no libera la
                      transferencia. Seguiremos intentando y no necesitas hacer nada.
                    </p>
                  ) : farAway ? (
                    /* D5: promise only what the system will do — the
                       cron keeps this hour; nobody "sends news" */
                    <p className="text-sm text-ink-soft">
                      Está tardando más de lo esperado.
                      {nextHour && (
                        <> Volveremos a intentarlo automáticamente alrededor de las {nextHour}.</>
                      )}{" "}
                      Puedes cerrar esta página y volver después, o contactar a tu proveedor de
                      internet con tu comprobante.
                    </p>
                  ) : escalated ? (
                    /* D3: the copy suspects the wait, never the payer */
                    <p className="text-sm text-ink-soft">
                      Está tardando más de lo normal. Revisa que estos datos coincidan con tu
                      comprobante y corrígelos si hace falta.
                    </p>
                  ) : (
                    <p className="text-sm text-ink-soft">
                      Validación en proceso: esperamos la respuesta de Banxico. No necesitas hacer
                      nada.
                    </p>
                  )}

                  {showForm ? (
                    /* The schedule keeps running underneath; whichever
                       resolves first wins (D3). */
                    <TransferForm
                      busy={busy}
                      draft={{
                        trackingKey: status.trackingKey,
                        senderBank: status.senderBank,
                        date: status.transferDate,
                      }}
                      submitLabel="Confirmar estos datos"
                      onSubmit={(transfer) =>
                        pay.mutate({
                          transfer,
                          ...(proofId ? { proofId } : {}),
                          supersedes: payment.directPaymentId,
                        })
                      }
                    />
                  ) : (
                    status.trackingKey && (
                      /* D2: verifying is free, editing is deliberate */
                      <Collapsible>
                        <CollapsibleTrigger className="group flex h-12 w-full items-center justify-between text-sm font-medium text-ink-soft transition-colors duration-150 hover:text-ink">
                          Ver los datos enviados
                          <ChevronDown
                            className="size-5 transition-transform duration-150 group-data-[state=open]:rotate-180"
                            aria-hidden
                          />
                        </CollapsibleTrigger>
                        <CollapsibleContent>
                          <div className="space-y-3 border-t border-line-soft pt-3">
                            <div className="divide-y divide-line-soft">
                              <div className="py-2">
                                <p className="text-sm text-ink-soft">Clave de rastreo</p>
                                <p className="break-all font-mono text-sm text-ink">
                                  {status.trackingKey}
                                </p>
                              </div>
                              {status.senderBank && (
                                <div className="py-2">
                                  <p className="text-sm text-ink-soft">Banco</p>
                                  <p className="text-sm text-ink">{status.senderBank}</p>
                                </div>
                              )}
                              {status.transferDate && (
                                <div className="py-2">
                                  <p className="text-sm text-ink-soft">Fecha</p>
                                  {/* Anchored to local midnight: bare
                                      "YYYY-MM-DD" parses as UTC and in
                                      Mexico that prints yesterday. */}
                                  <p className="text-sm text-ink">
                                    {new Date(`${status.transferDate}T00:00:00`).toLocaleDateString(
                                      "es-MX",
                                      { day: "numeric", month: "long", year: "numeric" },
                                    )}
                                  </p>
                                </div>
                              )}
                            </div>
                            <Button variant="secondary" onClick={() => setCorrecting(true)}>
                              Corregir estos datos
                            </Button>
                          </div>
                        </CollapsibleContent>
                      </Collapsible>
                    )
                  )}

                  {/* D7: the way out for the payer who already knows the
                      receipt is wrong — on every not_found screen */}
                  <Button
                    variant="ghost"
                    className="h-12 w-full text-sm"
                    onClick={startOverWithReceipt}
                  >
                    Subir otro comprobante
                  </Button>
                </div>
              );
            })()}
          </>
        )}

        {status.status === "confirmed" && (
          <>
            <StatusBadge status="paymentConfirmed" size="md" />
            <p className="text-sm text-ink-soft">
              {"reconnectionStatus" in status && status.reconnectionStatus === "reconnected"
                ? "Tu pago fue registrado. Tu servicio ya está activo."
                : "Tu pago fue registrado. Tu servicio se reactivará en unos minutos."}
            </p>
            {"folio" in status && status.folio && (
              <p className="font-mono text-sm text-ink-soft">Folio {status.folio}</p>
            )}
          </>
        )}

        {/* partial-payment D7: brutally honest, and in pesos. The payer is
            told what arrived, what is missing and what happens when the
            rest does — never a percentage, and never a green tick over a
            service that is still cut. */}
        {status.status === "partial" && (
          <>
            <StatusBadge status="paymentPartial" size="md" />
            <p className="text-sm text-ink-soft">
              {"receivedCents" in status && status.receivedCents != null ? (
                <>
                  Recibimos <Amount cents={status.receivedCents} /> de{" "}
                  <Amount cents={status.debtCents ?? 0} />.{" "}
                  {/* Three different facts, three sentences: reconnected
                      is done, queued needs no more money (the threshold
                      was met), and only withheld waits for the rest. */}
                  {status.reconnectionStatus === "reconnected"
                    ? "Tu servicio ya está activo."
                    : status.reconnectionStatus === "queued"
                      ? "Tu servicio se reactivará en unos minutos."
                      : "Tu servicio se reactivará cuando llegue el resto."}
                </>
              ) : (
                "Recibimos tu pago, pero no cubre todo el adeudo."
              )}
            </p>
            {"missingCents" in status && status.missingCents ? (
              /* The one number the payer has to act on — it gets the
                 weight of an amount, not of a footnote (D7). */
              <p className="text-xl font-semibold">
                Faltan <Amount cents={status.missingCents} />
              </p>
            ) : null}
            {"folio" in status && status.folio && (
              <p className="font-mono text-sm text-ink-soft">Folio {status.folio}</p>
            )}
            {/* UI contract: the SPEI instructions stay visible — the next
                action is another transfer, and hiding the CLABE behind a
                tap is a way to lose the payer. */}
            {data.speiClabe && (
              <div className="border-y border-line-soft">
                <CopyField label="CLABE" value={data.speiClabe} />
              </div>
            )}
            {/* Back to step 1, where the fresh debt and the rest of the
                data live. `retry` alone left the remembered step at
                `proof`, so this button used to land on the upload form. */}
            <Button
              variant="secondary"
              onClick={() => {
                goTo("transfer");
                retry();
              }}
            >
              Ver los datos para transferir
            </Button>
          </>
        )}

        {status.status === "invalid" && (
          <>
            <StatusBadge status="paymentInvalid" size="md" />
            <p className="text-sm text-ink-soft">
              {status.error
                ? payErrorCopy(status.error)
                : "No pudimos verificar tu transferencia. Revisa los datos e intenta de nuevo."}
            </p>
            <Button variant="secondary" onClick={retry}>
              Intentar de nuevo
            </Button>
          </>
        )}

        {status.status === "expired" && (
          <>
            <StatusBadge status="paymentExpired" size="md" />
            {/* D17: "no pudimos verificarlo" is a statement about us, not
                an accusation about the payer — and when we know which
                wall we hit, we say which. */}
            <p className="text-sm text-ink-soft">
              {status.error
                ? payErrorCopy(status.error)
                : "No pudimos confirmar tu pago a tiempo. Contacta a tu proveedor de internet con tu comprobante para resolverlo."}
            </p>
          </>
        )}

        {status.status === "unapplied" && (
          <>
            <StatusBadge status="unapplied" size="md" />
            <p className="text-sm text-ink-soft">
              Tu transferencia fue validada, pero tu cuenta ya estaba al corriente. Tu proveedor te
              contactará para resolverlo.
            </p>
          </>
        )}
      </Card>
    );
  }

  /* ——— 8. Canal no disponible ——— */
  if (data.status === "unavailable") {
    return (
      <Card className="space-y-4 p-6">
        <h1 className="text-lg font-semibold">{data.ispName}</h1>
        <Alert layout="icon">
          <Store aria-hidden />
          El pago por transferencia no está disponible por ahora. Paga en tu punto de cobro más
          cercano.
        </Alert>
      </Card>
    );
  }

  /* ——— 2. Sin adeudo ——— */
  if (data.status === "no_debt") {
    return (
      <Card className="space-y-4 p-6">
        <header>
          <h1 className="text-lg font-semibold">{data.ispName}</h1>
          {data.customerName && <p className="text-sm text-ink-soft">{data.customerName}</p>}
        </header>
        <Alert variant="success" layout="icon">
          <CheckCircle2 aria-hidden />
          Tu servicio está al corriente. No tienes pagos pendientes.
        </Alert>
      </Card>
    );
  }

  const submitError = pay.error ?? upload.error;

  /* One header for every screen the payer meets before submitting: the
     D18 confirmations below are still step 2 — nothing has been sent, and
     "subir otro comprobante" walks straight back into it (D19). */
  const stepHeader = (n: 1 | 2, title: string) => (
    <header className="space-y-1">
      <p className="text-sm font-medium text-ink-soft">Paso {n} de 2</p>
      <h1 className="text-lg font-semibold">{title}</h1>
      <p className="text-sm text-ink-soft">{data.ispName}</p>
      {data.customerName && <p className="text-sm text-ink-soft">{data.customerName}</p>}
    </header>
  );

  /* ——— 3b. Confirma lo que leímos (D18) ——— */
  if (draft) {
    const { reading, proofId } = draft;
    const startOver = () => {
      setDraft(null);
      upload.reset();
      pay.reset();
    };

    /* The model said this is not a receipt. Measured live: that same
       image sent to the provider makes it answer `error`, which is
       retryable, so the payment used to ride the whole six-hour schedule
       at up to seven paid calls and end `expired`. Here it costs the
       payer ten seconds and a second try. */
    if (reading.isReceipt === false) {
      return (
        <Card className="space-y-4 p-6">
          {stepHeader(2, "Envía tu comprobante")}
          <Alert variant="warning" layout="icon">
            <TriangleAlert aria-hidden />
            Esta imagen no parece un comprobante de transferencia. Sube la captura de tu
            comprobante, o captura los datos a mano.
          </Alert>
          <Button variant="secondary" onClick={startOver}>
            Intentar de nuevo
          </Button>
        </Card>
      );
    }

    /* The reading claims *more* than the debt: a misread, not a payment
       (partial-payment D12 — the contract keeps this direction refused).
       A lookup with it is proven to fail, so say both numbers now: it is
       the answer the payer would otherwise get six hours from now, or
       never. A reading that claims *less* is a short transfer, which is
       a valid submission and lands as `partial` (D1). */
    const readAmount = reading.amountCents;
    if (readAmount != null && data.totalCents != null && readAmount > data.totalCents) {
      return (
        <Card className="space-y-4 p-6">
          {stepHeader(2, "El monto no coincide")}
          <Alert variant="warning" layout="icon">
            <TriangleAlert aria-hidden />
            El monto de tu comprobante es mayor que tu adeudo, así que no podemos verificarlo.
          </Alert>
          <div className="divide-y divide-line-soft border-y border-line-soft">
            <div className="flex items-center justify-between py-2">
              <p className="text-sm text-ink-soft">Tu comprobante</p>
              <Amount cents={readAmount} className="font-semibold" />
            </div>
            <div className="flex items-center justify-between py-2">
              <p className="text-sm text-ink-soft">Tu adeudo</p>
              <Amount cents={data.totalCents} className="font-semibold" />
            </div>
          </div>
          <p className="text-sm text-ink-soft">
            Si transferiste otra cantidad, contacta a tu proveedor de internet para resolverlo. Si
            crees que leímos mal el comprobante, sube otra captura.
          </p>
          <Button variant="secondary" onClick={startOver}>
            Subir otro comprobante
          </Button>
        </Card>
      );
    }

    const missing =
      reading.gate.trackingKey !== "ok" ||
      reading.gate.senderBank !== "ok" ||
      /* validation-status-ux D6: an unread date is a missing field too */
      reading.date == null;
    return (
      <Card className="space-y-4 p-6">
        {stepHeader(2, "Confirma estos datos")}

        {/* Say plainly that a machine read this and the payer decides.
            The alternative — silently pre-filling and hoping — is how a
            misread becomes six hours of "Verificando". */}
        <Alert variant={missing ? "warning" : "default"} layout="icon">
          {missing ? <TriangleAlert aria-hidden /> : <ScanLine aria-hidden />}
          {missing
            ? "Leímos tu comprobante pero no pudimos sacar todos los datos. Complétalos y revísalos antes de continuar."
            : "Leímos estos datos de tu comprobante. Revísalos: si algo no coincide, corrígelo."}
        </Alert>

        {reading.receiptStatus && /proceso/i.test(reading.receiptStatus) && (
          <Alert variant="warning" layout="icon">
            <TriangleAlert aria-hidden />
            Tu comprobante dice “{reading.receiptStatus}”. Tu banco todavía no libera la
            transferencia, así que puede tardar en aparecer. Puedes continuar de todos modos.
          </Alert>
        )}

        <TransferForm
          busy={busy}
          draft={reading}
          submitLabel="Confirmar y verificar"
          onSubmit={(transfer) =>
            pay.mutate({
              transfer,
              proofId,
              ...(resubmitOf ? { supersedes: resubmitOf } : {}),
              /* D12: a short reading can reach this form now, and the
                 lookup must ask Banxico with the receipt's own amount —
                 asking with the expected total finds nothing. The status
                 rides along for the same reason it does on the silent
                 path. */
              receiptStatus: reading.receiptStatus ?? undefined,
              receiptAmountCents: reading.amountCents ?? undefined,
            })
          }
        />

        {submitError && (
          <Alert variant="destructive" layout="icon">
            <TriangleAlert aria-hidden />
            {payErrorCopy(submitError.code)}
          </Alert>
        )}

        <Button variant="ghost" onClick={startOver}>
          Subir otro comprobante
        </Button>
      </Card>
    );
  }

  /* ——— 3. Instrucciones de pago — two steps (D19) ——— */
  /* ——— 3a. Paso 1 — haz tu transferencia ——— */
  if (step === "transfer") {
    return (
      <Card className="space-y-5 p-6">
        {stepHeader(1, "Haz tu transferencia")}

        {/* The two things that get typed into the bank app, and nothing
            else at this weight (D19). The amount is shown once — it is
            the breakdown's own total — and copies as the plain number
            `<Amount>` already carries in its `data value`, because a
            formatted "$514.00" is not something a bank accepts. */}
        <div>
          <AmountBreakdown
            lines={[
              /* debt-truth D16: the invoice total, not the plan's price */
              { label: "Cargo del periodo", cents: data.invoiceCents! },
              /* debt-truth D11: what was already owed gets its own line.
                 Folded into the period's charge it would be a number that
                 matches no plan and explains nothing. */
              ...(data.carriedBalanceCents
                ? [{ label: "Adeudo anterior", cents: data.carriedBalanceCents }]
                : []),
              { label: "Cargo por servicio", cents: data.serviceFeeCents! },
            ]}
            totalLabel="Total a pagar"
          />
          <CopyButton
            variant="ghost"
            className="w-full justify-end px-0"
            text="Copiar monto exacto"
            value={(data.totalCents! / 100).toFixed(2)}
          />
        </div>

        <div className="border-y border-line-soft">
          <CopyField label="CLABE" value={data.speiClabe!} />
        </div>

        {/* Beneficiario, banco and concepto are checked once, if at all:
            reachable, not stacked on top of the two that are used (D19) */}
        <Collapsible>
          <CollapsibleTrigger className="group flex h-12 w-full items-center justify-between text-sm font-medium text-ink-soft transition-colors duration-150 hover:text-ink">
            Ver los demás datos
            <ChevronDown
              className="size-5 transition-transform duration-150 group-data-[state=open]:rotate-180"
              aria-hidden
            />
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="divide-y divide-line-soft border-t border-line-soft">
              <CopyField label="Beneficiario" value={data.speiBeneficiaryName!} />
              {data.speiBank && <CopyField label="Banco" value={data.speiBank} />}
              {data.reference && <CopyField label="Concepto" value={data.reference} />}
            </div>
          </CollapsibleContent>
        </Collapsible>

        <div className="space-y-2">
          {/* A way forward, not a claim we verify: the payer who already
              transferred yesterday arrives here too, and this is how
              they reach their receipt (D19). */}
          <Button size="critical" onClick={() => goTo("proof")}>
            Ya hice mi transferencia
          </Button>
          <p className="text-center text-sm text-ink-soft">
            Transfiere el monto exacto desde tu banco y vuelve aquí con tu comprobante.
          </p>
        </div>
      </Card>
    );
  }

  /* ——— 3b. Paso 2 — envía tu comprobante ——— */
  return (
    <Card className="space-y-5 p-6">
      {/* The first element on the screen, on purpose: a payer who tapped
          too early must not reload the page to see the CLABE again. */}
      <Button variant="ghost" className="-ml-2 h-10 px-2 text-sm" onClick={() => goTo("transfer")}>
        <ChevronLeft className="size-4" aria-hidden />
        Ver los datos otra vez
      </Button>

      {stepHeader(2, "Envía tu comprobante")}

      <ReceiptForm busy={busy} onSubmit={(file) => upload.mutate(file)} />

      {/* D18 earned the upload its primacy: the machine reads it and,
          when the reading holds, nobody is asked anything. Typing a
          28-character clave on a phone is the fallback, so it costs one
          deliberate tap — and stays open once it has been paid for. */}
      {manualDoor ? (
        <div className="space-y-4 border-t border-line-soft pt-5">
          <h2 className="text-base font-semibold">Datos de tu transferencia</h2>
          <TransferForm
            busy={busy}
            onSubmit={(transfer) =>
              pay.mutate({ transfer, ...(resubmitOf ? { supersedes: resubmitOf } : {}) })
            }
          />
        </div>
      ) : (
        <Button variant="ghost" className="h-12 w-full text-sm" onClick={() => setManualDoor(true)}>
          No tengo el comprobante a la mano
        </Button>
      )}

      {submitError && (
        <Alert variant="destructive" layout="icon">
          <TriangleAlert aria-hidden />
          {payErrorCopy(submitError.code)}
        </Alert>
      )}
    </Card>
  );
}
