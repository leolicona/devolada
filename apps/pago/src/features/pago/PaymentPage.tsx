import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  Amount,
  AmountBreakdown,
  Button,
  Card,
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
  Copy,
  CloudUpload,
  ScanLine,
  ShieldCheck,
  Store,
  TriangleAlert,
} from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { api, ApiError } from "@/api";
import { forgetLink, rememberLink } from "@/links";

/* The customer's payment page (direct-payment spec D9, D10): es-MX,
   "pago" never "cobro". Four flows — loading, instructions, verifying,
   result — plus the edge states the UI contract enumerates. */

const POLL_MS = 5000;

/* One SPEI field with its copy button: transfer apps want paste. */
function CopyField({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-center justify-between gap-3 py-2">
      <div className="min-w-0">
        <p className="text-sm text-ink-soft">{label}</p>
        <p className="break-all font-mono text-sm text-ink">{value}</p>
      </div>
      <Button
        variant="secondary"
        className="h-10 shrink-0 px-3 text-sm"
        onClick={() => {
          void navigator.clipboard?.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        }}
      >
        {copied ? <CheckCircle2 className="size-4" aria-hidden /> : <Copy className="size-4" aria-hidden />}
        {copied ? "Copiado" : `Copiar ${label.toLowerCase()}`}
      </Button>
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
  const [date, setDate] = useState(draft?.date ?? new Date().toISOString().slice(0, 10));
  /* D16/BUG-006: the same shape the API enforces, so the button is
     honest — a key that cannot validate never gets a paid call. */
  const valid =
    /^[A-Za-z0-9]{6,30}$/.test(trackingKey.trim()) &&
    senderBank !== "" &&
    /^\d{4}-\d{2}-\d{2}$/.test(date);
  return (
    <div className="space-y-4">
      <Field label="Clave de rastreo">
        <Input
          value={trackingKey}
          onChange={(e) => setTrackingKey(e.target.value)}
          placeholder="Está en tu comprobante"
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
  return (
    <div className="space-y-4">
      {/* PDF too: several banks hand out the comprobante as one, and
          apiCEP reads it (D12) */}
      <Field label="Captura o comprobante de tu transferencia">
        <Input
          type="file"
          accept="image/*,application/pdf"
          className="pt-2.5"
          onChange={(e) => {
            const picked = e.target.files?.[0] ?? null;
            setTooBig(Boolean(picked && picked.size > 1_000_000));
            setFile(picked);
          }}
        />
      </Field>
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
    if (linkData) rememberLink(token, linkData.customerName ?? linkData.ispName);
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
      const open = s.status === "validating" || (s.status === "confirmed" && s.reconnectionStatus !== "reconnected");
      return open ? POLL_MS : false;
    },
  });

  const pay = useMutation<
    PayResponse,
    ApiError,
    { proofId?: string; transfer?: object; supersedes?: string; receiptStatus?: string }
  >({
    mutationFn: (body) =>
      api<PayResponse>(`/direct-payments/links/${token}/pay`, {
        method: "POST",
        body: JSON.stringify(body),
      }),
    onSuccess: setPayment,
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
          body: JSON.stringify({ proofId }),
        });
      }
      /* D18: a reading that failed the gate is the one case where the
         payer must be asked *before* anything is spent — there is a
         visibly empty field and nothing to try. */
      const gated =
        reading.isReceipt === false ||
        reading.gate.trackingKey !== "ok" ||
        reading.gate.senderBank !== "ok";
      if (gated) return { proofId, reading };

      /* The gate passed, so try it silently. If the reading is right —
         and we have no measurement saying how often it is — nobody is
         asked anything, which is the whole reason not to put a
         confirmation in front of every payer. */
      return api<PayResponse>(`/direct-payments/links/${token}/pay`, {
        method: "POST",
        body: JSON.stringify({
          proofId,
          transfer: {
            trackingKey: reading.trackingKey,
            senderBank: reading.senderBank,
            date: reading.date ?? new Date().toISOString().slice(0, 10),
          },
          receiptStatus: reading.receiptStatus ?? undefined,
        }),
      });
    },
    onSuccess: (result) => {
      if ("directPaymentId" in result) setPayment(result);
      else setDraft(result as { proofId: string; reading: ProofReading });
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
      pay.reset();
      upload.reset();
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
                 correct, and asking would invite them to break a
                 reading that was right. */
              const enProceso = /proceso/i.test(status.receiptStatus ?? "");

              if (notFound && enProceso) {
                return (
                  <p className="text-sm text-ink-soft">
                    Tu comprobante dice “{status.receiptStatus}”: tu banco todavía no libera la
                    transferencia. Seguiremos intentando y no necesitas hacer nada.
                  </p>
                );
              }

              if (notFound && payment) {
                /* Asked on the *first* not_found, not after the schedule
                   runs out — waiting six hours to ask is the silence
                   this whole flow exists to remove. The schedule keeps
                   running underneath; whichever resolves first wins. */
                return (
                  <div className="space-y-4">
                    <p className="text-sm text-ink-soft">
                      Seguimos verificando tu pago; a veces Banxico tarda en publicarlo. De paso,
                      revisa que estos datos coincidan con tu comprobante y corrígelos si hace falta.
                    </p>
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
                  </div>
                );
              }

              return (
                <p className="text-sm text-ink-soft">
                  Estamos verificando tu transferencia. Esto puede tomar unos minutos; puedes dejar
                  esta página abierta.
                </p>
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
          <h1 className="text-lg font-semibold">{data.ispName}</h1>
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

    const missing =
      reading.gate.trackingKey !== "ok" || reading.gate.senderBank !== "ok";
    return (
      <Card className="space-y-4 p-6">
        <header>
          <h1 className="text-lg font-semibold">{data.ispName}</h1>
          <p className="text-sm text-ink-soft">Confirma los datos de tu comprobante</p>
        </header>

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
          onSubmit={(transfer) => pay.mutate({ transfer, proofId })}
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

  /* ——— 3. Instrucciones de pago ——— */
  return (
    <div className="space-y-4">
      <Card className="space-y-4 p-6">
        <header>
          <h1 className="text-lg font-semibold">{data.ispName}</h1>
          {data.customerName && <p className="text-sm text-ink-soft">{data.customerName}</p>}
        </header>

        <AmountBreakdown
          lines={[
            { label: "Mensualidad", cents: data.monthlyFeeCents! },
            { label: "Cargo por servicio", cents: data.serviceFeeCents! },
          ]}
          totalLabel="Total a pagar"
        />

        <div className="divide-y divide-line-soft border-t border-line-soft">
          <CopyField label="CLABE" value={data.speiClabe!} />
          <CopyField label="Beneficiario" value={data.speiBeneficiaryName!} />
          {data.speiBank && <CopyField label="Banco" value={data.speiBank} />}
          {data.reference && <CopyField label="Concepto" value={data.reference} />}
          <div className="py-2">
            <p className="text-sm text-ink-soft">Monto exacto</p>
            <Amount cents={data.totalCents!} className="text-md font-semibold" />
          </div>
        </div>

        <p className="text-sm text-ink-soft">
          Haz la transferencia por el monto exacto desde tu banco y luego envíanos tu comprobante
          aquí abajo.
        </p>
      </Card>

      <Card className="space-y-4 p-6">
        <h2 className="text-base font-semibold">Ya pagué: enviar comprobante</h2>
        <Tabs defaultValue="receipt">
          <TabsList>
            <TabsTrigger value="receipt">Subir comprobante</TabsTrigger>
            <TabsTrigger value="transfer">Datos de la transferencia</TabsTrigger>
          </TabsList>
          <TabsContent value="receipt" className="mt-4">
            <ReceiptForm busy={busy} onSubmit={(file) => upload.mutate(file)} />
          </TabsContent>
          <TabsContent value="transfer" className="mt-4">
            <TransferForm busy={busy} onSubmit={(transfer) => pay.mutate({ transfer })} />
          </TabsContent>
        </Tabs>

        {submitError && (
          <Alert variant="destructive" layout="icon">
            <TriangleAlert aria-hidden />
            {payErrorCopy(submitError.code)}
          </Alert>
        )}
      </Card>
    </div>
  );
}
