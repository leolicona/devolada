import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Alert, Button, Field, formatMoney, Input, parseMoney, Pending } from "@devolada/ui";
import { groupReferenceDigits } from "@devolada/api/direct-payments-schema";
import type { Bank, LinkStatusResponse } from "@devolada/api/direct-payments-schema";
import { ChevronLeft, Info, ShieldCheck, TriangleAlert } from "lucide-react";
import { ChoiceGroup } from "@/components/ui/choice-group";
import { NativeSelect } from "@/components/ui/native-select";
import { bankLabel } from "./bank-hints";
import { inlineReference } from "./reference-hints";
import { shiftDay, shortWeekdayAndDay, todayIn, weekdayAndDay, weekdayDayOfMonth } from "./days";
import { payerBanks } from "./payer-banks";
import { ReceiptLink } from "./ReceiptLink";

/* Step 2 with the payer's own reference — "Confirma tu pago"
   (payment-without-receipt D8, D21; contracts/payment-page.md).

   It replaces "Envía tu comprobante" as the first thing step 2 shows, and
   only when the link carries a `payerReference`: with the feature off the
   page is today's page, byte for byte (D20).

   Two questions, each already answered with the likely option — the bank
   and the day — then a sentence that reads back exactly what will be
   searched (FR-008), and one decisive action. The reference itself is
   never sent: the server writes the link's own (D8), so a page cannot
   confirm with somebody else's digits.

   confirmation-hierarchy D2 (spec FR-001–FR-004): the step offers exactly
   three ways to confirm, in this order — option 1, this confirmation, with
   the only decisive button; option 2, **Usé otra referencia**, a standard
   secondary control right below it; option 3, the receipt, as the quiet
   `ReceiptLink`, last. Keyboard and screen reader follow the same order
   (FR-008). Proposal E (D17, D18): the bank and the day are chips, and
   one tap says why they are enough. */

type PayerReference = NonNullable<LinkStatusResponse["payerReference"]>;

/* What "Confirmar pago" sends as `transfer` (payRequest) */
export type ConfirmTransfer = {
  referenceSource: "own" | "typed";
  referenceNumber?: string;
  senderBank: string;
  date: string;
  amountCents?: number;
  preselected: { bank: Bank | null; day: string };
};

/* The "Otro banco" choice. Not a bank name, and no bank name can be it. */
const OTHER = "__other__";

/* D8: the day travels within today − 30 … today, business time */
const DAYS_BACK = 30;

/* confirmation-hierarchy D21: what the payer chose on the confirmation —
   kept by `PaymentPage` beside its `proofView`, so option 2 reads the same
   bank, day and amount instead of asking them again (FR-029), and "Volver"
   finds them as they were. Page state, never the device's: a reload starts
   from the likely answers again. */
export type ConfirmChoice = {
  /* D26 (FR-040): which reference was put, while it changed */
  which: "new" | "previous" | null;
  /* FR-010: "Sí" answered, or nothing to ask */
  putIt: boolean;
  bankChoice: string;
  otherBank: string;
  dayChoice: "today" | "yesterday" | "other";
  otherDay: string;
  /* FR-009: "Pagué otra cantidad" */
  otherAmount: boolean;
  amount: string;
};

export function initialChoice(data: LinkStatusResponse, reference: PayerReference): ConfirmChoice {
  const previous = reference.previousDigits;
  return {
    /* D26: nothing preselected while the reference changed — either answer
       is likely in the first weeks */
    which: previous ? null : "new",
    /* FR-010: until this person's reference confirmed a payment, "Sí" or
       "No" comes first. A payer who answers the question above already
       said which reference they put. */
    putIt: reference.proven || Boolean(previous),
    /* D12 (FR-017): the most recent learned bank is preselected; with none,
       the full list opens directly — a group of one "Otro banco" asks
       nothing */
    bankChoice: data.learnedBanks?.[0] ?? OTHER,
    otherBank: "",
    /* FR-007: "Hoy" preselected, in the business's timezone */
    dayChoice: "today",
    otherDay: "",
    otherAmount: false,
    amount: data.totalCents != null ? (data.totalCents / 100).toFixed(2) : "",
  };
}

/* The choice read as what would travel, and as words */
export function readChoice(choice: ConfirmChoice, data: LinkStatusResponse) {
  const today = todayIn(data.timezone);
  const yesterday = shiftDay(today, -1);
  const earliest = shiftDay(today, -DAYS_BACK);
  const senderBank = choice.bankChoice === OTHER ? choice.otherBank : choice.bankChoice;
  const date = choice.dayChoice === "today" ? today : choice.dayChoice === "yesterday" ? yesterday : choice.otherDay;
  /* ISO days compare as strings */
  const dayOk = /^\d{4}-\d{2}-\d{2}$/.test(date) && date >= earliest && date <= today;
  /* FR-009: parsed to integer cents like every typed amount (constitution
     II), never through a float */
  const amountCents = choice.otherAmount ? parseMoney(choice.amount) : (data.totalCents ?? null);
  const amountOk = amountCents != null && amountCents > 0;
  /* FR-008: a part not chosen yet is left out, never guessed */
  const dayWords =
    choice.dayChoice === "today"
      ? `hoy ${weekdayAndDay(today)}`
      : choice.dayChoice === "yesterday"
        ? `ayer ${weekdayAndDay(yesterday)}`
        : dayOk
          ? `el ${weekdayDayOfMonth(date)}`
          : null;
  /* D21: the day as option 2's tag reads it */
  const dayTag =
    choice.dayChoice === "today"
      ? `Hoy · ${shortWeekdayAndDay(today)}`
      : choice.dayChoice === "yesterday"
        ? `Ayer · ${shortWeekdayAndDay(yesterday)}`
        : dayOk
          ? weekdayAndDay(date)
          : "Elige el día";
  return { today, yesterday, earliest, senderBank, date, dayOk, amountCents, amountOk, dayWords, dayTag };
}

export function ConfirmPayment({
  data,
  reference,
  header,
  busy,
  error,
  choice,
  onChoice,
  onConfirm,
  onOtherReference,
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
  choice: ConfirmChoice;
  onChoice: (patch: Partial<ConfirmChoice>) => void;
  onConfirm: (transfer: ConfirmTransfer) => void;
  /* confirmation-hierarchy D3: option 2's view — also 012's *No* */
  onOtherReference: () => void;
  /* D3: option 3's view — PaymentPage's receipt block */
  onReceipt: () => void;
  onBack: () => void;
}) {
  const learned = data.learnedBanks ?? [];
  const previous = reference.previousDigits;
  const { which, putIt, bankChoice, otherBank, dayChoice, otherDay, otherAmount, amount } = choice;
  const { today, yesterday, earliest, senderBank, date, dayOk, amountCents, amountOk, dayWords } = readChoice(choice, data);
  const amountWords = amountOk ? formatMoney(amountCents!) : null;

  const restRef = useRef<HTMLDivElement>(null);
  const [answered, setAnswered] = useState(false);
  /* The question's buttons leave the screen when answered, so focus moves
     to what replaced them instead of falling back to the page */
  useEffect(() => {
    if (answered) restRef.current?.focus();
  }, [answered]);

  /* FR-028: one sentence, opened in place; nothing is sent */
  const [why, setWhy] = useState(false);
  const whyId = useId();

  const digits = which === "previous" && previous ? previous : reference.digits;
  const ready = which !== null && putIt && senderBank !== "" && dayOk && amountWords !== null;

  /* FR-008: the read-back follows every choice */
  const readBack =
    `Buscaremos ${amountWords ? `${amountWords} ` : ""}con la referencia ${inlineReference(digits)}` +
    (senderBank ? `, desde ${bankLabel(senderBank)}` : "") +
    (dayWords ? `, ${dayWords}` : "") +
    ".";

  const selectId = useId();
  const bankSelect = (id?: string) => (
    /* D16's native select; D7 (FR-018): the business's own most used
       banks first, then the rest in the order the manual form uses.
       confirmation-hierarchy D15: never Banxico (`payerBanks`). */
    <NativeSelect
      id={id}
      required
      value={otherBank}
      onChange={(e) => onChoice({ otherBank: e.target.value })}
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
        const first = (data.bankOrder ?? []).filter((b) => payerBanks.includes(b));
        const rest = [...payerBanks]
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

      {/* Proposal E (D17): what will be searched with, under the header —
          the accent-subtle surface, the body ink */}
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-sm bg-accent-soft px-4 py-3">
        <p className="text-sm font-medium text-ink">Buscaremos con tu referencia</p>
        <p className="font-mono text-base font-semibold tabular-nums text-ink">{groupReferenceDigits(digits)}</p>
      </div>

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
          onChange={(v) => onChoice({ which: v as "new" | "previous" })}
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
                onChoice({ putIt: true });
                setAnswered(true);
              }}
            >
              Sí
            </Button>
            {/* FR-010: nothing is sent, nothing is spent; confirmation-
                hierarchy D3: it opens option 2 */}
            <Button variant="secondary" className="h-12 w-full" onClick={onOtherReference}>
              No
            </Button>
          </div>
        </div>
      ) : (
        which !== null && (
          <div ref={restRef} tabIndex={-1} className="space-y-5 rounded-md">
            <div className="space-y-2">
              {learned.length ? (
                <ChoiceGroup
                  layout="chips"
                  legend="¿Desde qué banco pagaste?"
                  options={[
                    ...learned.map((b) => ({ value: b, label: bankLabel(b) })),
                    { value: OTHER, label: "Otro banco" },
                  ]}
                  value={bankChoice}
                  onChange={(v) => onChoice({ bankChoice: v })}
                />
              ) : (
                <div>
                  <label htmlFor={selectId} className="mb-2 block text-base font-medium text-ink">
                    ¿Desde qué banco pagaste?
                  </label>
                  {bankSelect(selectId)}
                </div>
              )}
              {learned.length > 0 && (
                /* FR-027: the preselected bank is the last payment's */
                <p className="text-sm text-ink-soft">Elegimos el banco de tu último pago. Cámbialo si pagaste desde otro.</p>
              )}
              {learned.length > 0 && bankChoice === OTHER && (
                <Field label="Elige tu banco">{bankSelect()}</Field>
              )}
            </div>

            <div className="space-y-3">
              <ChoiceGroup
                layout="chips"
                legend="¿Qué día?"
                options={[
                  { value: "today", label: `Hoy · ${shortWeekdayAndDay(today)}` },
                  { value: "yesterday", label: `Ayer · ${shortWeekdayAndDay(yesterday)}` },
                  { value: "other", label: "Otro día" },
                ]}
                value={dayChoice}
                onChange={(v) => onChoice({ dayChoice: v as ConfirmChoice["dayChoice"] })}
              />
              {dayChoice === "other" && (
                <div>
                  <Field label="Fecha de la transferencia">
                    <Input
                      type="date"
                      min={earliest}
                      max={today}
                      value={otherDay}
                      onChange={(e) => onChoice({ otherDay: e.target.value })}
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

            {/* FR-028 (D17): why the bank and the day are enough — a
                link-styled control at the touch size, opening in place */}
            <div>
              <Button
                variant="link"
                className="h-12 justify-start"
                aria-expanded={why}
                aria-controls={whyId}
                onClick={() => setWhy((open) => !open)}
              >
                ¿Por qué te preguntamos esto?
              </Button>
              {why && (
                <p id={whyId} className="animate-enter rounded-sm bg-well px-4 py-3 text-sm text-ink">
                  Tu referencia, el banco y el día nos bastan para encontrar tu transferencia entre todas las de ese día.
                  Por eso no te pedimos comprobante.
                </p>
              )}
            </div>

            {otherAmount && (
              <Field label="Monto que transferiste">
                <Input
                  prefix="$"
                  inputMode="decimal"
                  value={amount}
                  onChange={(e) => onChoice({ amount: e.target.value })}
                  placeholder="0.00"
                  autoComplete="off"
                  autoFocus
                />
              </Field>
            )}

            {/* FR-008: what will be searched, before it is */}
            <p className="rounded-sm bg-well px-4 py-3 text-base text-ink" aria-live="polite">
              {readBack}
            </p>

            {/* FR-002: "Pagué otra cantidad" belongs to option 1, above its
                button */}
            {!otherAmount && (
              <Button variant="ghost" className="h-12 w-full text-sm" onClick={() => onChoice({ otherAmount: true })}>
                Pagué otra cantidad
              </Button>
            )}

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
                    /* D23 (SC-005): what the page offered, not what was sent */
                    preselected: { bank: learned[0] ?? null, day: today },
                  })
                }
              >
                <ShieldCheck className="size-5" aria-hidden />
                {busy ? "Enviando…" : "Confirmar pago"}
              </Button>
            </Pending>

            {error && error.code !== "TRANSFER_DATE_OUT_OF_RANGE" && (
              <Alert variant="destructive" layout="icon">
                <TriangleAlert aria-hidden />
                {error.copy}
              </Alert>
            )}
          </div>
        )
      )}

      {/* confirmation-hierarchy D2 (FR-001, FR-003): option 2 visible on
          the step's first screen, a standard control, never behind a link —
          on the first-time question its *No* is option 2 already — then
          option 3, quiet and last (FR-004) */}
      <div className="grid gap-2">
        {putIt && (
          <Button variant="secondary" className="w-full" onClick={onOtherReference}>
            Usé otra referencia
          </Button>
        )}
        <ReceiptLink onClick={onReceipt} />
      </div>
    </>
  );
}
