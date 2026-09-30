import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Alert, Button, Field, formatMoney, Input, parseMoney, Pending } from "@devolada/ui";
import { BANKS, groupReferenceDigits } from "@devolada/api/direct-payments-schema";
import type { Bank, LinkStatusResponse } from "@devolada/api/direct-payments-schema";
import { ChevronLeft, Info, ShieldCheck, TriangleAlert } from "lucide-react";
import { ChoiceGroup } from "@/components/ui/choice-group";
import { NativeSelect } from "@/components/ui/native-select";
import { bankLabel } from "./bank-hints";
import { inlineReference } from "./reference-hints";
import { shiftDay, todayIn, weekdayAndDay, weekdayDayOfMonth } from "./days";

/* Step 2 with the payer's own reference — "Confirma tu pago"
   (payment-without-receipt D8, D21; contracts/payment-page.md).

   It replaces "Envía tu comprobante" as the first thing step 2 shows, and
   only when the link carries a `payerReference`: with the feature off the
   page is today's page, byte for byte (D20). The receipt stays one tap
   away as "Sube tu comprobante" (FR-039).

   Two questions, each already answered with the likely option — the bank
   and the day — then a sentence that reads back exactly what will be
   searched (FR-008), and one decisive action. The reference itself is
   never sent: the server writes the link's own (D8), so a page cannot
   confirm with somebody else's digits. */

type PayerReference = NonNullable<LinkStatusResponse["payerReference"]>;

/* What "Confirmar pago" sends as `transfer` (payRequest) */
export type ConfirmTransfer = {
  referenceSource: "own" | "typed";
  referenceNumber?: string;
  senderBank: string;
  date: string;
  amountCents?: number;
  senderTail?: string;
  preselected: { bank: Bank | null; day: string };
};

/* The "Otro banco" choice. Not a bank name, and no bank name can be it. */
const OTHER = "__other__";

/* D8: the day travels within today − 30 … today, business time */
const DAYS_BACK = 30;

export function ConfirmPayment({
  data,
  reference,
  header,
  busy,
  error,
  onConfirm,
  onNoReference,
  onReceipt,
  onBack,
}: {
  data: LinkStatusResponse;
  reference: PayerReference;
  /* The step's header, shared with every other screen of step 2 */
  header: ReactNode;
  busy: boolean;
  /* The refusal of the last "Confirmar pago", with the page's copy for it */
  error: { code: string; copy: string } | null;
  onConfirm: (transfer: ConfirmTransfer) => void;
  onNoReference: () => void;
  onReceipt: () => void;
  onBack: () => void;
}) {
  const learned = data.learnedBanks ?? [];
  const today = todayIn(data.timezone);
  const yesterday = shiftDay(today, -1);
  const earliest = shiftDay(today, -DAYS_BACK);
  const previous = reference.previousDigits;

  /* D26 (FR-040): a payer whose reference changed is asked which one they
     put, before anything else — nothing is preselected, because either
     answer is likely in the first weeks. The new one continues as their
     own; the previous one travels as typed, which the server accepts as
     theirs and guards by FR-041. */
  const [which, setWhich] = useState<"new" | "previous" | null>(previous ? null : "new");
  /* FR-010: until this person's reference has confirmed a payment, "Sí" or
     "No" comes first. "No" spends nothing. A payer who just answered the
     question above already said which reference they put. */
  const [putIt, setPutIt] = useState(reference.proven || Boolean(previous));
  const restRef = useRef<HTMLDivElement>(null);
  const [answered, setAnswered] = useState(false);
  /* The question's buttons leave the screen when answered, so focus moves
     to what replaced them instead of falling back to the page */
  useEffect(() => {
    if (answered) restRef.current?.focus();
  }, [answered]);

  /* D12 (FR-017): the most recent learned bank is preselected; with none,
     the full list opens directly — a group of one "Otro banco" asks nothing */
  const [bankChoice, setBankChoice] = useState<string>(learned[0] ?? OTHER);
  const [otherBank, setOtherBank] = useState("");
  const senderBank = bankChoice === OTHER ? otherBank : bankChoice;

  /* FR-007: "Hoy" preselected, in the business's timezone */
  const [dayChoice, setDayChoice] = useState<"today" | "yesterday" | "other">("today");
  const [otherDay, setOtherDay] = useState("");
  const date = dayChoice === "today" ? today : dayChoice === "yesterday" ? yesterday : otherDay;
  /* ISO days compare as strings */
  const dayOk = /^\d{4}-\d{2}-\d{2}$/.test(date) && date >= earliest && date <= today;

  /* FR-009: "Pagué otra cantidad" — parsed to integer cents like every
     typed amount (constitution II), never through a float */
  const [otherAmount, setOtherAmount] = useState(false);
  const [amount, setAmount] = useState(data.totalCents != null ? (data.totalCents / 100).toFixed(2) : "");
  const typedCents = parseMoney(amount);
  const amountCents = otherAmount ? typedCents : (data.totalCents ?? null);
  const amountWords = amountCents != null && amountCents > 0 ? formatMoney(amountCents) : null;

  /* D11 (FR-032, FR-041): the previous reference is typed, and the server
     asks the four digits when no learned account ties the transfer */
  const askTail = error?.code === "SENDER_TAIL_NEEDED";
  const [tail, setTail] = useState("");
  const tailOk = !askTail || /^\d{4}$/.test(tail);

  const digits = which === "previous" && previous ? previous : reference.digits;
  const ready = which !== null && putIt && senderBank !== "" && dayOk && amountWords !== null && tailOk;

  /* FR-008: the read-back follows every choice, and says only what was
     chosen — a part not chosen yet is left out, never guessed */
  const dayWords =
    dayChoice === "today"
      ? `hoy ${weekdayAndDay(today)}`
      : dayChoice === "yesterday"
        ? `ayer ${weekdayAndDay(yesterday)}`
        : dayOk
          ? `el ${weekdayDayOfMonth(date)}`
          : null;
  const readBack =
    `Buscaremos ${amountWords ? `${amountWords} ` : ""}con la referencia ${inlineReference(digits)}` +
    (senderBank ? `, desde ${bankLabel(senderBank)}` : "") +
    (dayWords ? `, ${dayWords}` : "") +
    ".";

  const selectId = useId();
  const bankSelect = (id?: string) => (
    /* D16's native select; D7 (FR-018): the business's own most used
       banks first, then the rest in the order the manual form uses */
    <NativeSelect
      id={id}
      required
      value={otherBank}
      onChange={(e) => setOtherBank(e.target.value)}
      /* Constitution VI, measured by the browser layer (T051): the
         unchosen "Elige tu banco" in the faint ink is 2.19:1 on the
         field, below AA. The secondary ink still reads as "not chosen
         yet" beside a chosen value, and passes. Only here: the manual
         door's select is today's page and keeps its look (D20). */
      className="invalid:text-ink-soft"
    >
      <option value="" disabled>
        Elige tu banco
      </option>
      {(() => {
        const first = data.bankOrder ?? [];
        const rest = [...BANKS]
          .filter((b) => !first.includes(b))
          .sort((a, b) => a.localeCompare(b, "es-MX"))
          .map((b) => (
            <option key={b} value={b}>
              {b}
            </option>
          ));
        if (!first.length) return rest;
        return (
          <>
            <optgroup label="Los más usados">
              {first.map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
            </optgroup>
            <optgroup label="Los demás bancos">{rest}</optgroup>
          </>
        );
      })()}
    </NativeSelect>
  );

  return (
    <>
      {/* The first element on the screen, as on the receipt step: a payer
          who tapped too early must not reload to see the account again */}
      <Button variant="ghost" className="-ml-2 h-10 px-2 text-sm" onClick={onBack}>
        <ChevronLeft className="size-4" aria-hidden />
        Ver los datos otra vez
      </Button>

      {header}

      {previous && (
        <Alert layout="icon">
          <Info aria-hidden />
          Tu referencia cambió: ahora es {inlineReference(reference.digits)}. Actualiza el contacto en tu
          banco.
        </Alert>
      )}

      {previous && (
        <ChoiceGroup
          legend="¿Qué referencia pusiste en tu transferencia?"
          options={[
            { value: "new", label: `${groupReferenceDigits(reference.digits)}, la nueva` },
            { value: "previous", label: `${groupReferenceDigits(previous)}, la anterior` },
          ]}
          value={which}
          onChange={(v) => setWhich(v as "new" | "previous")}
        />
      )}

      {!putIt ? (
        <div className="space-y-3">
          <p className="text-base font-medium text-ink">
            ¿Pusiste la referencia {inlineReference(reference.digits)} en tu transferencia?
          </p>
          <div className="grid grid-cols-2 gap-2">
            <Button
              variant="secondary"
              className="h-12 w-full"
              onClick={() => {
                setPutIt(true);
                setAnswered(true);
              }}
            >
              Sí
            </Button>
            {/* FR-010: nothing is sent, nothing is spent */}
            <Button variant="secondary" className="h-12 w-full" onClick={onNoReference}>
              No
            </Button>
          </div>
        </div>
      ) : (
        which !== null && (
          <div ref={restRef} tabIndex={-1} className="space-y-5 rounded-md">
            <div className="space-y-3">
              {learned.length ? (
                <ChoiceGroup
                  legend="¿Desde qué banco pagaste?"
                  options={[
                    ...learned.map((b) => ({ value: b, label: bankLabel(b) })),
                    { value: OTHER, label: "Otro banco" },
                  ]}
                  value={bankChoice}
                  onChange={setBankChoice}
                />
              ) : (
                <div>
                  <label htmlFor={selectId} className="mb-2 block text-base font-medium text-ink">
                    ¿Desde qué banco pagaste?
                  </label>
                  {bankSelect(selectId)}
                </div>
              )}
              {learned.length > 0 && bankChoice === OTHER && (
                <Field label="Elige tu banco">{bankSelect()}</Field>
              )}
            </div>

            <div className="space-y-3">
              <ChoiceGroup
                legend="¿Qué día?"
                options={[
                  { value: "today", label: `Hoy, ${weekdayAndDay(today)}` },
                  { value: "yesterday", label: `Ayer, ${weekdayAndDay(yesterday)}` },
                  { value: "other", label: "Otro día" },
                ]}
                value={dayChoice}
                onChange={(v) => setDayChoice(v as "today" | "yesterday" | "other")}
              />
              {dayChoice === "other" && (
                <div>
                  <Field label="Fecha de la transferencia">
                    <Input
                      type="date"
                      min={earliest}
                      max={today}
                      value={otherDay}
                      onChange={(e) => setOtherDay(e.target.value)}
                    />
                  </Field>
                  <p className="mt-1 text-sm text-ink-soft">Puede ser de los últimos 30 días.</p>
                </div>
              )}
              {error?.code === "TRANSFER_DATE_OUT_OF_RANGE" && (
                <Alert variant="destructive" layout="icon">
                  <TriangleAlert aria-hidden />
                  {error.copy}
                </Alert>
              )}
            </div>

            {otherAmount && (
              <Field label="Monto que transferiste">
                <Input
                  prefix="$"
                  inputMode="decimal"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="0.00"
                  autoComplete="off"
                  autoFocus
                />
              </Field>
            )}

            {askTail && (
              <div className="space-y-2">
                <p className="text-sm text-ink-soft">{error?.copy}</p>
                <Field label="Últimos 4 dígitos de tu cuenta o tarjeta">
                  <Input
                    inputMode="numeric"
                    value={tail}
                    onChange={(e) => setTail(e.target.value.replace(/\D/g, "").slice(0, 4))}
                    className="font-mono text-sm"
                    autoComplete="off"
                    autoFocus
                  />
                </Field>
              </div>
            )}

            {/* FR-008: what will be searched, before it is */}
            <p className="rounded-sm bg-well px-4 py-3 text-base text-ink" aria-live="polite">
              {readBack}
            </p>

            <Pending active={busy} label="Estamos enviando tu confirmación.">
              <Button
                size="decisive"
                disabled={!ready || busy}
                onClick={() =>
                  onConfirm({
                    referenceSource: which === "previous" ? "typed" : "own",
                    ...(which === "previous" && previous ? { referenceNumber: previous } : {}),
                    senderBank,
                    date,
                    ...(otherAmount && amountCents != null ? { amountCents } : {}),
                    ...(askTail ? { senderTail: tail } : {}),
                    /* D23 (SC-005): what the page offered, not what was sent */
                    preselected: { bank: learned[0] ?? null, day: today },
                  })
                }
              >
                <ShieldCheck className="size-5" aria-hidden />
                {busy ? "Enviando…" : "Confirmar pago"}
              </Button>
            </Pending>

            {error && error.code !== "TRANSFER_DATE_OUT_OF_RANGE" && !askTail && (
              <Alert variant="destructive" layout="icon">
                <TriangleAlert aria-hidden />
                {error.copy}
              </Alert>
            )}
          </div>
        )
      )}

      {/* The small exits (contracts/payment-page.md step 6): at 48px,
          quieter than the decisive action, never hidden behind it */}
      <div className="grid gap-1">
        {putIt && which !== null && !otherAmount && (
          <Button variant="ghost" className="h-12 w-full text-sm" onClick={() => setOtherAmount(true)}>
            Pagué otra cantidad
          </Button>
        )}
        {putIt && (
          <Button variant="ghost" className="h-12 w-full text-sm" onClick={onNoReference}>
            No puse la referencia
          </Button>
        )}
        <Button variant="ghost" className="h-12 w-full text-sm" onClick={onReceipt}>
          Sube tu comprobante
        </Button>
      </div>
    </>
  );
}
