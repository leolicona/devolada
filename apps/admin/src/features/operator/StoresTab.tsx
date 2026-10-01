import { Alert, Amount, Button, Card, Input, Pending, Skeleton, StatusBadge, formatMoney, parseMoney, type Status } from "@devolada/ui";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, MessageCircle, Plus, TriangleAlert } from "lucide-react";
import type {
  CorrectionRequest,
  CreateStoreRequest,
  CreateStoreResponse,
  PatchStoreRequest,
  PlatformLedgerResponse,
  StoreInvitation,
  StoreRow,
  StoresListResponse,
} from "@devolada/api/platform-schema";
import { nationalPhone } from "@devolada/api/phone";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { api, ApiError } from "@/lib/api";
import { formatTime } from "@/lib/datetime";
import { useDisplaySettings } from "../auth/session";

/* cash-at-stores US2 — the Tiendas tab of /operador (FR-001–FR-005, D4,
   D21): every store with its shopkeeper, its status as icon + text and the
   businesses it collects for; create and edit at the panel's compact size;
   the invitation shown once; suspend and reactivate behind a confirmation;
   and a store's cash book per business, with *Registrar corrección*. */

const STATUS: Record<StoreRow["status"], Status> = {
  invited: "invited",
  active: "storeActive",
  suspended: "storeSuspended",
};

const PHONE_SHOWN = (phone: string) => `${phone.slice(0, 2)} ${phone.slice(2, 6)} ${phone.slice(6)}`;

type Draft = { name: string; address: string; shopkeeperName: string; phone: string };

/* The API's rules, named before the request leaves (platform-schema) */
function problemsOf(d: Draft): Partial<Record<keyof Draft, string>> {
  return {
    ...(d.name.trim().length < 2 || d.name.trim().length > 80 ? { name: "Escribe el nombre de la tienda (2 a 80 letras)." } : {}),
    ...(d.address.trim().length < 5 || d.address.trim().length > 200 ? { address: "Escribe la dirección (5 a 200 letras)." } : {}),
    ...(d.shopkeeperName.trim().length < 2 || d.shopkeeperName.trim().length > 80
      ? { shopkeeperName: "Escribe el nombre del tendero (2 a 80 letras)." }
      : {}),
    ...(nationalPhone(d.phone) ? {} : { phone: "Escribe los 10 dígitos del celular." }),
  };
}

const ERRORS: Record<string, string> = {
  PHONE_TAKEN: "Otra tienda ya usa ese celular.",
  VALIDATION_ERROR: "Revisa los datos de la tienda.",
};

function StoreForm({
  initial,
  submitLabel,
  busy,
  error,
  onSubmit,
}: {
  initial: Draft;
  submitLabel: string;
  busy: boolean;
  error: string | null;
  onSubmit: (d: Draft) => void;
}) {
  const [draft, setDraft] = useState(initial);
  const [touched, setTouched] = useState(false);
  const problems = problemsOf(draft);
  const field = (key: keyof Draft, label: string, props: { inputMode?: "tel"; autoComplete?: string } = {}) => (
    <div>
      <Label htmlFor={`store-${key}`}>{label}</Label>
      <Input
        size="compact"
        id={`store-${key}`}
        className="mt-1"
        value={draft[key]}
        onChange={(e) => setDraft({ ...draft, [key]: e.target.value })}
        aria-invalid={touched && problems[key] ? true : undefined}
        aria-describedby={touched && problems[key] ? `store-${key}-error` : undefined}
        {...props}
      />
      {touched && problems[key] && (
        <p id={`store-${key}-error`} className="mt-1 text-sm font-medium text-error">
          {problems[key]}
        </p>
      )}
    </div>
  );
  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        setTouched(true);
        if (Object.keys(problems).length === 0) onSubmit(draft);
      }}
    >
      {field("name", "Nombre de la tienda")}
      {field("address", "Dirección")}
      {field("shopkeeperName", "Nombre del tendero")}
      {field("phone", "Celular del tendero", { inputMode: "tel", autoComplete: "off" })}
      {error && (
        <p role="alert" className="text-sm font-medium text-error">
          {error}
        </p>
      )}
      <Pending active={busy} label="Guardando la tienda">
        <Button size="compact" type="submit" disabled={busy}>
          {submitLabel}
        </Button>
      </Pending>
    </form>
  );
}

/* D4: the plaintext link, here once — copied or opened in WhatsApp */
export function InvitationPanel({ invitation }: { invitation: StoreInvitation }) {
  const [copied, setCopied] = useState(false);
  /* constitution VIII: RED_BASE_URL unset points the link at a developer's
     machine; say so before anyone sends it to a store */
  const local = /^https?:\/\/(localhost|127\.0\.0\.1)/.test(invitation.url);
  return (
    <div className="space-y-3 rounded-md border border-line p-4" aria-label="Invitación">
      <p className="text-sm font-medium">Invitación para el tendero</p>
      <p className="text-sm text-ink-soft">
        Se muestra solo esta vez. Vence en 7 días. Si se pierde, reenvíala desde la lista.
      </p>
      <Input size="compact" readOnly aria-label="Enlace de la invitación" className="font-mono text-sm" value={invitation.url} />
      {local && (
        <Alert variant="warning" layout="icon">
          <TriangleAlert aria-hidden />
          Este enlace apunta a un equipo local, no a la app de tiendas. No lo envíes a una tienda.
        </Alert>
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          size="compact"
          variant="secondary"
          onClick={async () => {
            await navigator.clipboard.writeText(invitation.url).catch(() => undefined);
            setCopied(true);
          }}
        >
          <Copy className="size-4" aria-hidden />
          {copied ? "Copiado" : "Copiar"}
        </Button>
        <a
          href={invitation.waLink}
          target="_blank"
          rel="noreferrer"
          className="inline-flex h-10 items-center gap-2 rounded-md bg-accent px-5 text-sm font-medium text-ink-inverse"
        >
          <MessageCircle className="size-4" aria-hidden />
          Enviar por WhatsApp
        </a>
      </div>
    </div>
  );
}

function CreateStore() {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [invitation, setInvitation] = useState<StoreInvitation | null>(null);
  const create = useMutation<CreateStoreResponse, ApiError, CreateStoreRequest>({
    mutationFn: (body) => api<CreateStoreResponse>("/platform/stores", { method: "POST", body: JSON.stringify(body) }),
    onSuccess: (data) => {
      setInvitation(data.invitation);
      void queryClient.invalidateQueries({ queryKey: ["platform-stores"] });
    },
  });
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) {
          setInvitation(null);
          create.reset();
        }
      }}
    >
      <DialogTrigger asChild>
        <Button size="compact">
          <Plus className="size-4" aria-hidden />
          Nueva tienda
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogTitle>{invitation ? "Tienda creada" : "Nueva tienda"}</DialogTitle>
        <DialogDescription>
          {invitation
            ? "La tienda queda como Invitada hasta que el tendero acepte."
            : "El celular del tendero es su usuario para entrar."}
        </DialogDescription>
        {invitation ? (
          <InvitationPanel invitation={invitation} />
        ) : (
          <StoreForm
            initial={{ name: "", address: "", shopkeeperName: "", phone: "" }}
            submitLabel="Crear e invitar"
            busy={create.isPending}
            error={create.error ? (ERRORS[create.error.code] ?? "No se pudo crear la tienda.") : null}
            onSubmit={(d) => create.mutate({ ...d, phone: nationalPhone(d.phone) ?? d.phone })}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function EditStore({ store }: { store: StoreRow }) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const edit = useMutation<StoreRow, ApiError, PatchStoreRequest>({
    mutationFn: (body) => api<StoreRow>(`/platform/stores/${store.id}`, { method: "PATCH", body: JSON.stringify(body) }),
    onSuccess: () => {
      setOpen(false);
      void queryClient.invalidateQueries({ queryKey: ["platform-stores"] });
    },
  });
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="compact" variant="secondary">
          Editar
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogTitle>Editar {store.name}</DialogTitle>
        <DialogDescription>Si cambias el celular, el tendero entra con el nuevo.</DialogDescription>
        <StoreForm
          initial={{ name: store.name, address: store.address, shopkeeperName: store.shopkeeperName, phone: store.phone }}
          submitLabel="Guardar cambios"
          busy={edit.isPending}
          error={edit.error ? (ERRORS[edit.error.code] ?? "No se pudo guardar.") : null}
          onSubmit={(d) => edit.mutate({ ...d, phone: nationalPhone(d.phone) ?? d.phone })}
        />
      </DialogContent>
    </Dialog>
  );
}

function StatusAction({ store }: { store: StoreRow }) {
  const queryClient = useQueryClient();
  const suspending = store.status !== "suspended";
  const change = useMutation<StoreRow, ApiError>({
    mutationFn: () =>
      api<StoreRow>(`/platform/stores/${store.id}`, {
        method: "PATCH",
        body: JSON.stringify({ status: suspending ? "suspended" : "active" }),
      }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["platform-stores"] }),
  });
  return (
    <Pending active={change.isPending} label={suspending ? "Suspendiendo la tienda" : "Reactivando la tienda"}>
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button size="compact" variant={suspending ? "destructive" : "secondary"} disabled={change.isPending}>
            {suspending ? "Suspender" : "Reactivar"}
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogTitle>{suspending ? `¿Suspender ${store.name}?` : `¿Reactivar ${store.name}?`}</AlertDialogTitle>
          <AlertDialogDescription>
            {suspending
              ? "El tendero no podrá entrar ni cobrar desde su siguiente acción. Su historial y el efectivo que tiene siguen a la vista."
              : "La tienda vuelve a poder entrar y cobrar. Si nunca aceptó su invitación, vuelve a quedar como Invitada y su invitación vale mientras no venza."}
          </AlertDialogDescription>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={() => change.mutate()}>{suspending ? "Suspender" : "Reactivar"}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Pending>
  );
}

function Resend({ store }: { store: StoreRow }) {
  const [invitation, setInvitation] = useState<StoreInvitation | null>(null);
  const resend = useMutation<{ invitation: StoreInvitation }, ApiError>({
    mutationFn: () => api(`/platform/stores/${store.id}/invitation`, { method: "POST" }),
    onSuccess: (data) => setInvitation(data.invitation),
  });
  return (
    <Dialog open={invitation !== null} onOpenChange={(next) => !next && setInvitation(null)}>
      <Pending active={resend.isPending} label="Generando la invitación">
        <Button size="compact" variant="secondary" disabled={resend.isPending} onClick={() => resend.mutate()}>
          Reenviar invitación
        </Button>
      </Pending>
      <DialogContent>
        <DialogTitle>Invitación nueva</DialogTitle>
        <DialogDescription>La invitación anterior dejó de funcionar.</DialogDescription>
        {invitation && <InvitationPanel invitation={invitation} />}
      </DialogContent>
    </Dialog>
  );
}

/* D21 (FR-030): a store's cash book for one business, and a correction
   linked to one of its payments — never an undo */
function CashBook({ store, businessId, businessName }: { store: StoreRow; businessId: string; businessName: string }) {
  const queryClient = useQueryClient();
  const { timezone, timeFormat } = useDisplaySettings();
  const ledger = useQuery<PlatformLedgerResponse, ApiError>({
    queryKey: ["platform-store-ledger", store.id, businessId],
    queryFn: () => api(`/platform/stores/${store.id}/ledger/${businessId}`),
  });
  const payments = (ledger.data?.rows ?? []).filter((r) => r.kind === "collection" && r.paymentId);
  const [paymentId, setPaymentId] = useState("");
  const [sign, setSign] = useState<"-" | "+">("-");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const correct = useMutation<unknown, ApiError, CorrectionRequest>({
    mutationFn: (body) =>
      api(`/platform/stores/${store.id}/ledger/${businessId}/corrections`, { method: "POST", body: JSON.stringify(body) }),
    onSuccess: () => {
      setAmount("");
      setReason("");
      void queryClient.invalidateQueries({ queryKey: ["platform-store-ledger", store.id, businessId] });
      void queryClient.invalidateQueries({ queryKey: ["platform-stores"] });
    },
  });
  const cents = parseMoney(amount);
  const reasonOk = reason.trim().length >= 3 && reason.trim().length <= 280;
  const valid = Boolean(paymentId) && cents !== null && cents > 0 && reasonOk;
  const selectId = `correction-payment-${store.id}-${businessId}`;

  return (
    <div className="space-y-3 rounded-md border border-line p-4">
      <p className="text-sm font-medium">
        Caja de {store.name} con {businessName}
        {ledger.data && (
          <span className="ml-2 font-semibold">
            · tiene <Amount cents={ledger.data.heldCents} />
          </span>
        )}
      </p>
      <Pending active={ledger.isPending} label="Cargando la caja" shape={<Skeleton className="h-16 w-full" />}>
        {ledger.error ? (
          <Alert variant="destructive">No pudimos cargar la caja.</Alert>
        ) : (
          <ul className="divide-y divide-line-soft text-sm" aria-label="Movimientos de la caja">
            {ledger.data?.rows.length === 0 && <li className="py-2 text-ink-soft">Sin movimientos.</li>}
            {ledger.data?.rows.map((r) => (
              <li key={r.id} className="flex items-baseline gap-3 py-2">
                <span className="min-w-0 flex-1">
                  {r.kind === "collection" ? "Cobro" : r.kind === "handover" ? "Entrega" : "Corrección"}
                  {r.folio && <span className="ml-2 font-mono text-ink-soft">{r.folio}</span>}
                  {r.customerName && <span className="ml-2 text-ink-soft">· {r.customerName}</span>}
                  {r.reason && <span className="block text-ink-soft">{r.reason}{r.authorEmail ? ` — ${r.authorEmail}` : ""}</span>}
                </span>
                <span className="shrink-0 text-ink-soft">{formatTime(r.at, timeFormat, timezone)}</span>
                <span className="shrink-0 font-medium tabular-nums">
                  {r.cents > 0 ? "+" : "−"}
                  {formatMoney(Math.abs(r.cents))}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Pending>

      {payments.length > 0 && (
        <div className="space-y-2 border-t border-line-soft pt-3">
          <p className="text-sm font-medium">Registrar corrección</p>
          <div>
            <Label htmlFor={selectId}>Pago al que se refiere</Label>
            <select
              id={selectId}
              className="mt-1 block h-10 w-full rounded-md border border-line-input bg-card px-3 text-sm"
              value={paymentId}
              onChange={(e) => setPaymentId(e.target.value)}
            >
              <option value="">Elige el pago</option>
              {payments.map((p) => (
                <option key={p.paymentId} value={p.paymentId!}>
                  {p.folio} · {p.customerName} · {formatMoney(p.cents)}
                </option>
              ))}
            </select>
          </div>
          <div className="flex gap-2">
            <select
              aria-label="Signo de la corrección"
              className="h-10 w-20 rounded-md border border-line-input bg-card px-3 text-sm"
              value={sign}
              onChange={(e) => setSign(e.target.value as "-" | "+")}
            >
              <option value="-">−</option>
              <option value="+">+</option>
            </select>
            <Input size="compact" aria-label="Monto de la corrección" prefix="$" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </div>
          <Label htmlFor={`${selectId}-reason`}>Motivo (de 3 a 280 letras)</Label>
          <Textarea id={`${selectId}-reason`} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Qué pasó, para quien lo lea después" />
          {reason.length > 0 && !reasonOk && <p className="text-sm font-medium text-error">El motivo debe tener de 3 a 280 letras.</p>}
          {correct.error && <p className="text-sm font-medium text-error">No se guardó la corrección.</p>}
          <Pending active={correct.isPending} label="Registrando la corrección">
            <Button
              size="compact"
              disabled={!valid || correct.isPending}
              onClick={() => cents !== null && correct.mutate({ paymentId, cents: (sign === "-" ? -1 : 1) * cents, reason: reason.trim() })}
            >
              Registrar corrección
            </Button>
          </Pending>
          <p className="text-xs text-ink-soft">
            La corrección no borra el pago. Devolver la tarifa de Devolada es un ajuste de saldo en Negocios.
          </p>
        </div>
      )}
    </div>
  );
}

function StoreItem({ store }: { store: StoreRow }) {
  const [book, setBook] = useState<string | null>(null);
  return (
    <li className="space-y-3 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold">{store.name}</p>
          <p className="text-sm text-ink-soft">{store.address}</p>
          <p className="text-sm text-ink-soft">
            {store.shopkeeperName} · <span className="font-mono">{PHONE_SHOWN(store.phone)}</span>
          </p>
        </div>
        <StatusBadge status={STATUS[store.status]} />
      </div>
      {store.collectsFor.length > 0 && (
        <ul className="flex flex-wrap gap-2 text-sm" aria-label={`Negocios de ${store.name}`}>
          {store.collectsFor.map((b) => (
            <li key={b.businessId}>
              <Button size="compact" variant="ghost" aria-pressed={book === b.businessId} onClick={() => setBook(book === b.businessId ? null : b.businessId)}>
                {b.businessName} · tiene {formatMoney(b.heldCents)}
              </Button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap gap-2">
        <EditStore store={store} />
        {store.status === "invited" && <Resend store={store} />}
        <StatusAction store={store} />
      </div>
      {book && (
        <CashBook
          store={store}
          businessId={book}
          businessName={store.collectsFor.find((b) => b.businessId === book)?.businessName ?? ""}
        />
      )}
    </li>
  );
}

export function StoresTab() {
  const list = useQuery<StoresListResponse, ApiError>({
    queryKey: ["platform-stores"],
    queryFn: () => api<StoresListResponse>("/platform/stores"),
  });
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <p className="text-sm text-ink-soft">
          Las tiendas cobran en efectivo para el negocio con <span className="font-medium text-ink">Efectivo en tiendas</span>.
        </p>
        <CreateStore />
      </div>
      {list.error && <Alert variant="destructive">No pudimos cargar las tiendas.</Alert>}
      <Pending active={list.isPending} label="Cargando las tiendas" shape={<Skeleton className="h-24 w-full" />}>
        {list.data && (
          <Card className="p-0">
            <ul className="divide-y divide-line-soft" aria-label="Tiendas">
              {list.data.stores.length === 0 && <li className="p-4 text-sm text-ink-soft">Todavía no hay tiendas.</li>}
              {list.data.stores.map((s) => (
                <StoreItem key={s.id} store={s} />
              ))}
            </ul>
          </Card>
        )}
      </Pending>
    </div>
  );
}
