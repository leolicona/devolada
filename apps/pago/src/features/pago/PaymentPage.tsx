import { useEffect, useId, useRef, useState, type RefObject } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  Amount,
  AmountBreakdown,
  Button,
  Card,
  cn,
  Field,
  formatMoney,
  Input,
  Pending,
  Reveal,
  Skeleton,
  StatusBadge,
} from "@devolada/ui";
import { BANKS, groupReferenceDigits, isGenericReference } from "@devolada/api/direct-payments-schema";
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
  Camera,
  Copy,
  CloudUpload,
  Info,
  ScanLine,
  ShieldCheck,
  Store,
  TimerOff,
  TriangleAlert,
  Wifi,
} from "lucide-react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { api, ApiError } from "@/api";
import { readAskAck, rememberAskAck } from "@/ask-ack";
import { forgetLink, rememberLink } from "@/links";
import { forgetStep, readStep, rememberStep, type Step } from "@/step";
import { CaptureGuide, type GuideState } from "./CaptureGuide";
import { ConfirmPayment } from "./ConfirmPayment";
import { bankHint, bankLabel, GENERAL_HINT } from "./bank-hints";
import { dayOfMonth, shiftDay, spokenDays, todayIn } from "./days";
import { inlineReference, referenceHint } from "./reference-hints";

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
function CopyField({
  label,
  value,
  copy,
  note,
}: {
  label: string;
  value: string;
  /* payment-without-receipt D21/D22: what the button copies, when it is
     not what the payer reads — the reference reads "234 5678" and a bank
     takes "2345678" */
  copy?: string;
  /* A line under the value (FR-004: "Son los últimos 7 números de tu
     celular") */
  note?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3 py-2">
      <div className="min-w-0">
        <p className="text-sm text-ink-soft">{label}</p>
        <p className="break-all font-mono text-sm text-ink">{value}</p>
        {note && <p className="text-sm text-ink-soft">{note}</p>}
      </div>
      <CopyButton value={copy ?? value} srSuffix={label} />
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
  /* receipt-triage D7, D17: both are answered with the clave */
  REFERENCE_SHARED:
    "Esta referencia la usan muchas transferencias. Escribe tu clave de rastreo para encontrar la tuya.",
  REFERENCE_AMBIGUOUS:
    "Tu número de referencia coincide con más de una transferencia. Escribe tu clave de rastreo para encontrar la tuya.",
  /* cep-bundle-match D10: Banxico's answer did not say which transfer is
     the payer's — asked with the clave, like the two above */
  CEP_UNDECIDED:
    "Encontramos más de una transferencia que podría ser la tuya. Escribe tu clave de rastreo para saber cuál es.",
  /* cep-bundle-match D10: every transfer found already paid something —
     possibly this payer's own earlier payment, so it says so first */
  CEP_ALL_USED:
    "Las transferencias que encontramos con estos datos ya se usaron para otros pagos. Si ya habías pagado, tu pago puede estar confirmado. Si esta transferencia es nueva, escribe su clave de rastreo.",
  /* bug: single-cep-unreadable: Banxico found one transfer, and it could
     not be confirmed as the payer's — "más de una" was false here */
  CEP_SINGLE_UNDECIDED:
    "Encontramos una transferencia con tus datos, pero no pudimos confirmar que sea tuya. Escribe tu clave de rastreo para confirmarla.",
  /* payment-without-receipt (contracts/payment-page.md "Refusals"): the
     pay route's five new refusals, each before anything is created or
     billed. REFERENCE_NOT_READY has no sentence of its own: the page falls
     back to the receipt step and says so there (D8). */
  TRANSFER_DATE_OUT_OF_RANGE: "Elige un día de los últimos 30 días.",
  REFERENCE_OF_ANOTHER: "Esa referencia es de otra persona. Escribe tu clave de rastreo o sube tu comprobante.",
  /* D11 (FR-032): asked, never offered — the page does not know the digits */
  SENDER_TAIL_NEEDED: "Escribe los últimos 4 dígitos de la cuenta o tarjeta con la que pagaste.",
  CORRECTIONS_EXHAUSTED:
    "Ya corregiste tus datos varias veces. Escribe tu clave de rastreo o sube tu comprobante.",
};
const payErrorCopy = (code: string) =>
  payErrors[code] ?? "No pudimos recibir tu comprobante. Intenta de nuevo en unos minutos.";

/* payment-without-receipt D24 (FR-013): a used transfer names the payment
   that used it — only when that payment is the same person's, which is
   the only time the status carries `usedBy`. Otherwise today's sentence,
   and nothing of anybody else's payment. */
function statusErrorCopy(status: Pick<DirectPaymentStatusResponse, "error" | "usedBy">): string | null {
  if (!status.error) return null;
  if ((status.error === "TRANSFER_ALREADY_USED" || status.error === "CEP_ALL_USED") && status.usedBy) {
    return `Ya se usó para tu pago del ${dayOfMonth(status.usedBy.day)} por ${formatMoney(status.usedBy.amountCents)}.`;
  }
  return payErrorCopy(status.error);
}

type TransferDraft = {
  trackingKey?: string | null;
  referenceNumber?: string | null;
  senderBank?: string | null;
  date?: string | null;
};

/* What the form sends: at least one key (receipt-triage FR-005) */
type TypedTransfer = {
  trackingKey?: string;
  referenceNumber?: string;
  senderBank: string;
  date: string;
  amountCents: number;
  /* payment-without-receipt D11: only when the server asked for it */
  senderTail?: string;
};

/* receipt-triage D2/D7: the one sentence for a reference that cannot find
   the transfer alone — generic, or already used that day */
const SHARED_REFERENCE_NOTE =
  "Esta referencia la usan muchas transferencias. Escribe tu clave de rastreo para encontrar la tuya.";

/* bug: spei-date-rollover — "today" is the business's day: `todayIn`
   lives in ./days since payment-without-receipt, whose day row counts
   back from the same "today". */

function TransferForm({
  onSubmit,
  busy,
  draft,
  amountCents,
  timezone,
  submitLabel = "Verificar mi pago",
  announce = true,
  keys = "either",
  requireClave = false,
  focusClave = false,
  missing,
  onUploadInstead,
  typed = false,
  referenceLabel = "Número de referencia",
  askSenderTail = false,
  dateRange,
}: {
  onSubmit: (t: TypedTransfer) => void;
  busy: boolean;
  /* design-foundations US1 (converge F1): whether this form owns the
     announcement of its own wait. False on the instance rendered inside the
     status Card, which is already aria-live="polite" — a second announcer
     there reads the state out twice. True everywhere else, because outside
     that Card nothing announces at all. */
  announce?: boolean;
  /* D18: what the reader proposed. Every field is editable and none is
     trusted — the payer is the one who confirms, and a field the gate
     did not pass arrives here empty rather than pre-filled with
     something that merely looks confirmable. */
  draft?: TransferDraft;
  /* claimed-amount D3: the field's starting value — the expected total,
     or what the payment already claimed. Pre-filled so the exact payer
     confirms without touching it; editable because only the payer knows
     what really left their account. */
  amountCents?: number | null;
  /* bug: spei-date-rollover — the business's zone, for the manual door's
     "today" */
  timezone?: string;
  submitLabel?: string;
  /* receipt-triage D17: after the provider said the reference matches
     more than one transfer, only the clave can find it — the form asks
     for it alone */
  keys?: "either" | "clave";
  /* receipt-triage D7: the reference is one another payment already holds
     that day, so the clave is required beside it */
  requireClave?: boolean;
  /* cep-bundle-match D10 (contracts/payment-page.md): the ask for the
     clave alone takes focus on its one field when it appears */
  focusClave?: boolean;
  /* receipt-triage D18 (FR-011): the fields the capture did not show,
     each marked in text under its field */
  missing?: ReadonlySet<"key" | "amount" | "date" | "senderBank">;
  /* receipt-triage D18: the way back to the picker, at the form's end */
  onUploadInstead?: () => void;
  /* payment-without-receipt D11 (analysis I8): "No puse la referencia"
     and the corrections of a row searched by reference. A default-looking
     reference is not refused here: digits no person holds go on as a
     shared reference, tied to this payer by a learned account or by the
     four digits the server asks for — so the clave is not demanded */
  typed?: boolean;
  /* The reference field's label, for the door it serves */
  referenceLabel?: string;
  /* D11 (FR-032): the server answered SENDER_TAIL_NEEDED — the four digits
     of the sending account, typed by the payer and never suggested. A
     clave typed instead is enough on its own. */
  askSenderTail?: boolean;
  /* D8: the days a search by reference accepts, business time */
  dateRange?: { min: string; max: string };
}) {
  const [referenceNumber, setReferenceNumber] = useState(draft?.referenceNumber ?? "");
  const [trackingKey, setTrackingKey] = useState(draft?.trackingKey ?? "");
  const [senderBank, setSenderBank] = useState(draft?.senderBank ?? "");
  /* validation-status-ux D6: a draft with no date arrives empty — the
     machine did not read one, and pre-filling *today* invents a value
     that merely looks confirmed. Only the manual door, where the payer
     types everything, keeps today as the honest same-day prior. */
  const [date, setDate] = useState(
    draft ? (draft.date ?? "") : todayIn(timezone),
  );
  const [amount, setAmount] = useState(
    amountCents != null ? (amountCents / 100).toFixed(2) : "",
  );
  const [senderTail, setSenderTail] = useState("");
  /* Pesos in, integer cents out — the only place the page parses money,
     and only because the payer is the source of truth here (D1). */
  const amountOk = /^\d+(\.\d{1,2})?$/.test(amount.trim()) && Number.parseFloat(amount) > 0;
  /* D16/BUG-006: the same shape the API enforces, so the button is
     honest — a key that cannot validate never gets a paid call. */
  const claveOk = /^[A-Za-z0-9]{6,30}$/.test(trackingKey.trim());
  /* receipt-triage D12: 1 to 7 digits as printed, leading zeros kept */
  const referenceOk = keys === "either" && /^\d{1,7}$/.test(referenceNumber);
  /* receipt-triage D2 (clarified 2026-09-24): the schema's own rule, so
     the page and a client that skipped it refuse the same reference */
  const generic = keys === "either" && !typed && isGenericReference(referenceNumber);
  const claveRequired = keys === "clave" || generic || requireClave;
  const keyOk = claveRequired ? claveOk : claveOk || referenceOk;
  /* payment-without-receipt D11: the four digits tie a typed reference to
     this payer; a clave needs no tie */
  const tailOk = !askSenderTail || claveOk || /^\d{4}$/.test(senderTail);
  const dateOk =
    /^\d{4}-\d{2}-\d{2}$/.test(date) && (!dateRange || (date >= dateRange.min && date <= dateRange.max));
  const valid = keyOk && tailOk && senderBank !== "" && dateOk && amountOk;
  const notInCapture = (field: "key" | "amount" | "date" | "senderBank") =>
    missing?.has(field) ? <p className="mt-1 text-sm text-ink-soft">No aparece en tu captura</p> : null;
  const claveField = (
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
        autoFocus={focusClave}
      />
    </Field>
  );
  return (
    <div className="space-y-4">
      {keys === "clave" ? (
        <div>
          {claveField}
          {notInCapture("key")}
        </div>
      ) : (
        /* receipt-triage FR-005 (clarified 2026-09-24): the reference
           leads — it is short, digits only, and printed on receipts that
           show no clave — and the clave is the alternative. Either one is
           enough, unless the reference cannot find the transfer alone. */
        <div className="space-y-3">
          <div>
            <Field label={referenceLabel}>
              <Input
                inputMode="numeric"
                value={referenceNumber}
                /* digits only, as printed: a leading zero is part of it */
                onChange={(e) => setReferenceNumber(e.target.value.replace(/\D/g, "").slice(0, 7))}
                placeholder="Hasta 7 dígitos"
                className="font-mono text-sm"
                autoComplete="off"
              />
            </Field>
            <p className="mt-1 text-sm text-ink-soft">
              {generic || requireClave ? SHARED_REFERENCE_NOTE : "Hasta 7 dígitos, con los ceros del inicio."}
            </p>
            {notInCapture("key")}
          </div>
          <p className="text-sm font-medium text-ink-soft">
            ¿No tienes número de referencia? Escribe tu clave de rastreo
          </p>
          {claveField}
          <p className="text-sm text-ink-soft">
            {claveRequired ? "Escribe tu clave de rastreo." : "Con uno basta."}
          </p>
        </div>
      )}
      {askSenderTail && (
        <div>
          <p className="mb-2 text-sm text-ink-soft">{payErrorCopy("SENDER_TAIL_NEEDED")}</p>
          <Field label="Últimos 4 dígitos de tu cuenta o tarjeta">
            <Input
              inputMode="numeric"
              value={senderTail}
              onChange={(e) => setSenderTail(e.target.value.replace(/\D/g, "").slice(0, 4))}
              className="font-mono text-sm"
              autoComplete="off"
              autoFocus
            />
          </Field>
        </div>
      )}
      <div>
        <Field label="Monto transferido">
          {/* claimed-amount D1/D3: what travels to Banxico is what the
              payer says they sent — the debt only suggests the default.
              The $ prefix is the same anchor the admin's money inputs
              carry: an input cannot render through <Amount>, but it can
              still look like pesos. */}
          <Input
            prefix="$"
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0.00"
            autoComplete="off"
          />
        </Field>
        {notInCapture("amount")}
      </div>
      <div>
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
        {notInCapture("senderBank")}
      </div>
      <div>
        <Field label="Fecha de la transferencia">
          <Input
            type="date"
            value={date}
            min={dateRange?.min}
            max={dateRange?.max}
            onChange={(e) => setDate(e.target.value)}
          />
        </Field>
        {notInCapture("date")}
      </div>
      {/* design-foundations US1 (converge F2): the send is a wait like any
          other. Before this it was carried by a greyed-out button and a
          changed word — which is the one thing FR-008 refuses to rely on,
          because it makes the payer read to find out whether the app is
          alive. Pending's flash threshold means a fast connection still sees
          nothing; a slow one, which is when someone taps twice, sees the
          screen working. */}
      <Pending active={busy} announce={announce} label="Estamos enviando tus datos.">
        <Button
          size="decisive"
          disabled={!valid || busy}
          onClick={() =>
            onSubmit({
              /* receipt-triage D1: whatever key the payer typed travels to
                 the server, which sends only the clave when both exist */
              ...(claveOk ? { trackingKey: trackingKey.trim() } : {}),
              ...(referenceOk ? { referenceNumber } : {}),
              senderBank: senderBank.trim(),
              date,
              amountCents: Math.round(Number.parseFloat(amount) * 100),
              ...(askSenderTail && !claveOk ? { senderTail } : {}),
            })
          }
        >
          <ShieldCheck className="size-5" aria-hidden />
          {busy ? "Enviando…" : submitLabel}
        </Button>
      </Pending>
      {onUploadInstead && (
        <Button variant="ghost" className="h-12 w-full text-sm" onClick={onUploadInstead}>
          Mejor subo otra captura
        </Button>
      )}
    </div>
  );
}

function ReceiptForm({
  onSubmit,
  busy,
  reading = false,
  inputRef,
}: {
  onSubmit: (file: File) => void;
  busy: boolean;
  /* receipt-triage D8/D20: `/read` is running on the file just sent */
  reading?: boolean;
  /* receipt-triage D18: "Subir otra captura" moves focus here */
  inputRef?: RefObject<HTMLInputElement | null>;
}) {
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

          PDF too: several banks hand out the comprobante as one. It is
          read here like a picture since two-eyes-receipt D1 — turned
          into text at the edge and read by the same model — so it gets
          the same draft and the same protections. A scanned PDF, which
          has no text to extract, is handed to the provider unread and
          silently (D15): the payer is told nothing, because there is
          nothing they could do about it. */}
      <input
        ref={inputRef}
        id={inputId}
        type="file"
        accept="image/*,application/pdf"
        className="peer sr-only"
        onChange={(e) => {
          const picked = e.target.files?.[0] ?? null;
          setTooBig(Boolean(picked && picked.size > 1_000_000));
          setFile(picked);
        }}
      />
      <label
        htmlFor={inputId}
        /* receipt-triage T049: the input before the label is visually
           hidden, so its own focus ring would draw on a 1px box — the
           label, its peer, wears the same ring when the input has
           keyboard focus */
        className="flex cursor-pointer flex-col items-center gap-2 rounded-sm border border-dashed border-line-input bg-well px-4 py-8 text-center peer-focus-visible:[box-shadow:var(--shadow-focus)]"
      >
        <CloudUpload className="size-6 text-ink-soft" aria-hidden />
        <span className="break-all text-base font-medium text-ink">
          {file ? file.name : "Toca para subir tu captura"}
        </span>
        {reading ? (
          /* receipt-triage D20: the file row breathes while the reader
             reads it — the design system's waiting motion, opacity only */
          <Pending active label="Leyendo tu captura." announce={false}>
            <span data-motion="breath" className="animate-breath text-sm text-ink-soft">
              Leyendo tu captura…
            </span>
          </Pending>
        ) : (
          <span className="text-sm text-ink-soft">
            Captura o comprobante de tu transferencia · imagen o PDF, hasta 1 MB
          </span>
        )}
      </label>

      {tooBig && (
        <Alert variant="warning" layout="icon">
          <TriangleAlert aria-hidden />
          El archivo pesa más de 1 MB. Toma la captura de nuevo o usa los datos de tu transferencia.
        </Alert>
      )}
      {/* design-foundations US1 (converge F1, F2). This form only ever renders
          outside the status Card, so it owns its own announcement. The upload
          is where a weak mobile connection hurts most: silence here is what
          makes a payer send the same proof twice. */}
      <Pending active={busy} label="Estamos subiendo tu comprobante.">
        <Button size="decisive" disabled={!file || tooBig || busy} onClick={() => file && onSubmit(file)}>
          <CloudUpload className="size-5" aria-hidden />
          {busy ? "Subiendo…" : "Enviar comprobante"}
        </Button>
      </Pending>
    </div>
  );
}

/* receipt-triage D29: the one account the payer sends money to. A page
   answered by a server from before the feature carries only the CLABE. */
type CollectAccount = NonNullable<LinkStatusResponse["collectAccount"]>;
function collectAccountOf(data: LinkStatusResponse): CollectAccount | null {
  if (data.collectAccount) return data.collectAccount;
  return data.speiClabe ? { kind: "clabe", value: data.speiClabe, bank: data.speiBank ?? "" } : null;
}
const ACCOUNT_LABEL: Record<CollectAccount["kind"], string> = {
  clabe: "CLABE",
  card: "Tarjeta de débito",
  phone: "Celular",
};
/* "…recibe pagos en {tipo} terminada en {últimos 4}" — the noun and its
   agreement */
const ACCOUNT_ENDING: Record<CollectAccount["kind"], string> = {
  clabe: "CLABE terminada en",
  card: "tarjeta terminada en",
  phone: "celular terminado en",
};

/* receipt-triage D5 (FR-009): the other fields a capture lacked, named in
   the form's order and joined the way a person says them */
const FIELD_NAME = { amount: "el monto", date: "la fecha", senderBank: "el banco" } as const;
function alsoMissing(fields: readonly string[]): string | null {
  const names = fields.filter((f) => f !== "key").map((f) => FIELD_NAME[f as keyof typeof FIELD_NAME]);
  if (!names.length) return null;
  const list = names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} ni ${names[names.length - 1]}`;
  return `Tampoco vemos ${list}.`;
}

/* receipt-triage D6/D19: where the payer's bank shows the data, when a
   verified hint exists — the later asks' extra line */
function whereLine(bank: string | null | undefined): string | null {
  const found = bankHint(bank);
  return found ? `En ${found.bank}: ${found.hint.where}.` : null;
}

/* ——— payment-without-receipt: a row searched by reference ———
   A row with a `referenceSource` (D23) was confirmed with a bank and a day,
   not proven by a capture, so what it searches is the payer's own word and
   the page keeps it in front of them (FR-023). What it asks comes from the
   server's `ask` (D15), never from the attempt count: such a row never
   opens the form because `validationAttempts` reached five. */

type PayBody = {
  proofId?: string;
  transfer?: object;
  supersedes?: string;
  receiptStatus?: string;
  receiptAmountCents?: number;
};

/* D8/D11: the row's own search as a pay body's `transfer` — what an ask
   re-sends beside the one fact it asked for. An own row sends no
   reference: the server writes it. */
function rowTransfer(s: DirectPaymentStatusResponse) {
  const base = {
    senderBank: s.senderBank ?? "",
    date: s.transferDate ?? "",
    ...(s.claimedAmountCents != null ? { amountCents: s.claimedAmountCents } : {}),
  };
  return s.referenceSource === "own"
    ? { referenceSource: "own" as const, ...base }
    : {
        referenceSource: "typed" as const,
        referenceNumber: s.referenceNumber ?? "",
        ...base,
        ...(s.senderTail ? { senderTail: s.senderTail } : {}),
      };
}

/* FR-024: a correction keeps the row's path. Own stays own, with no
   reference sent, while the payer leaves the reference as it was; a
   changed reference is a typed one (D11); a clave is today's door, which
   carries no path at all (D25 keeps it out of the hourly budget). */
function correctionTransfer(t: TypedTransfer, s: DirectPaymentStatusResponse) {
  const base = { senderBank: t.senderBank, date: t.date, amountCents: t.amountCents };
  if (t.trackingKey) {
    return {
      trackingKey: t.trackingKey,
      ...(t.referenceNumber ? { referenceNumber: t.referenceNumber } : {}),
      ...base,
    };
  }
  if (s.referenceSource === "own" && t.referenceNumber === s.referenceNumber) {
    return { referenceSource: "own" as const, ...base };
  }
  const tail = t.senderTail ?? s.senderTail ?? undefined;
  return {
    referenceSource: "typed" as const,
    referenceNumber: t.referenceNumber,
    ...base,
    ...(tail ? { senderTail: tail } : {}),
  };
}

/* FR-023: what is searched, as the payer gave it — amount, reference,
   bank, the day (or every day the rounds searched, D14) and the tail or
   clave they typed. Never an account Devolada learned (FR-019): the status
   carries none. */
function SearchedData({ status, fallbackCents }: { status: DirectPaymentStatusResponse; fallbackCents?: number }) {
  const days = status.searchedDays?.length ? status.searchedDays : status.transferDate ? [status.transferDate] : [];
  const cents = status.claimedAmountCents ?? fallbackCents;
  const rows: { label: string; value: string; mono?: boolean }[] = [
    ...(cents != null ? [{ label: "Monto", value: formatMoney(cents) }] : []),
    ...(status.referenceNumber
      ? [{ label: "Referencia", value: groupReferenceDigits(status.referenceNumber), mono: true }]
      : []),
    ...(status.senderBank ? [{ label: "Banco", value: bankLabel(status.senderBank) }] : []),
    ...(days.length
      ? [{ label: days.length > 1 ? "Días buscados" : "Día", value: spokenDays(days) }]
      : []),
    ...(status.senderTail
      ? [{ label: "Últimos 4 dígitos de tu cuenta", value: status.senderTail, mono: true }]
      : []),
    ...(status.trackingKey ? [{ label: "Clave de rastreo", value: status.trackingKey, mono: true }] : []),
  ];
  return (
    <div className="divide-y divide-line-soft">
      {rows.map((row) => (
        <div key={row.label} className="py-2">
          <p className="text-sm text-ink-soft">{row.label}</p>
          {/* break-all for codes only: a sentence breaks between words */}
          <p className={cn("text-sm text-ink", row.mono ? "break-all font-mono" : "break-words")}>{row.value}</p>
        </div>
      ))}
    </div>
  );
}

/* D11 (FR-032) and D17: four characters the payer types — the sending
   account's last digits, or the clave's last characters. Never offered:
   the page does not know them, and would not show them if it did. */
function TailAsk({
  label,
  kind,
  busy,
  onSubmit,
}: {
  label: string;
  kind: "digits" | "characters";
  busy: boolean;
  onSubmit: (value: string) => void;
}) {
  const [value, setValue] = useState("");
  const ok = kind === "digits" ? /^\d{4}$/.test(value) : /^[A-Za-z0-9]{4}$/.test(value);
  return (
    <div className="space-y-4">
      <Field label={label}>
        <Input
          inputMode={kind === "digits" ? "numeric" : "text"}
          value={value}
          onChange={(e) =>
            setValue(
              (kind === "digits" ? e.target.value.replace(/\D/g, "") : e.target.value.replace(/[^A-Za-z0-9]/g, "")).slice(
                0,
                4,
              ),
            )
          }
          className="font-mono text-sm"
          autoComplete="off"
          autoFocus
        />
      </Field>
      {/* The Card around this is already aria-live="polite" */}
      <Pending active={busy} announce={false} label="Estamos enviando tus datos.">
        <Button size="decisive" disabled={!ok || busy} onClick={() => onSubmit(value)}>
          <ShieldCheck className="size-5" aria-hidden />
          {busy ? "Enviando…" : "Enviar"}
        </Button>
      </Pending>
    </div>
  );
}

/* D18: with a provisional release standing, an ask never reads as the
   service being withdrawn — it says what settles the payment in time */
const RELEASE_DURING_ASK =
  "Tu servicio sigue activo. Tu clave o tu comprobante confirman el pago antes de que venza.";

function SourcedReview({
  status,
  data,
  directPaymentId,
  busy,
  payError,
  paused = false,
  onPay,
  onReceipt,
}: {
  status: DirectPaymentStatusResponse;
  data: LinkStatusResponse;
  directPaymentId: string;
  busy: boolean;
  /* The refusal of this row's last correction or answer */
  payError: ApiError | null;
  /* prepaid-credit D9: the business paused validation — nothing is
     searched, and the data stay correctable (FR-023) */
  paused?: boolean;
  onPay: (body: PayBody) => void;
  onReceipt: () => void;
}) {
  /* D15: "Todo está bien" lives on this device, per payment */
  const [acked, setAcked] = useState(() => readAskAck(directPaymentId));
  const [correcting, setCorrecting] = useState(false);
  const refused = payError?.code ?? null;
  /* D16 (FR-024) and D11 (FR-034): after these two refusals the clave and
     the receipt are what is left, and the page says so in the ask's place */
  const clavesOnly = refused === "CORRECTIONS_EXHAUSTED" || refused === "REFERENCE_OF_ANOTHER";
  const ask = paused
    ? null
    : clavesOnly
      ? "clave"
      : status.ask === "check_data" && acked
        ? null
        : (status.ask ?? null);
  const editing = correcting && !clavesOnly;
  const release = status.provisionalRelease ?? null;
  const reference = status.referenceNumber ?? data.payerReference?.digits ?? null;
  const today = todayIn(data.timezone);
  /* D8: the days a search by reference accepts */
  const dateRange = { min: shiftDay(today, -30), max: today };
  const complete = Boolean(status.senderBank && status.transferDate);
  const supersede = (transfer: object) => onPay({ transfer, supersedes: directPaymentId });
  const used =
    status.error === "TRANSFER_ALREADY_USED" || status.error === "CEP_ALL_USED" ? statusErrorCopy(status) : null;

  /* contracts/payment-page.md, the asks: each says what was searched and
     what could differ, and never suggests the payer lied (FR-037) */
  const askCopy =
    ask === "check_data"
      ? `Todavía no encontramos tu transferencia. Revisa que estos datos sean los de tu app, y que hayas puesto la referencia ${reference ? inlineReference(reference) : ""}.`
      : ask === "clave"
        ? clavesOnly
          ? payErrorCopy(refused!)
          : "Para encontrarla con seguridad, escribe tu clave de rastreo. Puedes copiarla del detalle de la transferencia en tu app."
        : ask === "sender_tail"
          ? /* D26 (FR-041): an own row asked during a reference's transition
               is being told apart from the previous holder — the digits are
               not "shared by others" from where this payer stands */
            status.referenceSource === "own"
            ? "Para confirmar que esta transferencia es tuya, escribe los últimos 4 dígitos de la cuenta o tarjeta con la que pagaste."
            : "Esa referencia la usan otras personas. Escribe los últimos 4 dígitos de la cuenta o tarjeta con la que pagaste."
          : ask === "clave_tail"
            ? "Encontramos más de una transferencia con esos datos. Escribe los últimos 4 caracteres de tu clave de rastreo."
            : null;

  /* An ask with its own field puts the receipt right after it, second
     (FR-029, FR-031); otherwise the receipt waits at the end, quieter */
  const askForm = !editing && (ask === "clave" || ((ask === "sender_tail" || ask === "clave_tail") && complete));
  const receiptButton = (quiet: boolean) => (
    <Button variant={quiet ? "ghost" : "secondary"} className="h-12 w-full text-sm" onClick={onReceipt}>
      Sube tu comprobante
    </Button>
  );

  return (
    <div className="space-y-4">
      {paused ? (
        <Alert variant="warning" layout="icon">
          <Info aria-hidden />
          Este negocio pausó la validación de pagos. Tus datos quedaron guardados y se buscarán en cuanto
          la reactiven. No tienes que hacer nada más.
        </Alert>
      ) : askCopy ? (
        <Alert variant="warning" layout="icon">
          <TriangleAlert aria-hidden />
          <div className="space-y-2">
            <p>{askCopy}</p>
            {release && <p>{RELEASE_DURING_ASK}</p>}
          </div>
        </Alert>
      ) : (
        <>
          {/* Waiting breathes (constitution VI). announce={false}: the Card
              around this is already aria-live="polite". */}
          <Pending active announce={false} label="Seguimos buscando tu transferencia.">
            <p className="text-sm text-ink-soft">Seguimos buscando tu transferencia en Banxico.</p>
          </Pending>
          {release && (
            /* provisional-release D9: one sentence, evidence fused with
               consequence; a confirmation is `human` evidence (D18) */
            <Reveal>
              <Alert variant="success" layout="icon">
                {release.kind === "protect" ? <ShieldCheck aria-hidden /> : <Wifi aria-hidden />}
                {release.kind === "protect"
                  ? "Tu pago se está verificando. Tu servicio sigue activo — no necesitas hacer nada."
                  : release.evidence === "human"
                    ? "Gracias por confirmar tus datos. Tu internet ya volvió mientras Banxico responde."
                    : "Tu transferencia está en camino y tu internet ya volvió. Solo esperamos la confirmación de Banxico — no necesitas hacer nada."}
              </Alert>
            </Reveal>
          )}
        </>
      )}

      {used && <p className="text-sm text-ink-soft">{used}</p>}

      {askForm && ask === "clave" && (
        /* FR-029: the whole clave, nothing having been found to compare a
           part of it with; the rest of the search is kept. It travels by
           today's door, with no path (contracts/payment-page.md). */
        <TransferForm
          keys="clave"
          focusClave
          busy={busy}
          announce={false}
          draft={{ trackingKey: null, senderBank: status.senderBank, date: status.transferDate }}
          amountCents={status.claimedAmountCents ?? data.totalCents ?? null}
          dateRange={dateRange}
          submitLabel="Buscar con mi clave"
          onSubmit={(t) => supersede(t)}
        />
      )}
      {askForm && ask === "sender_tail" && (
        <TailAsk
          label="Últimos 4 dígitos de tu cuenta o tarjeta"
          kind="digits"
          busy={busy}
          onSubmit={(senderTail) => supersede({ ...rowTransfer(status), senderTail })}
        />
      )}
      {askForm && ask === "clave_tail" && (
        <TailAsk
          label="Últimos 4 caracteres de tu clave de rastreo"
          kind="characters"
          busy={busy}
          onSubmit={(claveTail) => supersede({ ...rowTransfer(status), claveTail })}
        />
      )}
      {askForm && receiptButton(false)}

      {ask === "check_data" ? (
        /* FR-028: the check is the read-back itself, open, with its two
           answers. "Todo está bien" spends nothing and calls nothing. */
        <div className="space-y-3 border-y border-line-soft pb-3">
          <SearchedData status={status} fallbackCents={data.totalCents} />
          {/* Stacked on a phone: side by side at 360px, "Todo está bien"
              broke onto two lines inside a 48px button */}
          <div className="grid gap-2 sm:grid-cols-2">
            <Button
              variant="secondary"
              className="h-12 w-full"
              onClick={() => {
                rememberAskAck(directPaymentId);
                setAcked(true);
              }}
            >
              Todo está bien
            </Button>
            <Button variant="secondary" className="h-12 w-full" onClick={() => setCorrecting(true)}>
              Corregir
            </Button>
          </div>
        </div>
      ) : (
        /* FR-023: verifying is free, editing is deliberate (the receipt
           path's validation-status-ux D2) — and "Corregir" is there on
           every state that is not final */
        <Collapsible>
          <CollapsibleTrigger className="group flex h-12 w-full items-center justify-between text-sm font-medium text-ink-soft transition-colors hover:text-ink">
            Ver los datos que enviaste
            <ChevronDown
              className="size-5 transition-transform group-data-[state=open]:rotate-180"
              aria-hidden
            />
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="space-y-3 border-t border-line-soft pt-3">
              <SearchedData status={status} fallbackCents={data.totalCents} />
              <Button variant="secondary" onClick={() => setCorrecting(true)}>
                Corregir
              </Button>
            </div>
          </CollapsibleContent>
        </Collapsible>
      )}

      {editing && (
        /* FR-024: one search at once when a searched field changed; an
           identical correction spends none (the server's rule) */
        <TransferForm
          typed
          busy={busy}
          announce={false}
          draft={{
            trackingKey: status.trackingKey,
            referenceNumber: status.referenceNumber ?? null,
            senderBank: status.senderBank,
            date: status.transferDate,
          }}
          amountCents={status.claimedAmountCents ?? data.totalCents ?? null}
          dateRange={dateRange}
          askSenderTail={refused === "SENDER_TAIL_NEEDED"}
          submitLabel="Confirmar estos datos"
          onSubmit={(t) => supersede(correctionTransfer(t, status))}
        />
      )}

      {payError && !clavesOnly && refused !== "SENDER_TAIL_NEEDED" && (
        <Alert variant="destructive" layout="icon">
          <TriangleAlert aria-hidden />
          {payErrorCopy(payError.code)}
        </Alert>
      )}

      {!askForm && receiptButton(true)}
    </div>
  );
}

export function PaymentPage({ token }: { token: string }) {
  const queryClient = useQueryClient();
  /* The payment this visit submitted. What the page watches is `payment`
     below: this one, or the attempt the link says is still in review. */
  const [ownPayment, setOwnPayment] = useState<PayResponse | null>(null);
  /* bug: one-open-attempt — attempts the payer walked out of in this
     visit ("Corregir el comprobante en revisión", a retry): the link keeps
     naming one until the correction lands, and it must not pull the payer
     back into it */
  const [leftBehind, setLeftBehind] = useState<ReadonlySet<string>>(() => new Set());
  /* D18: the reading waiting for the payer to confirm it */
  const [draft, setDraft] = useState<{ proofId: string; reading: ProofReading } | null>(null);
  /* two-eyes-receipt D2: the two readings that stop before a credit is
     spent — the file is not a receipt, or nothing on it could be read.
     Everything else goes through (FR-005). It is a message on the upload
     screen with the picker still open, not a screen of its own: the
     payer's next move is another photo, and a screen they have to leave
     first puts a door in front of it. */
  const [refusal, setRefusal] = useState<"not_receipt" | "illegible" | null>(null);
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
  /* payment-without-receipt D8/D21: with the payer's own reference, step 2
     opens on "Confirma tu pago"; "No puse la referencia" (D11) and the
     receipt are its two exits. Page state, not device state: the step
     memory stays as it was (step.ts), and a new visit to step 2 starts
     from the confirmation, the path that costs the payer least. */
  const [proofView, setProofView] = useState<"confirm" | "typed" | "receipt">("confirm");
  /* D8: the server answered REFERENCE_NOT_READY — the reference is not
     born yet, so the receipt step says why it is the one shown */
  const [referenceNotReady, setReferenceNotReady] = useState(false);
  /* US1 scenario 6: the capture carried another reference, or none — the
     payment goes on by receipt, and the payer is reminded of theirs */
  const [referenceReminder, setReferenceReminder] = useState(false);
  /* D23: the path of the last submission, so the first frame after it
     already speaks the path's words before the first poll answers */
  const [submittedSource, setSubmittedSource] = useState<"own" | "typed" | null>(null);
  /* validation-status-ux D7: the live payment a fresh proof supersedes —
     set when the payer walks out of "Verificando" through "Subir otro
     comprobante", cleared when the new submission lands. */
  const [resubmitOf, setResubmitOf] = useState<string | null>(null);
  /* validation-status-ux D2: the correction door inside the calm phase.
     Opening it is deliberate; it never opens itself. */
  const [correcting, setCorrecting] = useState(false);
  /* receipt-triage D5/D15/D18: what the reading asked the payer, with the
     file and the reading it came from — the page renders it and never
     pays a reading its ask stopped */
  const [ask, setAsk] = useState<{
    ask: NonNullable<ProofReading["ask"]>;
    proofId: string;
    reading: ProofReading;
  } | null>(null);
  /* receipt-triage FR-012 (D18): a second capture with no key in the same
     visit puts the form first. Page state on purpose — a new visit starts
     from the upload again, which is the path that costs the payer least. */
  const [noKeyAsks, setNoKeyAsks] = useState(0);
  const [askForm, setAskForm] = useState(false);
  /* receipt-triage D8/D20: the capture guide's moment — before, while and
     after the reading */
  const [guide, setGuide] = useState<GuideState>("idle");
  const pickerRef = useRef<HTMLInputElement>(null);
  const askRef = useRef<HTMLDivElement>(null);
  /* receipt-triage FR-013: the message takes focus when it appears, so a
     keyboard or screen-reader user starts from it */
  useEffect(() => {
    if (ask) askRef.current?.focus();
  }, [ask]);

  const link = useQuery<LinkStatusResponse, ApiError>({
    queryKey: ["link", token],
    queryFn: () => api<LinkStatusResponse>(`/direct-payments/links/${token}`),
    retry: false,
  });

  /* bug: one-open-attempt — a payer who comes back (a reload, hours
     later, another phone) resumes the attempt still in review instead of
     meeting a fresh form beside it. The page used to know that attempt
     only while it stayed open, so a returning payer started a second one
     and the first kept polling the provider for up to twelve hours after
     the customer had paid (found live on dev, 2026-09-25). */
  const inReview = link.data?.status === "debt" ? link.data.inReview : undefined;
  const resumed: PayResponse | null =
    !ownPayment && inReview && !leftBehind.has(inReview.directPaymentId)
      ? { directPaymentId: inReview.directPaymentId, status: inReview.status, error: null }
      : null;
  const payment = ownPayment ?? resumed;
  const setPayment = (next: PayResponse | null) => {
    if (!next && payment) {
      const left = payment.directPaymentId;
      setLeftBehind((ids) => new Set(ids).add(left));
    }
    setOwnPayment(next);
  };

  /* US-D08 D2: this device keeps the link it was handed, so the customer
     can come back next month without asking the ISP again. Nothing is
     announced — nothing was asked of them. */
  const linkData = link.data;
  useEffect(() => {
    if (!linkData) return;
    rememberLink(token, linkData.customerName ?? linkData.ispName);
    /* D19: nothing left to pay means the last payment is over — give the
       step back, so next month starts where the next payment starts. */
    if (linkData.status === "no_debt" || linkData.status === "closed") forgetStep(token);
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
        /* prepaid-credit D8: the queue moves when the business tops up;
           the page keeps watching so the payer never has to reload */
        s.status === "queued_for_credit" ||
        (s.status === "confirmed" && s.actionOutcome !== "done") ||
        /* A partial that met the threshold can still have its reconnection
           in the queue (WispHub down). `withheld` is terminal; `queued` is
           a promise the page has to keep watching, or "en unos minutos"
           never turns into "ya está activo". */
        (s.status === "partial" && s.actionOutcome === "queued");
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
    onSuccess: (result, body) => {
      setPayment(result);
      setResubmitOf(null);
      setCorrecting(false);
      const source = (body.transfer as { referenceSource?: "own" | "typed" } | undefined)?.referenceSource;
      setSubmittedSource(source ?? null);
      /* receipt-triage D18: the ask is consumed when the payment is born */
      setAsk(null);
      setAskForm(false);
      setGuide("idle");
    },
    onError: (error) => {
      /* payment-without-receipt D8: `own` asked and the link has no
         reference yet — today's receipt step, which works without one */
      if (error.code === "REFERENCE_NOT_READY") {
        setReferenceNotReady(true);
        setProofView("receipt");
      }
    },
  });

  /* D18, turned around by two-eyes-receipt D3/D13 — the machine reads,
     the provider reads, and the human is asked only for what is in
     doubt.

     What this mutation sends changed. It used to post the *reading* as
     `transfer` data whenever the gate passed, which made the row look
     like a form the payer had filled in and spent the first provider
     credit on the transfer door. Since D13 a machine reading travels as
     `proofId` alone: the file goes to the provider's image door with the
     engine's reading beside it, both are compared at minute zero, and
     `transfer` in a pay body now means one thing only — the payer edited
     a form (FR-015).

     So a hole no longer stops here either (FR-005). The gate's verdict
     is still worth having, but it is the *provider* who may fill the
     hole for free, and asking the payer first spends their attention on
     something two machines were about to settle. What still stops here,
     and only this, is a file that is not a receipt or that cannot be
     read at all (D2) — see the refusal above, before any upload is even
     paid for. */
  const upload = useMutation<
    | { proofId: string; reading: ProofReading | null }
    | { refusal: "not_receipt" | "illegible" }
    | { ask: NonNullable<ProofReading["ask"]>; proofId: string; reading: ProofReading }
    | PayResponse,
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
      setGuide("reading");
      try {
        reading = await api<ProofReading>(`/direct-payments/links/${token}/read`, {
          method: "POST",
          body: JSON.stringify({ proofId }),
        });
      } catch {
        /* The reader being down is not the payer's problem: fall
           through and send the file, which the provider reads itself
           (two-eyes-receipt D3). The payment loses its second pair of
           eyes, not its chance — a `not_found` simply classifies blind
           on our side and the payer is asked then, if at all. */
      }
      /* two-eyes-receipt D2 (FR-004): the two refusals, and only these.
         `isReceipt: false` is measured — the model answered it five times
         out of five on a dark UI screenshot (2026-08-19), and that same
         screenshot makes the provider answer `error`, which is
         retryable, so the payment used to ride the whole six-hour
         schedule at up to seven paid calls and end `expired`. Here it
         costs the payer ten seconds and a second try. `legibility:
         "none"` is its sibling: a photograph with a receipt in it that
         no field can be read from. A `partial` legibility is *not* a
         refusal — it goes to the provider with its hole (FR-005). */
      setGuide(reading ? { reading } : "idle");
      /* payment-without-receipt US1 scenario 6: the receipt path never
         refuses a capture for its reference — it reminds the payer of
         their own, for the next transfer */
      const own = link.data?.payerReference?.digits;
      setReferenceReminder(Boolean(own && reading && reading.referenceNumber !== own));
      if (reading && (reading.isReceipt === false || reading.legibility === "none")) {
        return { refusal: reading.isReceipt === false ? "not_receipt" : "illegible" } as const;
      }

      /* receipt-triage D4/D15: a clear capture with neither key, or paid
         to an account that is not this business's, is asked about here,
         before anything is paid. The engine enforces the same ask on the
         receipt door, so this is courtesy, not the guard. */
      if (reading?.ask) {
        return { ask: reading.ask, proofId, reading } as const;
      }

      /* partial-payment D1/D12: the amount printed on the receipt is what
         travels to Banxico, so a transfer that fell short is findable and
         lands as a `partial` row — a short reading is a valid submission,
         never a refusal. A reading *above* the debt is routed to the
         confirmation screen instead of travelling silently (claimed-amount
         D2): the payer sees both numbers and where the surplus goes
         before anything is spent — informed, not refused. */
      const expected = link.data?.totalCents;
      if (
        reading &&
        reading.amountCents != null &&
        expected != null &&
        reading.amountCents > expected
      ) {
        return { proofId, reading };
      }

      /* Everything else is sent silently, as the file alone (D13).
         `source: "provider-ocr"` — nothing here could read it — and a
         reading with a hole in it take exactly this path now: the
         provider reads the same file, and whatever the two of them
         settle on decides whether anybody is asked (D5–D8). If the
         readings are right, nobody is asked anything, which is the whole
         reason not to put a confirmation in front of every payer. */
      return api<PayResponse>(`/direct-payments/links/${token}/pay`, {
        method: "POST",
        body: JSON.stringify({
          proofId,
          ...(resubmitOf ? { supersedes: resubmitOf } : {}),
          ...(reading?.receiptStatus ? { receiptStatus: reading.receiptStatus } : {}),
          /* partial-payment D12: the reader's amount is the claim on this
             silent path — no human was asked, so nothing outranks it */
          ...(reading?.amountCents != null ? { receiptAmountCents: reading.amountCents } : {}),
        }),
      });
    },
    onMutate: () => {
      setAsk(null);
      setAskForm(false);
    },
    onError: () => setGuide("idle"),
    onSuccess: (result) => {
      if ("ask" in result) {
        setRefusal(null);
        setAsk(result);
        if (result.ask.reason === "no_key") {
          const count = noKeyAsks + 1;
          setNoKeyAsks(count);
          /* FR-012: the second time, the form leads */
          setAskForm(count >= 2);
        }
        return;
      }
      if ("refusal" in result) {
        /* Nothing was paid and nothing was counted: the payer stays on
           the upload screen and takes another photo (D2). */
        setRefusal(result.refusal);
        setProofId(null);
        return;
      }
      setRefusal(null);
      if ("directPaymentId" in result) {
        setPayment(result);
        setSubmittedSource(null);
        setResubmitOf(null);
        setCorrecting(false);
        /* BUG-011: the draft is consumed when the payment is born. Left
           alive, it outranks the step machine and resurfaces the old
           reading when a later screen clears the payment. */
        setDraft(null);
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
        {link.error.code === "BUSINESS_SUSPENDED" ? (
          /* payments-and-classes D9: honest and final for now — nothing
             to retry from this side. */
          <Alert layout="icon">
            <TriangleAlert aria-hidden />
            Este negocio no puede recibir pagos por ahora. Contacta a tu proveedor.
          </Alert>
        ) : link.error.status === 404 ? (
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
          claimedAmountCents: null,
          readingCheck: null,
          receiptStatus: null,
          referenceSource: submittedSource,
        }
      : null);
  if (payment && status) {
    const retry = () => {
      setPayment(null);
      setCorrecting(false);
      /* payment-without-receipt D21: the next try starts from the
         confirmation again, and the last capture's reminder is spent */
      setProofView("confirm");
      setReferenceReminder(false);
      setSubmittedSource(null);
      /* BUG-011, second belt: whatever screen calls retry wants the step
         machine, never a stale draft rendering in front of it. */
      setDraft(null);
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
      /* payment-without-receipt FR-029/FR-031: "Sube tu comprobante" is
         the receipt step itself, not the confirmation in front of it */
      setProofView("receipt");
      void queryClient.invalidateQueries({ queryKey: ["link", token] });
    };
    /* payment-without-receipt FR-030: an expired row is final — the
       receipt starts a new payment, superseding nothing */
    const receiptAfterExpiry = () => {
      setPayment(null);
      pay.reset();
      upload.reset();
      goTo("proof");
      setProofView("receipt");
      void queryClient.invalidateQueries({ queryKey: ["link", token] });
    };
    return (
      <Card className="space-y-4 p-6" aria-live="polite">
        <header>
          <h1 className="text-lg font-semibold">{data.ispName}</h1>
          {data.customerName && <p className="text-sm text-ink-soft">{data.customerName}</p>}
        </header>

        {status.status === "validating" && status.referenceSource && (
          /* payment-without-receipt D15, FR-023: a row searched by
             reference reads back what is searched and asks by `ask` */
          <>
            <StatusBadge status="validating" size="standard" />
            <SourcedReview
              key={payment.directPaymentId}
              status={status as DirectPaymentStatusResponse}
              data={data}
              directPaymentId={payment.directPaymentId}
              busy={busy}
              payError={pay.error}
              onPay={(body) => pay.mutate(body)}
              onReceipt={startOverWithReceipt}
            />
          </>
        )}

        {status.status === "validating" && !status.referenceSource && (
          <>
            <StatusBadge status="validating" size="standard" />
            {(() => {
              /* receipt-triage D7/D17: a reference that cannot find the
                 transfer alone asks for the clave, whatever the error
                 that carried it */
              /* cep-bundle-match D10: and a bundle, or a single match, that
                 did not say which transfer is the payer's */
              /* cep-bundle-match D10: an undecided payment asks for the
                 clave alone, focused, the other fields kept */
              const undecided =
                status.error === "CEP_UNDECIDED" ||
                status.error === "CEP_ALL_USED" ||
                status.error === "CEP_SINGLE_UNDECIDED";
              const clavesOnly = status.error === "REFERENCE_AMBIGUOUS" || undecided;
              const referenceAsk = clavesOnly || status.error === "REFERENCE_SHARED";
              const notFound = status.error === "TRANSFER_NOT_FOUND" || referenceAsk;
              /* D18: the receipt's own Estatus is the one discriminator
                 we have. "En proceso" means the bank has not released
                 the transfer — there is nothing for the payer to
                 correct, at any attempt (validation-status-ux D1). */
              const enProceso = /proceso/i.test(status.receiptStatus ?? "");
              /* provisional-release D9: the service was actually given
                 back (or shielded) — evidence and consequence are ONE
                 sentence, and "tu internet ya volvió" is never said to
                 someone whose internet never left (`protect`). */
              const release = status.provisionalRelease ?? null;

              if (!notFound) {
                /* Design review 2026-08-27 (Should fix): the page's best
                   news deserves a visual carrier — the release sentence
                   rides a success Alert (icon + text, the color law),
                   while the badge stays "Verificando pago": the status
                   is still Banxico's; the good news is the service. */
                /* design-foundations US1: this calm region is what breathes.
                   The wait can be six hours, and a still page is
                   indistinguishable from a dead one — including when the
                   release has already landed, because Banxico's answer is
                   still outstanding.

                   announce={false}: the Card above is already
                   aria-live="polite" (line 584). A second announcer would
                   read the state out twice.

                   The escalated states below are deliberately outside this
                   wrapper: a form the payer is filling in must not pulse
                   under their hands. */
                return (
                  <Pending
                    active
                    announce={false}
                    label="Estamos verificando tu transferencia."
                  >
                    {release ? (
                      /* The release is news that arrives mid-wait, so it
                         fades in like any other outcome (FR-012). */
                      <Reveal>
                        <Alert variant="success" layout="icon">
                          {release.kind === "protect" ? (
                            <ShieldCheck aria-hidden />
                          ) : (
                            <Wifi aria-hidden />
                          )}
                          {release.kind === "protect"
                            ? "Tu pago se está verificando. Tu servicio sigue activo — no necesitas hacer nada."
                            : "Tu transferencia está en camino y tu internet ya volvió. Solo esperamos la confirmación de Banxico — no necesitas hacer nada."}
                        </Alert>
                      </Reveal>
                    ) : (
                      <p className="text-sm text-ink-soft">
                        Estamos verificando tu transferencia. Esto puede tomar unos minutos; puedes
                        dejar esta página abierta.
                      </p>
                    )}
                  </Pending>
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
              /* reading-check D3/D4: the comparison of the two readings,
                 taken at the first paid call since two-eyes-receipt D5.
                 Agreement is evidence — the clock escalation retires. A
                 dispute asks the human now, about exactly the fields the
                 two readers disagreed on. */
              const agreed = status.readingCheck === "agreed";
              const disputed = status.readingCheck === "disputed";
              const disputedSet = new Set(status.disputedFields ?? []);
              /* two-eyes-receipt D20: what opens the form is a non-empty
                 list of fields, whatever the check said. An agreement
                 with no date on either reading is still an agreement —
                 the clock retires and the release may fire — and still
                 needs that one field, because the transfer door is never
                 called with a date nobody read. */
              const asked = disputedSet.size > 0;
              const nextHour = nextAt
                ? new Date(nextAt).toLocaleTimeString("es-MX", {
                    hour: "numeric",
                    minute: "2-digit",
                  })
                : null;
              const showForm =
                !enProceso &&
                (correcting || asked || referenceAsk || (escalated && !agreed && !release && !farAway));
              /* receipt-triage D13 (FR-004): the clave fell back to the
                 reference and Banxico found nothing — either key is enough */
              const eitherKey = disputedSet.has("trackingKey") && disputedSet.has("referenceNumber");
              /* receipt-triage FR-014 (converge T059): whenever the check
                 needs a field from the payer — a key, the date, the amount
                 — the page says where their bank shows it, when it knows */
              const where = asked || referenceAsk ? whereLine(status.senderBank) : null;

              return (
                <div className="space-y-4">
                  {enProceso ? (
                    <p className="text-sm text-ink-soft">
                      Tu comprobante dice “{status.receiptStatus}”: tu banco todavía no libera la
                      transferencia. Seguiremos intentando y no necesitas hacer nada.
                    </p>
                  ) : referenceAsk ? (
                    /* receipt-triage D17/D7: only the clave can find this
                       transfer now, so it is the one thing asked */
                    <p className="text-sm text-ink-soft">{statusErrorCopy(status)}</p>
                  ) : eitherKey ? (
                    <p className="text-sm text-ink-soft">
                      No encontramos tu transferencia todavía. Confirma tu clave de rastreo o tu número
                      de referencia mirando tu comprobante; con uno basta.
                    </p>
                  ) : disputed && disputedSet.has("referenceNumber") ? (
                    <p className="text-sm text-ink-soft">
                      Confirma tu número de referencia mirando tu comprobante.
                    </p>
                  ) : asked && !disputed && disputedSet.has("date") ? (
                    /* D20: the one field, named. Nothing is in doubt —
                       both machines read the same transfer — so the
                       sentence does not say anybody disagreed; it asks
                       for the date that was simply not printed anywhere
                       either of them could see. */
                    <p className="text-sm text-ink-soft">
                      Solo nos falta la fecha de tu transferencia. Confírmala mirando tu
                      comprobante y seguimos.
                    </p>
                  ) : disputed ? (
                    /* D4: the ask names the field and points at the
                       receipt — the payer arbitrates against the one
                       source of truth in their hand, never between two
                       machines. Copy-paste is the way out of typing 28
                       characters on a phone. */
                    <p className="text-sm text-ink-soft">
                      {disputedSet.has("trackingKey") && disputedSet.has("amount")
                        ? "Confirma tu clave de rastreo y el monto transferido mirando tu comprobante."
                        : disputedSet.has("amount")
                          ? "Confirma el monto transferido mirando tu comprobante."
                          : disputedSet.has("trackingKey")
                            ? "Confirma tu clave de rastreo mirando tu comprobante."
                            : /* D20: only the date is in doubt */
                              "Confirma la fecha de tu transferencia mirando tu comprobante."}{" "}
                      {disputedSet.has("trackingKey") &&
                        "Puedes copiarla desde tu app del banco, o escribirla tal como aparece en tu comprobante."}
                    </p>
                  ) : release && !correcting ? (
                    /* D9: one sentence, evidence fused with consequence.
                       The release retires the clock the way `agreed`
                       does — a customer whose service is back must never
                       read the worry copy. Design review 2026-08-27: the
                       sentence rides a success Alert so the moment of
                       delight has a visual carrier. */
                    <Alert variant="success" layout="icon">
                      {release.kind === "protect" ? (
                        <ShieldCheck aria-hidden />
                      ) : (
                        <Wifi aria-hidden />
                      )}
                      {release.kind === "protect"
                        ? "Tu pago se está verificando. Tu servicio sigue activo — no necesitas hacer nada."
                        : release.evidence === "agreed"
                          ? "Revisamos tu comprobante dos veces y los datos coinciden. Tu internet ya volvió mientras esperamos la respuesta de Banxico — no necesitas hacer nada."
                          : release.evidence === "human"
                            ? "Gracias por confirmar tus datos. Tu internet ya volvió mientras Banxico responde."
                            : "Tu transferencia está en camino y tu internet ya volvió. Solo esperamos la confirmación de Banxico — no necesitas hacer nada."}
                    </Alert>
                  ) : farAway ? (
                    /* D5: promise only what the system will do — the
                       cron keeps this hour; nobody "sends news" */
                    <p className="text-sm text-ink-soft">
                      Está tardando más de lo esperado.
                      {nextHour && (
                        /* es-MX hours end in "a.m."/"p.m." — their dot
                           closes the sentence; adding ours prints ".." */
                        <>
                          {" "}
                          Volveremos a intentarlo automáticamente alrededor de las {nextHour}
                          {nextHour.endsWith(".") ? "" : "."}
                        </>
                      )}{" "}
                      Puedes cerrar esta página y volver después, o contactar a tu proveedor de
                      internet con tu comprobante.
                    </p>
                  ) : escalated && !agreed ? (
                    /* D3: the copy suspects the wait, never the payer */
                    <p className="text-sm text-ink-soft">
                      Está tardando más de lo normal. Revisa que estos datos coincidan con tu
                      comprobante y corrígelos si hace falta.
                    </p>
                  ) : agreed && !correcting ? (
                    /* reading-check D3: calm backed by evidence — two
                       independent readers returned the same data, so the
                       wait is Banxico's, and the form never opens by
                       clock. Agreement never validates: the verdict is
                       still Banxico's alone. */
                    <p className="text-sm text-ink-soft">
                      Revisamos tu comprobante dos veces y los datos coinciden. Solo esperamos la
                      respuesta de Banxico — no necesitas hacer nada.
                    </p>
                  ) : correcting ? (
                    /* The payer opened the correction door themselves —
                       "no necesitas hacer nada" over an open form would
                       contradict the form (design review, PR #88) */
                    <p className="text-sm text-ink-soft">
                      Seguimos verificando. Revisa que estos datos coincidan con tu comprobante y
                      corrígelos si hace falta.
                    </p>
                  ) : (
                    <p className="text-sm text-ink-soft">
                      Validación en proceso: esperamos la respuesta de Banxico. No necesitas hacer
                      nada.
                    </p>
                  )}

                  {where && showForm && <p className="text-sm text-ink-soft">{where}</p>}

                  {showForm ? (
                    /* The schedule keeps running underneath; whichever
                       resolves first wins (D3). */
                    <TransferForm
                      /* receipt-triage D17: after the 422 the clave alone;
                         D7: a shared reference needs the clave beside it */
                      keys={clavesOnly ? "clave" : "either"}
                      requireClave={status.error === "REFERENCE_SHARED"}
                      focusClave={undecided}
                      busy={busy}
                      /* The Card above is already aria-live="polite" */
                      announce={false}
                      /* reading-check D4: a disputed field arrives EMPTY
                         — there is no neutral reading to pre-fill when
                         the machines disagree, and a pre-filled clave
                         gets confirmed, not proofread (measured). The
                         undisputed fields stay pre-filled. */
                      draft={{
                        trackingKey: disputedSet.has("trackingKey") ? null : status.trackingKey,
                        /* receipt-triage D13: a disputed reference arrives
                           empty, like a disputed clave */
                        referenceNumber: disputedSet.has("referenceNumber") ? null : (status.referenceNumber ?? null),
                        senderBank: status.senderBank,
                        /* two-eyes-receipt D20: an asked-for date arrives
                           empty, exactly as the clave and the amount do —
                           there is no neutral reading to pre-fill when
                           nobody read one (validation-status-ux D6) */
                        date: disputedSet.has("date") ? null : status.transferDate,
                      }}
                      /* claimed-amount D3: what this payment asked with,
                         falling back to the expected total — the fourth
                         correctable field for the stuck payer */
                      amountCents={
                        disputedSet.has("amount")
                          ? null
                          : (status.claimedAmountCents ?? data.totalCents ?? null)
                      }
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
                    (status.trackingKey || status.referenceNumber) && (
                      /* D2: verifying is free, editing is deliberate */
                      <Collapsible>
                        <CollapsibleTrigger className="group flex h-12 w-full items-center justify-between text-sm font-medium text-ink-soft transition-colors hover:text-ink">
                          Ver los datos enviados
                          <ChevronDown
                            className="size-5 transition-transform group-data-[state=open]:rotate-180"
                            aria-hidden
                          />
                        </CollapsibleTrigger>
                        <CollapsibleContent>
                          <div className="space-y-3 border-t border-line-soft pt-3">
                            <div className="divide-y divide-line-soft">
                              {status.trackingKey && (
                                <div className="py-2">
                                  <p className="text-sm text-ink-soft">Clave de rastreo</p>
                                  <p className="break-all font-mono text-sm text-ink">
                                    {status.trackingKey}
                                  </p>
                                </div>
                              )}
                              {status.referenceNumber && (
                                <div className="py-2">
                                  <p className="text-sm text-ink-soft">Número de referencia</p>
                                  <p className="font-mono text-sm text-ink">{status.referenceNumber}</p>
                                </div>
                              )}
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
                      receipt is wrong — on every not_found screen. bug:
                      one-open-attempt — named for what it does: the new
                      capture replaces this one, it is not a second payment */}
                  <Button
                    variant="ghost"
                    className="h-12 w-full text-sm"
                    onClick={startOverWithReceipt}
                  >
                    Corregir el comprobante en revisión
                  </Button>
                </div>
              );
            })()}
          </>
        )}

        {/* receipt-triage D31 (FR-006, FR-020a): Banxico confirmed it and
            the business decides — no success state, no reconnection copy */}
        {status.inReview && (
          <Reveal>
            <Alert layout="icon">
              <Info aria-hidden />
              Tu pago está en revisión con {data.ispName}. Te avisaremos aquí cuando lo confirme.
            </Alert>
          </Reveal>
        )}

        {status.status === "confirmed" && !status.inReview && (
          <Reveal className="space-y-4">
            <StatusBadge status="paymentConfirmed" size="standard" />
            <p className="text-sm text-ink-soft">
              {/* automated-collections-api D6: an API payment carries no
                  action outcome — the business's own system acts on the
                  webhook — so nothing here promises a service the page
                  knows nothing about (FR-028 reaches the payer too) */}
              {!("actionOutcome" in status) || status.actionOutcome === undefined
                ? "Tu pago fue registrado."
                : status.actionOutcome === "done"
                  ? "Tu pago fue registrado. Tu servicio ya está activo."
                  : "Tu pago fue registrado. Tu servicio se reactivará en unos minutos."}
            </p>
            {"folio" in status && status.folio && (
              <p className="font-mono text-sm text-ink-soft">Folio {status.folio}</p>
            )}
          </Reveal>
        )}

        {/* partial-payment D7: brutally honest, and in pesos. The payer is
            told what arrived, what is missing and what happens when the
            rest does — never a percentage, and never a green tick over a
            service that is still cut. */}
        {status.status === "partial" && !status.inReview && (
          <Reveal className="space-y-4">
            <StatusBadge status="paymentPartial" size="standard" />
            <p className="text-sm text-ink-soft">
              {"receivedCents" in status && status.receivedCents != null ? (
                <>
                  Recibimos <Amount cents={status.receivedCents} /> de{" "}
                  <Amount cents={status.debtCents ?? 0} />.{" "}
                  {/* Three different facts, three sentences: reconnected
                      is done, queued needs no more money (the threshold
                      was met), and only withheld waits for the rest. */}
                  {status.actionOutcome === undefined
                    ? /* automated-collections-api D6: no service to speak of */ ""
                    : status.actionOutcome === "done"
                      ? "Tu servicio ya está activo."
                      : status.actionOutcome === "queued"
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
            {collectAccountOf(data) && (
              <div className="border-y border-line-soft">
                <CopyField
                  label={ACCOUNT_LABEL[collectAccountOf(data)!.kind]}
                  value={collectAccountOf(data)!.value}
                />
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
          </Reveal>
        )}

        {status.status === "queued_for_credit" && status.referenceSource && (
          /* payment-without-receipt FR-023: not final, so the searched data
             and "Corregir" stay; nothing is searched while it waits */
          <SourcedReview
            key={payment.directPaymentId}
            status={status as DirectPaymentStatusResponse}
            data={data}
            directPaymentId={payment.directPaymentId}
            busy={busy}
            payError={pay.error}
            paused
            onPay={(body) => pay.mutate(body)}
            onReceipt={startOverWithReceipt}
          />
        )}

        {status.status === "queued_for_credit" && !status.referenceSource && (
          /* prepaid-credit D9: the business's fault, never the payer's —
             no "error", no hidden CLABE, no countdown. Calm, like D12's
             family; the poll above brings the payer back on its own. */
          <Reveal>
            <Alert variant="warning" layout="icon">
              Este negocio pausó la validación de pagos. Tu comprobante quedó guardado y se revisará
              en cuanto la reactiven. No tienes que hacer nada más.
            </Alert>
          </Reveal>
        )}

        {status.status === "invalid" && (
          <Reveal className="space-y-4">
            <StatusBadge status="paymentInvalid" size="standard" />
            <p className="text-sm text-ink-soft">
              {/* payment-without-receipt D24: a used transfer names the
                  payer's own payment that used it, when it is theirs */}
              {statusErrorCopy(status) ??
                "No pudimos verificar tu transferencia. Revisa los datos e intenta de nuevo."}
            </p>
            <Button variant="secondary" onClick={retry}>
              Intentar de nuevo
            </Button>
          </Reveal>
        )}

        {status.status === "expired" && status.referenceSource && (
          /* payment-without-receipt FR-030: the ladder ran out, and the
             clave and the receipt stay on the page. No "Reintentar ahora":
             that retry re-sends a clave, and this row searched without one
             (provisional-release D7). */
          <Reveal className="space-y-4">
            <StatusBadge status="paymentExpired" size="standard" />
            <p className="text-sm text-ink-soft">
              {statusErrorCopy(status) && status.usedBy
                ? statusErrorCopy(status)
                : status.provisionalRelease
                  ? "No encontramos tu transferencia a tiempo y tu servicio volvió a pausa."
                  : "No encontramos tu transferencia con los datos que enviaste."}{" "}
              Escribe tu clave de rastreo o sube tu comprobante para confirmar tu pago.
            </p>
            <TransferForm
              keys="clave"
              busy={busy}
              announce={false}
              draft={{ trackingKey: null, senderBank: status.senderBank, date: status.transferDate }}
              amountCents={status.claimedAmountCents ?? data.totalCents ?? null}
              submitLabel="Buscar con mi clave"
              onSubmit={(transfer) => pay.mutate({ transfer })}
            />
            <Button variant="secondary" className="h-12 w-full text-sm" onClick={receiptAfterExpiry}>
              Sube tu comprobante
            </Button>
            {pay.error && (
              <Alert variant="destructive" layout="icon">
                <TriangleAlert aria-hidden />
                {payErrorCopy(pay.error.code)}
              </Alert>
            )}
            <Collapsible>
              <CollapsibleTrigger className="group flex h-12 w-full items-center justify-between text-sm font-medium text-ink-soft transition-colors hover:text-ink">
                Ver los datos que enviaste
                <ChevronDown
                  className="size-5 transition-transform group-data-[state=open]:rotate-180"
                  aria-hidden
                />
              </CollapsibleTrigger>
              <CollapsibleContent>
                <div className="border-t border-line-soft pt-1">
                  <SearchedData status={status as DirectPaymentStatusResponse} fallbackCents={data.totalCents} />
                </div>
              </CollapsibleContent>
            </Collapsible>
          </Reveal>
        )}

        {status.status === "expired" && !status.referenceSource && (
          <Reveal className="space-y-4">
            <StatusBadge status="paymentExpired" size="standard" />
            {/* D17: "no pudimos verificarlo" is a statement about us, not
                an accusation about the payer — and when we know which
                wall we hit, we say which. reading-check D6: an agreed
                payment that still expired carries a diagnosis — the data
                matches the receipt and Banxico never published — so the
                ISP receives a pre-diagnosed case instead of a mystery.
                provisional-release D7/D9: the retry is self-selection —
                the payer who really paid claims it, and six more hours
                have usually published the late CEP. A released ride is
                told plainly that the service went back to pause. */}
            <p className="text-sm text-ink-soft">
              {status.provisionalRelease
                ? status.retryAvailable
                  ? "Banxico no publicó tu transferencia y tu servicio volvió a pausa. Si ya pagaste, reintenta ahora — o contacta a tu proveedor de internet con tu comprobante."
                  : "Banxico no publicó tu transferencia y tu servicio volvió a pausa. Contacta a tu proveedor de internet con tu comprobante — puede registrar tu pago a mano."
                : status.readingCheck === "agreed"
                  ? status.retryAvailable
                    ? "Tus datos coinciden con tu comprobante, pero Banxico no publicó la transferencia. Si ya pagaste, reintenta ahora — o contacta a tu proveedor de internet con tu comprobante."
                    : "Tus datos coinciden con tu comprobante, pero Banxico no publicó la transferencia. Contacta a tu proveedor de internet con tu comprobante — puede registrar tu pago a mano."
                  : status.error
                    ? payErrorCopy(status.error)
                    : "No pudimos confirmar tu pago a tiempo. Contacta a tu proveedor de internet con tu comprobante para resolverlo."}
            </p>
            {/* feedback-vocabulary-rollout D1/D4 — a gap `001-design-foundations`
                left, found by scripts/pending-lint.mjs. This button said
                "Enviando…" and showed nothing else: the payer, on a phone, on
                the screen that just told them Banxico did not publish their
                transfer, re-sending proof of money they already moved. The
                worst place in the product to leave a wait silent.

                announce={false} because the Card at line 608 is already
                aria-live="polite" — the same reason the submit inside it
                passes false. */}
            {status.retryAvailable && status.trackingKey && status.senderBank && (
              <Pending active={pay.isPending} announce={false} label="Enviando tus datos.">
              <Button
                variant="secondary"
                disabled={pay.isPending}
                onClick={() =>
                  pay.mutate({
                    transfer: {
                      trackingKey: status.trackingKey,
                      senderBank: status.senderBank,
                      ...(status.transferDate ? { date: status.transferDate } : {}),
                      ...(status.claimedAmountCents != null
                        ? { amountCents: status.claimedAmountCents }
                        : {}),
                    },
                  })
                }
              >
                {pay.isPending ? "Enviando…" : "Reintentar ahora"}
              </Button>
              </Pending>
            )}
          </Reveal>
        )}

        {status.status === "unapplied" && (
          <Reveal className="space-y-4">
            <StatusBadge status="unapplied" size="standard" />
            <p className="text-sm text-ink-soft">
              Tu transferencia fue validada, pero tu cuenta ya estaba al corriente. Tu proveedor te
              contactará para resolverlo.
            </p>
          </Reveal>
        )}

        {/* payment-without-receipt US1 scenario 6: accepted by receipt all
            the same; the reminder is for the next transfer */}
        {referenceReminder && data.payerReference && (
          <Alert layout="icon">
            <Info aria-hidden />
            Tu referencia es {inlineReference(data.payerReference.digits)}. Escríbela en tu próxima
            transferencia y podrás confirmar tu pago sin comprobante.
          </Alert>
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

  /* ——— 9. Link cerrado (automated-collections-api D6, FR-031) ———
     A one-time link that was paid, or whose deadline passed. Static copy,
     no CLABE: a transfer against it would be applied to nobody. The
     payer who already paid and the payer who arrived late read
     different sentences, because they are in different situations. */
  if (data.status === "closed") {
    return (
      <Card className="space-y-4 p-6">
        <h1 className="text-lg font-semibold">{data.ispName}</h1>
        <Alert layout="icon">
          {data.closedReason === "expired" ? <TimerOff aria-hidden /> : <CheckCircle2 aria-hidden />}
          {data.closedReason === "expired"
            ? `Este link de pago venció. Pide uno nuevo a ${data.ispName} para hacer tu pago.`
            : `Este link de pago ya fue utilizado. Si necesitas hacer otro pago, pide un link nuevo a ${data.ispName}.`}
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
      {/* automated-collections-api FR-006: what the caller told the payer
          this is for — a line under the name, never a label that would
          compete with the amount */}
      {data.concept && <p className="text-sm text-ink-soft">{data.concept}</p>}
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

    /* two-eyes-receipt D13: this screen is the surplus consent and
       nothing else now. A reading that is not a receipt, or that nothing
       could be read from, is refused on the upload screen before a
       credit is spent (D2); a reading with a *hole* no longer stops here
       at all — it goes to the provider, who may fill it for free
       (FR-005). What is left is claimed-amount D2: a reading above the
       debt is informed, never refused — the refusal's justification (an
       inflated misread buying six silent hours) died when the correction
       doors shipped, and the server already settles the overpayment (the
       surplus lands as credit with the ISP, partial-payment D10). */
    return (
      <Card className="space-y-4 p-6">
        {stepHeader(2, "Confirma estos datos")}

        {reading.receiptStatus && /proceso/i.test(reading.receiptStatus) && (
          <Alert variant="warning" layout="icon">
            <TriangleAlert aria-hidden />
            Tu comprobante dice “{reading.receiptStatus}”. Tu banco todavía no libera la
            transferencia, así que puede tardar en aparecer. Puedes continuar de todos modos.
          </Alert>
        )}

        {/* claimed-amount D2: both numbers in pesos and what happens to
            the difference — informed, not refused. One span, on purpose:
            the Alert lays out its direct children, and loose <Amount>
            elements became columns that spilled out of the box (design
            review, PR #90). */}
        {reading.amountCents != null &&
          data.totalCents != null &&
          reading.amountCents > data.totalCents && (
            <Alert layout="icon">
              <ScanLine aria-hidden />
              <span>
                Tu comprobante dice <Amount cents={reading.amountCents} /> y tu adeudo es{" "}
                <Amount cents={data.totalCents} />. El sobrante quedará a favor con tu proveedor
                para tu siguiente factura.
              </span>
            </Alert>
          )}

        {/* two-eyes-receipt D13: two ways out, and the payer picks. Send
            it as it is — the file alone, like every other reading (the
            surplus is what they just consented to) — or open the form
            and correct the numbers, which makes it the human's data
            (FR-015). Sizes are declared, never improvised (constitution
            VI): the decisive action at 64px, the secondary at 48px. */}
        {correcting ? (
          <TransferForm
            busy={busy}
            draft={reading}
            /* claimed-amount D3: the receipt's own amount is the honest
               default here; the human's confirmation of it wins over the
               raw reading (the pair still measures the reader, D18) */
            amountCents={reading.amountCents ?? data.totalCents ?? null}
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
        ) : (
          <div className="space-y-3">
            {/* The wait sits inside <Pending>, with its own label — the
                screen must be visibly working before any word changes
                (feedback-vocabulary FR-008, pending-lint). */}
            <Pending active={busy} label="Estamos enviando tu comprobante.">
              <Button
                size="decisive"
                disabled={busy}
                onClick={() =>
                  pay.mutate({
                    proofId,
                    ...(resubmitOf ? { supersedes: resubmitOf } : {}),
                    receiptStatus: reading.receiptStatus ?? undefined,
                    receiptAmountCents: reading.amountCents ?? undefined,
                  })
                }
              >
                <ShieldCheck className="size-5" aria-hidden />
                {busy ? "Enviando…" : "Enviar así"}
              </Button>
            </Pending>
            {/* 48px: the touch size, declared (constitution VI) */}
            <Button
              variant="secondary"
              className="h-12 w-full"
              disabled={busy}
              onClick={() => setCorrecting(true)}
            >
              Corregir los datos
            </Button>
          </div>
        )}

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
  const account = collectAccountOf(data);
  /* payment-without-receipt D1/D22: the payer's own number. Absent or
     null, and the two steps are today's, exactly (D20). */
  const payer = data.payerReference ?? null;

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
          {/* cobros-live D8 (US-R04): with several invoices, name them —
              information, never a picker; one invoice is already the
              breakdown's own line */}
          {data.cobros && data.cobros.length > 1 && (
            <ul className="mt-2 border-t border-line-soft pt-2 text-sm text-ink-soft" aria-label="Facturas que componen tu adeudo">
              {data.cobros.map((f) => (
                <li key={f.externalId} className="flex justify-between gap-4 py-0.5">
                  <span>
                    {f.invoiceDate
                      ? `Factura del ${new Date(`${f.invoiceDate}T12:00:00`).toLocaleDateString("es-MX", { day: "numeric", month: "long" })}`
                      : "Factura pendiente"}
                  </span>
                  <Amount cents={f.amountCents} />
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* receipt-triage D29 (FR-017): one account — the cuenta de
            cobro — labelled by its kind; no list, no choice. A CLABE
            renders exactly as it always did (SC-008). */}
        <div className="divide-y divide-line-soft border-y border-line-soft">
          <CopyField label={ACCOUNT_LABEL[account!.kind]} value={account!.value} />
          {/* receipt-triage FR-017 (converge T057): a card or a phone is
              sent to through its bank — the payer's app asks for it — so
              the bank stands beside the number, not behind "Ver los demás
              datos". The CLABE carries its bank in its own digits and
              keeps today's layout (SC-008). */}
          {account!.kind !== "clabe" && account!.bank && <CopyField label="Banco" value={account!.bank} />}
          {/* payment-without-receipt FR-004 (D21, D22): the payer's
              reference beside the amount and the account, grouped to be
              read and copied as the digits a bank takes. Called the
              phone's only when it is (FR-004). */}
          {payer && (
            <CopyField
              label="Tu referencia"
              value={groupReferenceDigits(payer.digits)}
              copy={payer.digits}
              note={payer.fromPhone ? "Son los últimos 7 números de tu celular" : undefined}
            />
          )}
        </div>

        {payer?.previousDigits && (
          /* D26 (FR-040): the contact saved in the bank still has the
             previous digits */
          <Alert layout="icon">
            <Info aria-hidden />
            Tu referencia cambió: ahora es {inlineReference(payer.digits)}. Actualiza el contacto en tu
            banco.
          </Alert>
        )}

        {payer ? (
          /* D21 (FR-004): where the reference goes — the payer's bank's own
             words when a verified hint exists for their most recent bank,
             the general sentence otherwise — and the tip that makes next
             month one tap. It takes the capture tip's place: with a
             reference, the capture is the second option, not the plan. */
          <div className="flex items-start gap-3 rounded-sm bg-well px-4 py-3">
            <Info className="mt-0.5 size-4 shrink-0 text-ink-soft" aria-hidden />
            <div className="space-y-1 text-sm">
              <p className="font-medium text-ink">{referenceHint(data.learnedBanks?.[0])}</p>
              <p className="text-ink-soft">
                Guarda a {data.ispName} como contacto en tu banco con esta referencia, y el próximo mes ya
                estará ahí.
              </p>
            </div>
          </div>
        ) : (
          /* receipt-triage D8/D20 (FR-022): the capture guide's first
             moment — before the payer leaves for the bank */
          <div className="flex items-start gap-3 rounded-sm bg-well px-4 py-3">
            <Camera className="mt-0.5 size-4 shrink-0 text-ink-soft" aria-hidden />
            <div className="text-sm">
              <p className="font-medium text-ink">Al terminar, toma captura del detalle</p>
              <p className="text-ink-soft">
                Ahí aparecen la clave de rastreo o el número de referencia que necesitamos.
              </p>
            </div>
          </div>
        )}

        {/* Beneficiario, banco and concepto are checked once, if at all:
            reachable, not stacked on top of the two that are used (D19) */}
        <Collapsible>
          <CollapsibleTrigger className="group flex h-12 w-full items-center justify-between text-sm font-medium text-ink-soft transition-colors hover:text-ink">
            Ver los demás datos
            <ChevronDown
              className="size-5 transition-transform group-data-[state=open]:rotate-180"
              aria-hidden
            />
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="divide-y divide-line-soft border-t border-line-soft">
              {/* claimed-amount D5: shown when the ISP configured it,
                  hidden when not — the field is recommended, not required */}
              {data.speiBeneficiaryName && (
                <CopyField label="Beneficiario" value={data.speiBeneficiaryName} />
              )}
              {account?.kind === "clabe" && account.bank && <CopyField label="Banco" value={account.bank} />}
              {data.reference && <CopyField label="Concepto" value={data.reference} />}
            </div>
          </CollapsibleContent>
        </Collapsible>

        <div className="space-y-2">
          {/* A way forward, not a claim we verify: the payer who already
              transferred yesterday arrives here too, and this is how
              they reach their receipt (D19). */}
          <Button
            size="decisive"
            onClick={() => {
              /* payment-without-receipt D21: step 2 opens on the
                 confirmation every time the payer arrives at it */
              setProofView("confirm");
              goTo("proof");
            }}
          >
            Ya hice mi transferencia
          </Button>
          <p className="text-center text-sm text-ink-soft">
            {payer
              ? "Transfiere el monto exacto con tu referencia y vuelve aquí para confirmar tu pago."
              : "Transfiere el monto exacto desde tu banco y vuelve aquí con tu comprobante."}
          </p>
        </div>
      </Card>
    );
  }

  /* ——— 3b. Paso 2 — confirma tu pago (payment-without-receipt D8, D21) ———
     The page's new first view of step 2, in its own component so this
     file does not grow further (plan.md, Structure Decision). */
  if (payer && proofView === "confirm") {
    return (
      <Card className="space-y-5 p-6">
        <ConfirmPayment
          data={data}
          reference={payer}
          header={stepHeader(2, "Confirma tu pago")}
          busy={busy}
          error={
            pay.error && pay.error.code !== "REFERENCE_NOT_READY"
              ? { code: pay.error.code, copy: payErrorCopy(pay.error.code) }
              : null
          }
          onConfirm={(transfer) =>
            pay.mutate({ transfer, ...(resubmitOf ? { supersedes: resubmitOf } : {}) })
          }
          onNoReference={() => {
            pay.reset();
            setProofView("typed");
          }}
          onReceipt={() => {
            pay.reset();
            setProofView("receipt");
          }}
          onBack={() => goTo("transfer")}
        />
      </Card>
    );
  }

  /* ——— 3b. Paso 2 — no puse la referencia (payment-without-receipt D11) ———
     FR-031: the reference the payer did use, or their clave, with the
     receipt second. A typed reference travels as `typed`, and the server
     asks for the account's four digits only when nothing it learned ties
     the transfer to this payer (FR-032); a clave is today's door. */
  if (payer && proofView === "typed") {
    const refused = pay.error?.code ?? null;
    const today = todayIn(data.timezone);
    return (
      <Card className="space-y-5 p-6">
        <Button variant="ghost" className="-ml-2 h-10 px-2 text-sm" onClick={() => goTo("transfer")}>
          <ChevronLeft className="size-4" aria-hidden />
          Ver los datos otra vez
        </Button>

        {stepHeader(2, "No puse la referencia")}

        <p className="text-sm text-ink-soft">
          Escribe la referencia que pusiste en tu transferencia, o su clave de rastreo.
        </p>

        {refused && refused !== "SENDER_TAIL_NEEDED" && refused !== "REFERENCE_NOT_READY" && (
          <Alert variant="destructive" layout="icon">
            <TriangleAlert aria-hidden />
            {payErrorCopy(refused)}
          </Alert>
        )}

        <TransferForm
          typed
          /* FR-034: another person's reference is never searched for this
             payer — what is left is the clave, then the receipt */
          keys={refused === "REFERENCE_OF_ANOTHER" ? "clave" : "either"}
          focusClave={refused === "REFERENCE_OF_ANOTHER"}
          referenceLabel="Referencia que pusiste"
          askSenderTail={refused === "SENDER_TAIL_NEEDED"}
          busy={busy}
          amountCents={data.totalCents ?? null}
          timezone={data.timezone}
          dateRange={{ min: shiftDay(today, -30), max: today }}
          submitLabel="Buscar mi pago"
          onSubmit={(t) =>
            pay.mutate({
              transfer: t.trackingKey
                ? {
                    trackingKey: t.trackingKey,
                    ...(t.referenceNumber ? { referenceNumber: t.referenceNumber } : {}),
                    senderBank: t.senderBank,
                    date: t.date,
                    amountCents: t.amountCents,
                  }
                : {
                    referenceSource: "typed",
                    referenceNumber: t.referenceNumber,
                    senderBank: t.senderBank,
                    date: t.date,
                    amountCents: t.amountCents,
                    ...(t.senderTail ? { senderTail: t.senderTail } : {}),
                  },
              ...(resubmitOf ? { supersedes: resubmitOf } : {}),
            })
          }
        />

        <Button
          variant="secondary"
          className="h-12 w-full"
          onClick={() => {
            pay.reset();
            setProofView("receipt");
          }}
        >
          Sube tu comprobante
        </Button>
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

      {payer && referenceNotReady && (
        /* payment-without-receipt D8: REFERENCE_NOT_READY — the reference
           is not ready on the server yet, and the receipt works without it */
        <Alert layout="icon">
          <Info aria-hidden />
          Por ahora no podemos buscar tu pago con tu referencia. Sube tu comprobante o escribe los datos
          de tu transferencia.
        </Alert>
      )}

      {/* two-eyes-receipt D2: the refusal sits above the picker, which
          stays open — the payer's next move is another photo. Two
          sentences, in the existing Alert with icon + text (status is
          never colour alone, constitution VI). */}
      {refusal && (
        <Alert variant="warning" layout="icon">
          <TriangleAlert aria-hidden />
          {refusal === "not_receipt"
            ? "Esto no parece un comprobante de transferencia. Sube la captura o el PDF que te dio tu banco."
            : "No pudimos leer tu comprobante. Toma otra foto con más luz, sin mover el teléfono, y que se vea completo."}
        </Alert>
      )}

      {/* receipt-triage D5, D18 — the ask, in the place the two refusals
          use: the warning Alert at the top of the step (role="status", so
          it is announced politely) that also takes focus when it arrives
          (FR-013), and enters with the design system's own fade. */}
      {ask && (
        <div ref={askRef} tabIndex={-1} data-ask={ask.ask.reason} className="animate-enter rounded-md">
        <Alert variant="warning" layout="icon">
          <TriangleAlert aria-hidden />
          <div className="space-y-2">
            {ask.ask.reason === "wrong_destination" ? (
              /* receipt-triage FR-020 (clarified 2026-09-24): honest and
                 kind — the reading may be the one that is wrong */
              <p>
                Parece que esta transferencia se hizo a otra cuenta, no a la de {data.ispName}.{" "}
                {account &&
                  `${data.ispName} recibe pagos en ${ACCOUNT_ENDING[account.kind]} ${account.value.slice(-4)}. `}
                Si leímos mal tu comprobante, sube otra captura o escribe tus datos.
              </p>
            ) : askForm && noKeyAsks >= 2 ? (
              /* FR-012: the second capture with no key — the form leads */
              <p>
                Tu captura tampoco muestra la clave de rastreo ni el número de referencia. Escribe los
                datos de tu transferencia.
              </p>
            ) : (
              <>
                <p>
                  {ask.ask.shared
                    ? `El número de referencia de tu captura${ask.reading.referenceNumber ? ` (${ask.reading.referenceNumber})` : ""} ya lo usó otra transferencia de ese día y no muestra la clave de rastreo.`
                    : ask.reading.gate.referenceNumber === "generic"
                      ? "El número de referencia de tu captura lo usan muchas transferencias y no muestra la clave de rastreo."
                      : "Tu captura no muestra la clave de rastreo ni el número de referencia."}{" "}
                  {alsoMissing(ask.ask.fields)}
                </p>
                <p>{whereLine(ask.reading.senderBank) ?? GENERAL_HINT}</p>
              </>
            )}
          </div>
        </Alert>
        </div>
      )}
      {ask && !askForm && (
        <div className="grid gap-2">
          <Button
            variant="secondary"
            className="h-12 w-full"
            onClick={() => {
              pickerRef.current?.focus();
            }}
          >
            Subir otra captura
          </Button>
          <Button variant="secondary" className="h-12 w-full" onClick={() => setAskForm(true)}>
            Escribir los datos
          </Button>
        </div>
      )}
      {ask && askForm && (
        /* receipt-triage D18 (FR-011): everything the capture showed is
           already filled in; what it lacked says so in text */
        <TransferForm
          busy={busy}
          draft={{
            trackingKey: ask.reading.trackingKey,
            referenceNumber: ask.reading.referenceNumber,
            senderBank: ask.reading.senderBank,
            date: ask.reading.date,
          }}
          amountCents={ask.reading.amountCents ?? data.totalCents ?? null}
          missing={new Set(ask.ask.reason === "no_key" ? ask.ask.fields : [])}
          requireClave={Boolean(ask.ask.reason === "no_key" && ask.ask.shared) || submitError?.code === "REFERENCE_SHARED"}
          onSubmit={(transfer) =>
            pay.mutate({
              transfer,
              proofId: ask.proofId,
              ...(resubmitOf ? { supersedes: resubmitOf } : {}),
            })
          }
          onUploadInstead={() => {
            setAskForm(false);
            setTimeout(() => pickerRef.current?.focus(), 0);
          }}
        />
      )}

      {/* receipt-triage D8/D20 (FR-022, FR-026): what a good capture
          shows, above the upload control — never in front of it, and
          never needing a tap to get past */}
      <CaptureGuide state={guide} amountCents={data.totalCents} collectAccount={account ?? undefined} />

      <ReceiptForm
        busy={busy}
        reading={guide === "reading"}
        inputRef={pickerRef}
        onSubmit={(file) => upload.mutate(file)}
      />

      {/* D18 earned the upload its primacy: the machine reads it and,
          when the reading holds, nobody is asked anything. Typing a
          28-character clave on a phone is the fallback, so it costs one
          deliberate tap — and stays open once it has been paid for. */}
      {manualDoor ? (
        <div className="space-y-4 border-t border-line-soft pt-5">
          <h2 className="text-base font-semibold">Datos de tu transferencia</h2>
          <TransferForm
            busy={busy}
            /* claimed-amount D3: pre-filled with the expected total so
               the exact payer confirms without touching it */
            amountCents={data.totalCents ?? null}
            timezone={data.timezone}
            /* receipt-triage D7: the server found the reference shared */
            requireClave={submitError?.code === "REFERENCE_SHARED"}
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

      {submitError && submitError.code !== "REFERENCE_NOT_READY" && (
        <Alert variant="destructive" layout="icon">
          <TriangleAlert aria-hidden />
          {payErrorCopy(submitError.code)}
        </Alert>
      )}
    </Card>
  );
}
