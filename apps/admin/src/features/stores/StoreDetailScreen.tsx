import { useState } from "react";
import { useParams } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, Mail, Pause, Play } from "lucide-react";
import { Alert, Amount, Card, CardContent, CardHeader, CardTitle, Skeleton, StatusBadge, formatMoney, parseMoney } from "@devolada/ui";
import type { StoreItem } from "@devolada/api/stores-schema";
import type { LedgerResponse } from "@devolada/api/ledger-schema";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api, ApiError } from "@/lib/api";

/* Store detail (US-A03): config, the emergency switch, the invitation,
   and the store's ledger — the same truth the shopkeeper sees. */

const timeFormat = new Intl.DateTimeFormat("es-MX", {
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});

export function StoreDetailScreen() {
  const { storeId } = useParams({ strict: false }) as { storeId: string };
  const queryClient = useQueryClient();
  const [notice, setNotice] = useState<string | null>(null);
  const [commissionText, setCommissionText] = useState<string | null>(null);
  const [capText, setCapText] = useState<string | null>(null);

  const store = useQuery<StoreItem, ApiError>({
    queryKey: ["store", storeId],
    queryFn: () => api<StoreItem>(`/stores/${storeId}`),
  });
  const ledger = useQuery<LedgerResponse, ApiError>({
    queryKey: ["store-ledger", storeId],
    queryFn: () => api<LedgerResponse>(`/stores/${storeId}/ledger`),
  });

  const patch = useMutation<StoreItem, ApiError, Record<string, unknown>>({
    mutationFn: (body) =>
      api<StoreItem>(`/stores/${storeId}`, { method: "PATCH", body: JSON.stringify(body) }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["store", storeId] });
      void queryClient.invalidateQueries({ queryKey: ["stores"] });
      setNotice("Cambios guardados.");
    },
  });

  const resend = useMutation<{ invitationLink: string }, ApiError>({
    mutationFn: () => api(`/stores/${storeId}/resend-invitation`, { method: "POST" }),
    onSuccess: (d) => {
      void navigator.clipboard.writeText(d.invitationLink);
      setNotice("Invitación nueva copiada al portapapeles.");
    },
  });

  if (store.isPending || !store.data) {
    return (
      <main className="space-y-4 px-4 pt-4 lg:px-8 lg:pt-8">
        <Skeleton className="h-7 w-56" />
        <Skeleton className="h-4 w-72" />
        <div className="grid gap-4 lg:grid-cols-2">
          <Skeleton className="h-56" />
          <Skeleton className="h-56" />
        </div>
      </main>
    );
  }

  const s = store.data;
  const suspended = s.status === "suspended";

  function saveConfig(e: React.FormEvent) {
    e.preventDefault();
    setNotice(null);
    const body: Record<string, unknown> = {};
    if (commissionText !== null) {
      body.commissionCents = commissionText.trim() === "" ? null : parseMoney(commissionText);
      if (body.commissionCents === null && commissionText.trim() !== "") return;
    }
    if (capText !== null) {
      const cap = parseMoney(capText);
      if (!cap) return;
      body.balanceCapCents = cap;
    }
    if (Object.keys(body).length) patch.mutate(body);
  }

  return (
    <main className="space-y-4 px-4 pt-4 lg:px-8 lg:pt-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">{s.name}</h1>
          <p className="text-sm text-muted-foreground">
            {s.contactName} · {s.zone ?? "Sin zona"} · {s.phone}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <StatusBadge status={s.status === "invited" ? "invited" : s.status} />
          <Amount cents={s.balanceCents} className="text-lg font-semibold" />
        </div>
      </div>

      {s.cap.approaching && (
        <Alert variant="warning">
          {s.cap.blocked
            ? "Esta tienda llegó a su techo de saldo: sus cobros están bloqueados hasta que entregue."
            : "Esta tienda se acerca a su techo de saldo."}
        </Alert>
      )}
      {notice && <Alert variant="success">{notice}</Alert>}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Configuración</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={saveConfig} className="space-y-4" noValidate>
              <div>
                <Label htmlFor="commission">Comisión por cobro (pesos)</Label>
                <Input
                  id="commission"
                  inputMode="decimal"
                  placeholder="Hereda la base del ISP"
                  value={commissionText ?? (s.commissionCents !== null ? (s.commissionCents / 100).toFixed(2) : "")}
                  onChange={(e) => setCommissionText(e.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="cap">Techo de saldo (pesos)</Label>
                <Input
                  id="cap"
                  inputMode="decimal"
                  value={capText ?? (s.cap.capCents / 100).toFixed(2)}
                  onChange={(e) => setCapText(e.target.value)}
                />
              </div>
              <Button type="submit" disabled={patch.isPending}>
                Guardar cambios
              </Button>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Acciones</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {/* D6: the emergency switch */}
            <Button
              variant={suspended ? "default" : "destructive"}
              className="w-full justify-start"
              onClick={() => patch.mutate({ status: suspended ? "active" : "suspended" })}
              disabled={patch.isPending}
            >
              {suspended ? <Play className="size-4" aria-hidden /> : <Pause className="size-4" aria-hidden />}
              {suspended ? "Reactivar tienda" : "Suspender tienda"}
            </Button>
            {s.invitationStatus === "sent" && (
              <Button
                variant="outline"
                className="w-full justify-start"
                onClick={() => resend.mutate()}
                disabled={resend.isPending}
              >
                <Mail className="size-4" aria-hidden />
                Reenviar invitación
              </Button>
            )}
            {resend.data && (
              <p className="flex items-start gap-2 break-all rounded-md border border-border bg-muted p-3 font-mono text-xs">
                <Copy className="mt-0.5 size-3 shrink-0" aria-hidden />
                {resend.data.invitationLink}
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Movimientos</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {ledger.data?.entries.length === 0 && (
            <p className="p-6 pt-0 text-sm text-muted-foreground">Sin movimientos todavía.</p>
          )}
          <ul className="divide-y divide-line-soft">
            {ledger.data?.entries.map((entry) => (
              <li key={entry.id} className="flex items-baseline justify-between gap-4 px-6 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">
                    {entry.type === "commission"
                      ? "Comisión"
                      : entry.type === "cash_drop"
                        ? "Entrega"
                        : entry.reference
                          ? `Cobro · ${entry.reference.customerName}`
                          : "Cobro"}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {timeFormat.format(new Date(entry.createdAt))}
                    {entry.reference && <span className="font-mono"> · {entry.reference.folio}</span>}
                  </p>
                </div>
                <span className="shrink-0 text-sm font-semibold tabular-nums">
                  {formatMoney(entry.cents, { sign: true })}
                </span>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </main>
  );
}
