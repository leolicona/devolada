import { useEffect, useState } from "react";
import { Navigate, useRouterState } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, KeyRound, Lock, TriangleAlert } from "lucide-react";
import { Button, Card, Input, Pending, Skeleton, parseMoney } from "@devolada/ui";
import type { SettingsPatchRequest, SettingsResponse } from "@devolada/api/settings-schema";
import { luhnValid, TIMEZONES } from "@devolada/api/settings-schema";
import { roleCan, type Role } from "@devolada/api/role-matrix";
import { useSession } from "../auth/session";
import { SubPage } from "../account/AccountHub";
import { bankForClabe } from "@devolada/api/clabe";
import type { Bank } from "@devolada/api/settings-schema";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Combobox } from "@/components/ui/combobox";
import { BANK_OPTIONS } from "@/lib/banks";
import { Switch } from "@/components/ui/switch";
import { api, ApiError } from "@/lib/api";
import { formatTime, SAMPLE_TIME_MS } from "@/lib/datetime";

/* The business's settings, in two pages since D11 (US-A04):
   /settings/direct-payment answers where the money arrives (the SPEI
   channel, with the one service fee — D9) and how a payment is judged
   against what was asked (the reconciliation policy); /settings/preferences
   answers how a clock reads. One page called "Configuración" was naming
   none of the three. /settings/business, the page they come from, is now
   a redirect. Saldo, Usuarios and the passkeys have pages of their own
   (account-hub D4). */

const pesos = (cents: number) => (cents / 100).toFixed(2);

function useSaveSettings() {
  const queryClient = useQueryClient();
  return useMutation<SettingsResponse, ApiError, SettingsPatchRequest>({
    mutationFn: (body) =>
      api<SettingsResponse>("/settings", { method: "PATCH", body: JSON.stringify(body) }),
    onSuccess: (data) => {
      queryClient.setQueryData(["settings"], data);
      /* The session carries timezone, format and the key flag (D7) */
      void queryClient.invalidateQueries({ queryKey: ["session"] });
      void queryClient.invalidateQueries({ queryKey: ["feed"] });
    },
  });
}

function SectionCard({
  title,
  id,
  headingId,
  children,
}: {
  title: string;
  id?: string;
  /* For a card whose one control is named by the heading itself */
  headingId?: string;
  children: React.ReactNode;
}) {
  return (
    <Card className="p-6" id={id}>
      {/* scroll-mt keeps the heading clear of the top edge when a deep
          link (the CLABE banner, the wizard, a legacy hash) lands here */}
      <h3 id={headingId} className="scroll-mt-24 text-base font-semibold">
        {title}
      </h3>
      <div className="mt-4 space-y-4">{children}</div>
    </Card>
  );
}

/* D10 (2026-09-03): no in-page index. It was born when this page was
   ~3,000px and ended at Usuarios; the hub took four cards away (account-hub
   D4) and the fee took a fifth (D9), leaving three cards a reader sees
   without scrolling — a table of contents for a page you can already see
   is furniture. The ids stay: #spei, #politica and #zona are the deep-link
   contract the banners and HASH_HOMES depend on. */

/* receipt-triage D9, D29 (contracts/settings.md): the three kinds of
   account a business can be paid at, in the owner's words */
type CollectKind = "clabe" | "card" | "phone";
const KIND_LABEL: Record<CollectKind, string> = {
  clabe: "CLABE",
  card: "Tarjeta de débito",
  phone: "Celular",
};

/* One optional account row: a number and its bank. The owner edits it;
   everyone else reads it as they read the CLABE (FR-016). */
function AccountRow({
  id,
  label,
  help,
  placeholder,
  maxLength,
  value,
  onValue,
  bank,
  onBank,
  editable,
  error,
  bankError,
}: {
  id: string;
  label: string;
  help: string;
  placeholder: string;
  maxLength: number;
  value: string;
  onValue: (v: string) => void;
  bank: Bank | "";
  onBank: (v: Bank) => void;
  editable: boolean;
  error: string | null;
  bankError: string | null;
}) {
  return (
    <div className="grid gap-4 sm:col-span-2 sm:grid-cols-2">
      <div>
        <Label htmlFor={id}>{label}</Label>
        {editable ? (
          <Input
            size="compact"
            id={id}
            className="mt-1 font-mono"
            inputMode="numeric"
            maxLength={maxLength}
            value={value}
            onChange={(e) => onValue(e.target.value.replace(/\D/g, ""))}
            placeholder={placeholder}
            autoComplete="off"
          />
        ) : (
          <p id={id} className="mt-1 font-mono text-sm">
            {value || "Sin configurar"}
          </p>
        )}
        {error && <p className="mt-1 text-sm font-medium text-error">{error}</p>}
        <p className="mt-1 text-sm text-ink-soft">{help}</p>
      </div>
      <div>
        <Label htmlFor={`${id}-bank`}>Banco de {label.toLowerCase() === "clabe" ? "la CLABE" : label.toLowerCase()}</Label>
        {editable ? (
          <Combobox
            id={`${id}-bank`}
            label={`Banco de ${label.toLowerCase()}`}
            className="mt-1"
            placeholder="Elige el banco"
            value={bank}
            options={BANK_OPTIONS}
            onValueChange={(v) => onBank(v as Bank)}
          />
        ) : (
          <p id={`${id}-bank`} className="mt-1 text-sm">
            {bank || "—"}
          </p>
        )}
        {bankError && <p className="mt-1 text-sm font-medium text-error">{bankError}</p>}
      </div>
    </div>
  );
}

/* Pago directo por SPEI (direct-payment spec, US-D05). D4: the account
   is the ISP's own — the money never touches Devolada. Settings D9: the
   service fee is one number and this is its only control — the field
   opens on the fee in force and always saves a number, so the API's
   birth default (direct-payment D3) is never something the owner edits.

   receipt-triage D9, D26, D29, D32: "Cuentas para recibir pagos" — a
   CLABE, a debit card and a phone, each optional with its bank, and the
   one the payers see chosen below them. No kind is required; the channel
   opens once the chosen account is registered. The owner edits them all
   (the `clabe` area); an admin reads them and edits the rest. The card
   keeps its title and its #spei anchor — the banners and the wizard deep
   link here — and the accounts sit under their own heading inside it
   (contracts/settings.md, amended 2026-09-25). */
function SpeiCard({ settings, canEditClabe }: { settings: SettingsResponse; canEditClabe: boolean }) {
  const save = useSaveSettings();
  const [clabe, setClabe] = useState(settings.spei.clabe ?? "");
  /* D16: the picker's own type — the API takes a name from the vocabulary
     or nothing, and "" is what "not configured yet" looks like here. */
  const [bank, setBank] = useState<Bank | "">((settings.spei.bank as Bank | null) ?? "");
  /* D5 (2026-09-02): the CLABE form moved here from the wizard, and so did
     the prefix pick — the bank is seeded from the 3-digit prefix until the
     owner picks one by hand (direct-payment D16, BUG-007) */
  const [bankTouched, setBankTouched] = useState(false);
  function onClabeChange(value: string) {
    setClabe(value);
    if (!bankTouched) setBank(bankForClabe(value) ?? "");
  }
  const [card, setCard] = useState(settings.spei.card ?? "");
  const [cardBank, setCardBank] = useState<Bank | "">((settings.spei.cardBank as Bank | null) ?? "");
  const [phone, setPhone] = useState(settings.spei.phone ?? "");
  const [phoneBank, setPhoneBank] = useState<Bank | "">((settings.spei.phoneBank as Bank | null) ?? "");
  const [collectKind, setCollectKind] = useState<CollectKind | null>(settings.spei.collectKind ?? "clabe");
  const [beneficiary, setBeneficiary] = useState(settings.spei.beneficiaryName ?? "");
  const [fee, setFee] = useState(pesos(settings.spei.effectiveServiceFeeCents));

  const clabeValid = /^\d{18}$/.test(clabe.trim());
  const cardFormat = /^\d{16}$/.test(card);
  const cardValid = cardFormat && luhnValid(card);
  const phoneValid = /^\d{10}$/.test(phone);
  /* The inline errors of contracts/settings.md § Screen */
  const cardError =
    card === "" ? null : !cardFormat ? "La tarjeta debe tener 16 dígitos." : !cardValid ? "Revisa el número de la tarjeta: no es válido." : null;
  const phoneError = phone === "" || phoneValid ? null : "El celular debe tener 10 dígitos.";
  const cardBankError = card !== "" && cardBank === "" ? "Elige el banco." : null;
  const phoneBankError = phone !== "" && phoneBank === "" ? "Elige el banco." : null;
  /* An account is registered when its number is valid and it has a bank */
  const registered: { kind: CollectKind; value: string }[] = [
    ...(clabeValid && bank !== "" ? [{ kind: "clabe" as const, value: clabe.trim() }] : []),
    ...(cardValid && cardBank !== "" ? [{ kind: "card" as const, value: card }] : []),
    ...(phoneValid && phoneBank !== "" ? [{ kind: "phone" as const, value: phone }] : []),
  ];
  const collectRegistered = registered.some((a) => a.kind === collectKind);
  /* D29: the cuenta de cobro must be one of them. Clearing the one that is
     chosen while another exists asks the owner to choose first. */
  const collectError =
    registered.length === 0 || collectRegistered
      ? null
      : collectKind && settings.spei.collectKind === collectKind
        ? "No puedes borrar la cuenta donde te pagan: elige otra primero."
        : "Elige la cuenta donde te pagarán.";
  /* D9: a fee is required — an empty field is not "clear", it is a
     payer shown an amount nobody chose */
  const feeCents = parseMoney(fee);
  const feeValid = feeCents !== null;
  /* claimed-amount D5: the beneficiary name is recommended, not required —
     empty is a valid configuration, and the API takes ≥3 chars or null */
  const beneficiaryValid = beneficiary.trim() === "" || beneficiary.trim().length >= 3;
  const accountsValid =
    !canEditClabe ||
    ((clabe.trim() === "" || clabeValid) &&
      !cardError &&
      !phoneError &&
      !cardBankError &&
      !phoneBankError &&
      !collectError);
  /* receipt-triage D32: a CLABE is no longer required — only a bank for
     the CLABE that is there */
  const valid =
    accountsValid && (clabe.trim() === "" || bank.trim().length >= 2) && beneficiaryValid && feeValid;

  return (
    <SectionCard title="Pago directo por SPEI" id="spei">
      <p className="text-sm text-muted-foreground">
        {settings.spei.configured
          ? "Tus clientes con banco pueden pagar por transferencia desde su link de pago."
          : "Aún no está activo. Con una cuenta registrada, tus clientes con banco podrán pagar por transferencia."}
      </p>

      <h4 className="text-sm font-semibold">Cuentas para recibir pagos</h4>
      {!canEditClabe && (
        <p className="flex items-center gap-2 text-sm text-ink-soft">
          <Lock className="size-4 shrink-0" aria-hidden />
          Solo la persona dueña del negocio puede cambiarlas.
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Label htmlFor="spei-clabe">CLABE</Label>
          {canEditClabe ? (
            <Input size="compact"
              id="spei-clabe"
              className="mt-1 font-mono"
              inputMode="numeric"
              maxLength={18}
              value={clabe}
              onChange={(e) => onClabeChange(e.target.value)}
              placeholder="18 dígitos"
              autoComplete="off"
            />
          ) : (
            /* business-and-memberships D3: the CLABE is the owner's area.
               An admin sees it (it is their business's account) and
               changes everything around it — the field is not offered. */
            <p id="spei-clabe" className="mt-1 font-mono text-sm">
              {settings.spei.clabe ?? "Sin configurar"}
            </p>
          )}
          {canEditClabe && clabe.trim() !== "" && !clabeValid && (
            <p className="mt-1 text-sm font-medium text-error">La CLABE debe tener 18 dígitos.</p>
          )}
          <p className="mt-1 text-sm text-ink-soft">
            La cuenta donde recibes las transferencias. El dinero llega directo a ti.
          </p>
        </div>
        <div>
          <Label htmlFor="spei-bank">Banco</Label>
          {settings.spei.bankUnknown && (
            /* BUG-008: the bank was saved before the list existed and no
               longer resolves, so the channel is closed until it is picked
               again. Silence here meant every payment failing invisibly. */
            <p role="status" className="mt-1 flex items-start gap-2 text-sm text-danger">
              <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
              <span>
                El banco guardado (<strong>{settings.spei.bank}</strong>) ya no está en la lista, así
                que los pagos por transferencia están desactivados. Elígelo de nuevo para
                reactivarlos.
              </span>
            </p>
          )}
          {/* D16: this name travels as `beneficiary.bank` on every
              validation this ISP ever runs, so a value the provider does
              not recognise does not lose one payment — it loses all of
              them, and silently: apiCEP answers `invalid`, never an error.
              Typed free-hand this said "STP, BBVA, Banorte…", and two of
              those three are not names it accepts. */}
          {/* searchable-picker D1 — a search field, not a list: 97 names are
              searched, not scanned, and the field is the search box. The
              prefix above still seeds it, and a hand pick wins from then on
              (FR-008). */}
          <Combobox
            id="spei-bank"
            label="Banco"
            className="mt-1"
            placeholder="Elige tu banco"
            value={bank}
            options={BANK_OPTIONS}
            onValueChange={(v) => {
              setBankTouched(true);
              setBank(v as Bank);
            }}
          />
        </div>
        <div className="hidden sm:block" aria-hidden />

        <AccountRow
          id="spei-card"
          label="Tarjeta de débito"
          help="Debe ser una tarjeta de débito que reciba transferencias."
          placeholder="16 dígitos"
          maxLength={16}
          value={card}
          onValue={setCard}
          bank={cardBank}
          onBank={setCardBank}
          editable={canEditClabe}
          error={canEditClabe ? cardError : null}
          bankError={canEditClabe ? cardBankError : null}
        />
        <AccountRow
          id="spei-phone"
          label="Celular para transferencias"
          help="El número que tu banco tiene registrado para recibir transferencias."
          placeholder="10 dígitos"
          maxLength={10}
          value={phone}
          onValue={setPhone}
          bank={phoneBank}
          onBank={setPhoneBank}
          editable={canEditClabe}
          error={canEditClabe ? phoneError : null}
          bankError={canEditClabe ? phoneBankError : null}
        />

        {/* receipt-triage D29 (FR-016): the cuenta de cobro — the only
            account the payers see. Nothing is selectable until an account
            is registered. */}
        <fieldset className="sm:col-span-2" disabled={!canEditClabe}>
          <legend className="text-sm font-medium">¿Dónde quieres que te paguen tus clientes?</legend>
          {registered.length === 0 ? (
            <p className="mt-2 text-sm text-ink-soft">Registra una cuenta para elegirla.</p>
          ) : (
            <div className="mt-2 flex flex-wrap gap-2">
              {registered.map((a) => (
                <label
                  key={a.kind}
                  className="flex h-10 cursor-pointer items-center gap-2 rounded-sm border border-line px-3 text-sm has-[:checked]:border-accent has-[:checked]:bg-accent-soft"
                >
                  <input
                    type="radio"
                    name="spei-collect-kind"
                    value={a.kind}
                    checked={collectKind === a.kind}
                    onChange={() => setCollectKind(a.kind)}
                    className="accent-accent"
                  />
                  {KIND_LABEL[a.kind]} ••••{a.value.slice(-4)}
                </label>
              ))}
            </div>
          )}
          {canEditClabe && collectError && <p className="mt-1 text-sm font-medium text-error">{collectError}</p>}
          <p className="mt-1 text-sm text-ink-soft">
            Tus clientes solo verán esta cuenta. Si alguien te paga en otra de las que registraste,
            también la verificamos.
          </p>
        </fieldset>

        <div>
          <Label htmlFor="spei-beneficiary">Nombre del beneficiario (opcional)</Label>
          <Input size="compact"
            id="spei-beneficiary"
            className="mt-1"
            value={beneficiary}
            onChange={(e) => setBeneficiary(e.target.value)}
            placeholder="Como aparece en tu cuenta"
          />
          <p className="mt-1 text-sm text-ink-soft">
            Recomendado: es lo que tu cliente compara antes de transferir.
          </p>
        </div>
        <div>
          <Label htmlFor="spei-fee">Cargo por servicio SPEI</Label>
          {/* design-review D8: money fields carry the sign */}
          <Input size="compact"
            id="spei-fee"
            prefix="$"
            inputMode="decimal"
            className="mt-1"
            value={fee}
            onChange={(e) => setFee(e.target.value)}
          />
          {fee.trim() !== "" && !feeValid && (
            <p className="mt-1 text-sm font-medium text-error">Escribe un monto válido.</p>
          )}
          <p className="mt-1 text-sm text-ink-soft">
            Lo que paga tu cliente además de su cargo del periodo al transferir.
          </p>
        </div>
      </div>

      {/* feedback-vocabulary-rollout D1/D4: an action the operator started is
          announced at the control they used. Disabled plus a changed word is
          not a signal — it is silent to a screen reader and easy to miss. */}
      <Pending active={save.isPending} label="Guardando el pago directo.">
        <Button size="compact"
          disabled={!valid || save.isPending}
          onClick={() =>
            save.mutate({
              ...(canEditClabe
                ? {
                    speiClabe: clabe.trim() === "" ? null : clabe.trim(),
                    /* receipt-triage D29/D30: every account field travels
                       together, so the server judges the merged row once */
                    speiCard: card === "" ? null : card,
                    speiCardBank: card === "" ? null : cardBank || null,
                    speiPhone: phone === "" ? null : phone,
                    speiPhoneBank: phone === "" ? null : phoneBank || null,
                    ...(collectKind && collectRegistered ? { speiCollectKind: collectKind } : {}),
                  }
                : {}),
              speiBank: clabe.trim() === "" && canEditClabe ? null : bank === "" ? null : bank,
              /* D5: empty clears — the API takes ≥3 chars or null */
              speiBeneficiaryName: beneficiary.trim() === "" ? null : beneficiary.trim(),
              speiServiceFeeCents: feeCents!,
            })
          }
        >
          {save.isPending ? "Guardando…" : "Guardar pago directo"}
        </Button>
      </Pending>
      {save.isSuccess && !save.isPending && (
        <p role="status" className="text-sm font-medium text-success">
          Guardado.
        </p>
      )}
      {save.error?.code === "VALIDATION_ERROR" && (
        <p role="alert" className="text-sm font-medium text-error">
          Revisa las cuentas: no pudimos guardarlas.
        </p>
      )}
    </SectionCard>
  );
}

/* payment-without-receipt D20 (FR-039): the switch, per business. On,
   payers pay with their own reference and confirm without a receipt;
   off is today's flow, exactly, and every reference is kept for when it
   comes back on. It sits on this page because the page is already the
   `settings: update` area D20 puts it under — an operator or a viewer
   never reaches it (useBusinessSettings), and the API answers 403 to
   one who tries. Saves on toggle, like the integration's switches: a
   gate should not wait behind a Save button (integrations-hub D4). The
   heading names the switch, so the card says it once. */
function ReferenceCard({ settings }: { settings: SettingsResponse }) {
  const save = useSaveSettings();
  return (
    <SectionCard title="Pagar con referencia" id="referencia" headingId="pay-by-reference-title">
      <div className="flex items-start justify-between gap-4">
        <p id="pay-by-reference-help" className="text-sm text-ink-soft">
          Tus clientes pagan con su referencia y confirman sin comprobante. El comprobante sigue
          disponible.
        </p>
        {/* feedback-vocabulary-rollout D1/D4: the wait is announced at the
            control the owner used */}
        <Pending active={save.isPending} label="Guardando el pago con referencia.">
          <Switch
            id="pay-by-reference"
            aria-labelledby="pay-by-reference-title"
            aria-describedby="pay-by-reference-help"
            checked={settings.payByReference}
            disabled={save.isPending}
            onCheckedChange={(v) => save.mutate({ payByReference: v })}
          />
        </Pending>
      </div>
      {save.isError && (
        <p role="alert" className="flex items-center gap-2 text-sm font-medium text-error">
          <TriangleAlert className="size-4 shrink-0" aria-hidden />
          No pudimos guardar el cambio. Intenta de nuevo.
        </p>
      )}
    </SectionCard>
  );
}

/* Política de conciliación (payments-and-classes D1/D2, US-R02): the
   tolerance that still reads "exacto" and what a surplus means. When the
   integration absorbs surplus on its own, the effective treatment is
   shown, never hidden. */
function PolicyCard({ settings }: { settings: SettingsResponse }) {
  const save = useSaveSettings();
  const [tolerance, setTolerance] = useState(pesos(settings.reconciliationPolicy.toleranceCents));
  const [treatment, setTreatment] = useState<"flag" | "credit">(
    settings.reconciliationPolicy.overTreatment,
  );
  const tolCents = parseMoney(tolerance);
  const valid = tolCents !== null && tolCents <= 10000;
  const overridden =
    settings.reconciliationPolicy.effectiveOverTreatment !==
    settings.reconciliationPolicy.overTreatment;

  return (
    <SectionCard title="Política de conciliación" id="politica">
      <p className="text-sm text-muted-foreground">
        Cada pago confirmado se clasifica contra lo que se pidió: exacto, pago parcial o sobrante.
        La clase se calcula al confirmar y no cambia después.
      </p>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="policy-tolerance">Tolerancia</Label>
          <Input size="compact"
            id="policy-tolerance"
            prefix="$"
            inputMode="decimal"
            className="mt-1"
            value={tolerance}
            onChange={(e) => setTolerance(e.target.value)}
          />
          <p className="mt-1 text-sm text-ink-soft">
            Diferencia que todavía cuenta como pago exacto. $0.00 es lo honesto en SPEI: la
            transferencia llega exacta al centavo.
          </p>
        </div>
        <div>
          <Label htmlFor="policy-over">Qué significa un sobrante</Label>
          <Select value={treatment} onValueChange={(v) => setTreatment(v as "flag" | "credit")}>
            <SelectTrigger id="policy-over" className="mt-1" aria-label="Qué significa un sobrante">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="flag">Devolver al cliente</SelectItem>
              <SelectItem value="credit">Queda a favor del cliente</SelectItem>
            </SelectContent>
          </Select>
          {overridden && (
            <p className="mt-1 text-sm text-ink-soft">
              Tu integración con WispHub abona el sobrante al cliente por sí sola, así que hoy el
              tratamiento efectivo es «queda a favor del cliente».
            </p>
          )}
        </div>
      </div>
      {!valid && (
        <p className="text-sm font-medium text-error">
          La tolerancia debe ser un monto entre $0.00 y $100.00.
        </p>
      )}
      {/* feedback-vocabulary-rollout D1/D4: an action the operator started is
          announced at the control they used. Disabled plus a changed word is
          not a signal — it is silent to a screen reader and easy to miss. */}
      <Pending active={save.isPending} label="Guardando la política.">
        <Button size="compact"
          disabled={!valid || save.isPending}
          onClick={() => save.mutate({ toleranceCents: tolCents!, overTreatment: treatment })}
        >
          {save.isPending ? "Guardando…" : "Guardar política"}
        </Button>
      </Pending>
      {save.isSuccess && !save.isPending && (
        <p role="status" className="text-sm font-medium text-success">
          Guardado.
        </p>
      )}
    </SectionCard>
  );
}

/* D5/D6: where the day starts, and how a time reads */
function DisplayCard({ settings }: { settings: SettingsResponse }) {
  const save = useSaveSettings();
  const [timezone, setTimezone] = useState<string>(settings.timezone);
  const [timeFormat, setTimeFormat] = useState<string>(settings.timeFormat);

  useEffect(() => {
    setTimezone(settings.timezone);
    setTimeFormat(settings.timeFormat);
  }, [settings.timezone, settings.timeFormat]);

  const changed = timezone !== settings.timezone || timeFormat !== settings.timeFormat;

  return (
    <SectionCard title="Zona horaria y hora" id="zona">
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="timezone">Zona horaria</Label>
          <Select value={timezone} onValueChange={setTimezone}>
            <SelectTrigger id="timezone" className="mt-1" aria-label="Zona horaria">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TIMEZONES.map((tz) => (
                <SelectItem key={tz.value} value={tz.value}>
                  {tz.label} · {tz.utc}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="mt-1 text-sm text-ink-soft">
            Decide dónde empieza tu día: los totales de hoy y las fechas de los movimientos.
          </p>
        </div>

        <div>
          <Label htmlFor="time-format">Formato de hora</Label>
          <Select value={timeFormat} onValueChange={setTimeFormat}>
            <SelectTrigger id="time-format" className="mt-1" aria-label="Formato de hora">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="12h">12 horas</SelectItem>
              <SelectItem value="24h">24 horas</SelectItem>
            </SelectContent>
          </Select>
          <p className="mt-1 text-sm text-ink-soft">
            Así se verá: {formatTime(SAMPLE_TIME_MS, timeFormat === "24h" ? "24h" : "12h", timezone)}
          </p>
        </div>
      </div>

      {/* feedback-vocabulary-rollout D1/D4: an action the operator started is
          announced at the control they used. Disabled plus a changed word is
          not a signal — it is silent to a screen reader and easy to miss. */}
      <Pending active={save.isPending} label="Guardando la zona y el formato.">
        <Button size="compact"
          disabled={!changed || save.isPending}
          onClick={() =>
            save.mutate({
              timezone: timezone as SettingsPatchRequest["timezone"],
              timeFormat: timeFormat as SettingsPatchRequest["timeFormat"],
            })
          }
        >
          {save.isPending ? "Guardando…" : "Guardar zona y formato"}
        </Button>
      </Pending>
    </SectionCard>
  );
}

/* D11: the old page's path is never deleted, only redirected — the CLABE
   banner, the wizard, Cobros and months of habit point at it. The hash
   decides which of the two pages it meant. */
export function BusinessSettingsRedirect() {
  const hash = useRouterState({ select: (s) => s.location.hash });
  const to = hash === "zona" ? "/settings/preferences" : "/settings/direct-payment";
  return <Navigate to={to} hash={hash === "" ? undefined : hash} replace />;
}

/* The role gate both pages share: a role without the area does not see
   the page — back to the hub, hidden not disabled (business-and-
   memberships D3 / account-hub D5). */
function useBusinessSettings() {
  const { data: actor } = useSession();
  const role: Role = actor?.role ?? "viewer";
  const canSettings = roleCan(role, "settings", "update");
  const query = useQuery<SettingsResponse, ApiError>({
    queryKey: ["settings"],
    queryFn: () => api<SettingsResponse>("/settings"),
    enabled: canSettings,
  });
  return { actor, role, canSettings, ...query };
}

function CardsSkeleton({ count }: { count: number }) {
  return (
    <div className="mt-4 space-y-4">
      {Array.from({ length: count }, (_, k) => (
        <Card key={k} className="space-y-3 p-6">
          <Skeleton className="h-5 w-48" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-40" />
        </Card>
      ))}
    </div>
  );
}

export function DirectPaymentSettingsScreen() {
  const { actor, role, canSettings, data, isPending } = useBusinessSettings();
  const canClabe = roleCan(role, "clabe", "update");
  if (actor && !canSettings) return <Navigate to="/settings" replace />;

  return (
    <SubPage title="Pago directo y conciliación">
      {/* feedback-vocabulary-rollout D1/D5/D7: the region owns the wait. The shape
          holds the space while the threshold runs; `isPending` is the first
          load, never a refetch the operator did not start. */}
      <Pending
        active={isPending}
        label="Cargando la configuración de pago directo"
        shape={<CardsSkeleton count={2} />}
      >
        {data && (
          <div className="mt-4 space-y-4">
            <SpeiCard settings={data} canEditClabe={canClabe} />
            <ReferenceCard settings={data} />
            <PolicyCard settings={data} />
          </div>
        )}
      </Pending>
    </SubPage>
  );
}

export function PreferencesScreen() {
  const { actor, canSettings, data, isPending } = useBusinessSettings();
  if (actor && !canSettings) return <Navigate to="/settings" replace />;

  return (
    <SubPage title="Preferencias">
      {/* feedback-vocabulary-rollout D1/D5/D7: the region owns the wait. The shape
          holds the space while the threshold runs; `isPending` is the first
          load, never a refetch the operator did not start. */}
      <Pending active={isPending} label="Cargando tus preferencias" shape={<CardsSkeleton count={1} />}>
        {data && (
          <div className="mt-4 space-y-4">
            <DisplayCard settings={data} />
          </div>
        )}
      </Pending>
    </SubPage>
  );
}
