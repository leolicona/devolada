import { Alert, Amount, Button, Card, Input, ListError, parseMoney, Pending, Skeleton } from "@devolada/ui";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Copy } from "lucide-react";
import { BANKS } from "@devolada/api/settings-schema";
import type { Bank } from "@devolada/api/settings-schema";
import type { CreditEntriesResponse, CreditResponse, TopUpItem, TopUpsResponse } from "@devolada/api/credit-schema";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { api, ApiError } from "@/lib/api";
import { API_BASE } from "@/lib/base";
import { formatTime } from "@/lib/datetime";
import { cn } from "@/lib/utils";
import { useDisplaySettings } from "../auth/session";
import { STEP_COPY } from "./CreditChip";

/* Saldo y recargas (prepaid-credit spec, US-B04/B05) — the owner's page
   (D3 matrix): the balance with its step, the entry history (the book,
   append-only, signed), and "Recargar": the platform's account with copy
   buttons and the minimum, then the proof through the two doors the payer
   already has (D6). A top-up in flight shows its calm wait. */

export const ENTRY_LABELS: Record<CreditEntriesResponse["entries"][number]["kind"], string> = {
  welcome_bonus: "Bono de bienvenida",
  top_up: "Recarga",
  validation_fee: "Validación",
  fee_reversal: "Cobro revertido",
  adjustment: "Ajuste",
};

const POLL_MS = 5000;

function StepMark({ step }: { step: keyof typeof STEP_COPY }) {
  const { label, icon: Icon, tone } = STEP_COPY[step];
  return (
    <span className={cn("flex items-center gap-1 text-sm font-medium", tone)}>
      <Icon className="size-4 shrink-0" aria-hidden />
      {label}
    </span>
  );
}

function CopyButton({ value, label }: { value: string; label: string }) {
  const [done, setDone] = useState(false);
  return (
    <Button size="compact"
      variant="secondary"
      className="shrink-0"
      aria-label={`Copiar ${label}`}
      onClick={() => {
        void navigator.clipboard?.writeText(value).then(() => {
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        });
      }}
    >
      {done ? <Check className="size-4" aria-hidden /> : <Copy className="size-4" aria-hidden />}
    </Button>
  );
}

function TopUpForm({ credit, onDone }: { credit: CreditResponse; onDone: (t: TopUpItem) => void }) {
  const [door, setDoor] = useState<"transfer" | "receipt">("transfer");
  const [trackingKey, setTrackingKey] = useState("");
  const [bank, setBank] = useState<Bank | "">("");
  const [date, setDate] = useState("");
  const [amount, setAmount] = useState("");
  const [file, setFile] = useState<File | null>(null);

  const amountCents = parseMoney(amount);
  const belowMin = amountCents !== null && amountCents < credit.minTopUpCents;
  const transferValid =
    /^[A-Za-z0-9]{6,30}$/.test(trackingKey.trim()) && bank !== "" && /^\d{4}-\d{2}-\d{2}$/.test(date) && amountCents !== null && !belowMin;

  const submit = useMutation<TopUpItem, ApiError>({
    mutationFn: async () => {
      if (door === "receipt") {
        const form = new FormData();
        form.append("file", file!);
        const res = await fetch(`${API_BASE}/credit/top-ups/proof`, { method: "POST", credentials: "include", body: form });
        const json = (await res.json()) as { success: boolean; data: { proofId: string }; error?: { code?: string } };
        if (!res.ok || !json.success) throw new ApiError(json.error?.code ?? "UNKNOWN_ERROR", res.status);
        return api<TopUpItem>("/credit/top-ups", { method: "POST", body: JSON.stringify({ proofId: json.data.proofId }) });
      }
      return api<TopUpItem>("/credit/top-ups", {
        method: "POST",
        body: JSON.stringify({ transfer: { trackingKey: trackingKey.trim(), senderBank: bank, date, amountCents } }),
      });
    },
    onSuccess: onDone,
  });

  return (
    <form
      className="space-y-4"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        if (door === "transfer" ? transferValid : file !== null) submit.mutate();
      }}
    >
      <div className="flex gap-2" role="tablist" aria-label="Cómo comprobar">
        <Button size="compact" type="button" role="tab" aria-selected={door === "transfer"} variant={door === "transfer" ? "primary" : "secondary"} onClick={() => setDoor("transfer")}>
          Datos de la transferencia
        </Button>
        <Button size="compact" type="button" role="tab" aria-selected={door === "receipt"} variant={door === "receipt" ? "primary" : "secondary"} onClick={() => setDoor("receipt")}>
          Subir comprobante
        </Button>
      </div>

      {door === "transfer" ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Label htmlFor="topup-key">Clave de rastreo</Label>
            <Input size="compact" id="topup-key" className="mt-1 font-mono" value={trackingKey} onChange={(e) => setTrackingKey(e.target.value)} autoComplete="off" />
          </div>
          <div>
            <Label htmlFor="topup-bank">Banco desde el que transferiste</Label>
            <Select value={bank} onValueChange={(v) => setBank(v as Bank)}>
              <SelectTrigger id="topup-bank" className="mt-1" aria-label="Banco desde el que transferiste">
                <SelectValue placeholder="Elige tu banco" />
              </SelectTrigger>
              <SelectContent>
                {[...BANKS].sort((a, b) => a.localeCompare(b, "es")).map((b) => (
                  <SelectItem key={b} value={b}>
                    {b}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label htmlFor="topup-date">Fecha</Label>
            <Input size="compact" id="topup-date" type="date" className="mt-1" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="topup-amount">Monto transferido</Label>
            <Input size="compact" id="topup-amount" prefix="$" inputMode="decimal" className="mt-1" value={amount} onChange={(e) => setAmount(e.target.value)} />
            {belowMin && (
              <p className="mt-1 text-sm font-medium text-error">
                El mínimo es <Amount cents={credit.minTopUpCents} />.
              </p>
            )}
          </div>
        </div>
      ) : (
        <div>
          <Label htmlFor="topup-file">Comprobante (imagen o PDF, hasta 1 MB)</Label>
          <Input size="compact" id="topup-file" type="file" accept="image/jpeg,image/png,image/webp,application/pdf" className="mt-1" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        </div>
      )}

      {submit.error && (
        <Alert variant="destructive">
          {submit.error.code === "TRANSFER_ALREADY_USED"
            ? "Esa transferencia ya se usó para una recarga."
            : submit.error.code === "BELOW_MINIMUM"
              ? "El monto está por debajo del mínimo."
              : "No pudimos registrar la recarga. Intenta de nuevo."}
        </Alert>
      )}
      {/* feedback-vocabulary-rollout D1/D4: an action the operator started is
          announced at the control they used. Disabled plus a changed word is
          not a signal — it is silent to a screen reader and easy to miss. */}
      <Pending active={submit.isPending} label="Enviando tu recarga.">
        <Button size="compact" type="submit" disabled={submit.isPending || (door === "transfer" ? !transferValid : file === null)}>
          {submit.isPending ? "Validando…" : "Validar recarga"}
        </Button>
      </Pending>
    </form>
  );
}

function TopUpWait({ topUp }: { topUp: TopUpItem }) {
  const { timezone, timeFormat } = useDisplaySettings();
  return (
    <Alert variant="warning">
      Verificando tu recarga con Banxico.
      {topUp.nextValidationAt && (
        <> Volveremos a intentarlo alrededor de las {formatTime(topUp.nextValidationAt, timeFormat, timezone)}.</>
      )}
    </Alert>
  );
}

export function CreditCard() {
  const queryClient = useQueryClient();
  const credit = useQuery<CreditResponse, ApiError>({ queryKey: ["credit"], queryFn: () => api<CreditResponse>("/credit") });
  const entries = useQuery<CreditEntriesResponse, ApiError>({ queryKey: ["credit-entries"], queryFn: () => api<CreditEntriesResponse>("/credit/entries") });
  const topUps = useQuery<TopUpsResponse, ApiError>({
    queryKey: ["top-ups"],
    queryFn: () => api<TopUpsResponse>("/credit/top-ups"),
    refetchInterval: (q) => (q.state.data?.topUps.some((t) => t.status === "validating") ? POLL_MS : false),
  });
  const [recharging, setRecharging] = useState(false);
  const { timezone, timeFormat } = useDisplaySettings();

  const inFlight = topUps.data?.topUps.find((t) => t.status === "validating") ?? null;

  function refresh() {
    void queryClient.invalidateQueries({ queryKey: ["credit"] });
    void queryClient.invalidateQueries({ queryKey: ["credit-entries"] });
    void queryClient.invalidateQueries({ queryKey: ["top-ups"] });
    void queryClient.invalidateQueries({ queryKey: ["session"] });
  }

  return (
    <Card className="p-6">
      <h2 className="text-base font-semibold">Saldo y recargas</h2>
      {credit.error && (
        <ListError
          what="tu saldo"
          onRetry={() => void credit.refetch()}
          retrying={credit.isRefetching}
          className="mt-4"
        />
      )}
      {/* feedback-vocabulary-rollout D1/D5/D7: the region owns the wait. The shape
          holds the space while the threshold runs; `isPending` is the first
          load, never a refetch the operator did not start. */}
      <Pending
        active={credit.isPending}
        label="Cargando tu saldo"
        shape={
          <Skeleton className="mt-4 h-10 w-48" />
        }
      >
        {credit.data && (
          <div className="mt-4 space-y-4">
            <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
              <Amount cents={credit.data.balanceCents} className="text-3xl font-semibold" />
              {/* The step is one status with one representation: the same
                  label + icon the chip carries (prepaid-credit D7). It read
                  as colour + text here, which is the shape the FRONTEND law
                  exists to forbid. */}
              <StepMark step={credit.data.step} />
              <span className="text-sm text-ink-soft">
                Cada validación cuesta <Amount cents={credit.data.feeCents} />.
              </span>
            </div>

            {inFlight ? (
              <TopUpWait topUp={inFlight} />
            ) : recharging ? (
              credit.data.topUp ? (
                <div className="space-y-4 rounded-md border border-border bg-well p-4">
                  <p className="text-sm">
                    Transfiere lo que quieras (mínimo <Amount cents={credit.data.minTopUpCents} />) a la cuenta de Devolada y luego
                    compruébalo aquí.
                  </p>
                  <dl className="grid gap-2 text-sm">
                    <div className="flex items-center gap-2">
                      <dt className="w-24 text-ink-soft">CLABE</dt>
                      <dd className="font-mono">{credit.data.topUp.clabe}</dd>
                      <CopyButton value={credit.data.topUp.clabe} label="CLABE" />
                    </div>
                    <div className="flex items-center gap-2">
                      <dt className="w-24 text-ink-soft">Banco</dt>
                      <dd>{credit.data.topUp.bank}</dd>
                    </div>
                    {credit.data.topUp.beneficiary && (
                      <div className="flex items-center gap-2">
                        <dt className="w-24 text-ink-soft">Beneficiario</dt>
                        <dd>{credit.data.topUp.beneficiary}</dd>
                      </div>
                    )}
                  </dl>
                  <TopUpForm
                    credit={credit.data}
                    onDone={(t) => {
                      setRecharging(false);
                      refresh();
                      if (t.status === "credited") setRecharging(false);
                    }}
                  />
                </div>
              ) : (
                <Alert variant="warning">Las recargas aún no están disponibles: la plataforma no ha configurado su cuenta.</Alert>
              )
            ) : (
              <Button size="compact" onClick={() => setRecharging(true)}>Recargar</Button>
            )}

            {entries.data && (
              <ul className="divide-y divide-line-soft" aria-label="Movimientos de saldo">
                {entries.data.entries.length === 0 && <li className="py-3 text-sm text-ink-soft">Aquí aparecerá cada validación y recarga.</li>}
                {entries.data.entries.map((e) => (
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
          </div>
        )}
      </Pending>
    </Card>
  );
}
