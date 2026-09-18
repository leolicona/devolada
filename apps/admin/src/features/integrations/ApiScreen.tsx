import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { AlertCircle, ArrowLeft, Check, Copy, FlaskConical, KeyRound, ShieldAlert, TriangleAlert, Webhook } from "lucide-react";
import { Alert, Button, Card, Input, ListError, Pending, Skeleton, StatusBadge } from "@devolada/ui";
import type {
  ApiCredential,
  ApiIntegrationResponse,
  IssueCredentialRequest,
  IssueCredentialResponse,
  RevokeCredentialResponse,
} from "@devolada/api/integrations-schema";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { api, ApiError } from "@/lib/api";
import { useSession } from "../auth/session";
import { formatDateTime } from "@/lib/datetime";

/* The API card's detail (automated-collections-api US1, FR-001, FR-003,
   FR-004): the business turns the API on by issuing a credential, sees
   it once, recognises it afterwards by its tail, and revokes it from
   here. Built from @devolada/ui atoms; every wait sits in <Pending>.

   FR-009: when Devolada's own transfer validation is unavailable in this
   environment, the screen says so as a platform notice — never worded
   as a setting the business must fix, because it has none. */

const QUERY_KEY = ["integrations", "api"];

function useApiIntegration() {
  return useQuery<ApiIntegrationResponse, ApiError>({
    queryKey: QUERY_KEY,
    queryFn: () => api<ApiIntegrationResponse>("/integrations/api"),
  });
}

/* The one moment the key exists on a screen (FR-003, research D11).
   Copy is the whole interaction: the person moves it into their own
   system now, or issues another later — it is never shown again. */
function IssuedKey({ issued, onDismiss }: { issued: IssueCredentialResponse; onDismiss: () => void }) {
  const [copyResult, setCopyResult] = useState<{ ok: boolean } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  const copy = async () => {
    let ok = true;
    try {
      await navigator.clipboard.writeText(issued.key);
    } catch {
      ok = false;
    }
    setCopyResult({ ok });
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopyResult(null), 2000);
  };

  return (
    <Card className="space-y-4 border-warning-line p-6" data-testid="issued-key">
      <div className="flex items-start gap-2">
        <ShieldAlert className="mt-0.5 size-5 shrink-0 text-warning" aria-hidden />
        <div>
          <h2 className="text-base font-semibold">Guarda esta llave ahora</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Es la única vez que la verás completa. Cópiala en tu sistema; después solo mostraremos
            sus últimos cuatro caracteres.
          </p>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <code
          className="min-w-0 flex-1 break-all rounded-md border border-border bg-well px-3 py-2 font-mono text-sm"
          aria-label="Llave de la API"
        >
          {issued.key}
        </code>
        <Button size="compact" variant="secondary" onClick={() => void copy()} aria-live="polite">
          {copyResult ? (
            copyResult.ok ? (
              <>
                <Check className="size-4" aria-hidden /> Copiada
              </>
            ) : (
              <>
                <AlertCircle className="size-4" aria-hidden /> No se copió
              </>
            )
          ) : (
            <>
              <Copy className="size-4" aria-hidden /> Copiar
            </>
          )}
        </Button>
      </div>
      <p className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
        <span>
          Nombre: <span className="font-medium text-foreground">{issued.credential.name}</span> · termina en{" "}
          <span className="font-mono text-foreground">{issued.credential.keyTail}</span>
        </span>
        {issued.credential.isTest && <TestModePill />}
      </p>
      {issued.credential.isTest && (
        <p className="text-sm text-muted-foreground">
          Con esta llave tu sistema ensaya el flujo completo sin mover dinero. Sus cobros no aparecen
          en tu panel ni cuestan validaciones.
        </p>
      )}
      <Button size="compact" variant="secondary" onClick={onDismiss}>
        Ya la guardé
      </Button>
    </Card>
  );
}

/* research D12: a test credential is visibly labelled wherever it
   appears — the moment it is issued and every time it is listed — so
   nobody confuses the two. Icon + text, never colour alone. */
function TestModePill() {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-xs font-medium text-muted-foreground">
      <FlaskConical className="size-3" aria-hidden />
      Modo prueba
    </span>
  );
}

function IssueCard({ onIssued }: { onIssued: (issued: IssueCredentialResponse) => void }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  /* automated-collections-api FR-034 / research D12: test mode is a
     property of the credential, chosen when it is issued. Sent only
     when on — a real credential is the default and names nothing. */
  const [isTest, setIsTest] = useState(false);
  const issue = useMutation<IssueCredentialResponse, ApiError, IssueCredentialRequest>({
    mutationFn: (body) =>
      api<IssueCredentialResponse>("/integrations/api/credentials", { method: "POST", body: JSON.stringify(body) }),
    onSuccess: (issued) => {
      setName("");
      setIsTest(false);
      onIssued(issued);
      void queryClient.invalidateQueries({ queryKey: QUERY_KEY });
      /* the catalog card counts live credentials */
      void queryClient.invalidateQueries({ queryKey: ["integrations"] });
    },
  });
  const valid = name.trim().length > 0;

  return (
    <Card className="p-6">
      <h2 className="text-base font-semibold">Nueva llave</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Tu sistema se identifica con ella para crear links de pago y consultar tus cobros. Ponle el
        nombre del sistema que la usará.
      </p>
      <form
        className="mt-4 flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (valid && !issue.isPending) issue.mutate({ name: name.trim(), ...(isTest ? { isTest: true } : {}) });
        }}
      >
        <div className="min-w-0 flex-1">
          <Label htmlFor="credential-name">Nombre</Label>
          <Input
            size="compact"
            id="credential-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Sistema de facturación"
            autoComplete="off"
            maxLength={60}
          />
        </div>
        {/* feedback-vocabulary-rollout D1/D4: the wait is announced at
            the control that started it */}
        <Pending active={issue.isPending} label="Creando la llave.">
          <Button size="compact" type="submit" disabled={!valid || issue.isPending}>
            <KeyRound className="size-4" aria-hidden />
            {issue.isPending ? "Creando…" : "Crear llave"}
          </Button>
        </Pending>
      </form>
      <div className="mt-4 flex items-start justify-between gap-4 rounded-md border border-line-soft bg-well px-4 py-3">
        <div className="min-w-0">
          <Label htmlFor="credential-test-mode" className="flex items-center gap-2">
            <FlaskConical className="size-4 text-muted-foreground" aria-hidden />
            Modo prueba
          </Label>
          <p className="mt-1 text-sm text-muted-foreground">
            Una llave de prueba recorre todo el flujo sin mover dinero: tu sistema crea links, avanza
            cada cobro al resultado que quiera ensayar y recibe el webhook. Nada de eso aparece en tu
            panel ni cuesta validaciones.
          </p>
        </div>
        <Switch id="credential-test-mode" checked={isTest} disabled={issue.isPending} onCheckedChange={setIsTest} />
      </div>
      {issue.error && (
        <p role="alert" className="mt-3 flex items-start gap-2 text-sm font-medium text-error">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
          No pudimos crear la llave. Intenta de nuevo.
        </p>
      )}
    </Card>
  );
}

/* Revocation is immediate and cannot be undone (FR-004), so it asks
   once, inline — the row itself becomes the question. */
function CredentialRow({ credential, timezone, timeFormat }: { credential: ApiCredential; timezone: string; timeFormat: "12h" | "24h" }) {
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const revoke = useMutation<RevokeCredentialResponse, ApiError, string>({
    mutationFn: (id) =>
      api<RevokeCredentialResponse>(`/integrations/api/credentials/${id}/revoke`, { method: "POST" }),
    onSuccess: () => {
      setConfirming(false);
      void queryClient.invalidateQueries({ queryKey: QUERY_KEY });
      void queryClient.invalidateQueries({ queryKey: ["integrations"] });
    },
  });
  const live = credential.revokedAt === null;
  const when = (ms: number) => formatDateTime(ms, timeFormat, timezone);

  return (
    <li className="space-y-3 p-4">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
            <span>{credential.name}</span>
            <span className="font-mono text-muted-foreground">••••{credential.keyTail}</span>
            {credential.isTest && <TestModePill />}
          </p>
          <p className="text-sm text-muted-foreground">
            Creada {when(credential.createdAt)}
            {credential.lastUsedAt !== null ? ` · usada por última vez ${when(credential.lastUsedAt)}` : " · sin usar todavía"}
            {credential.revokedAt !== null ? ` · revocada ${when(credential.revokedAt)}` : ""}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <StatusBadge status={live ? "credentialActive" : "credentialRevoked"} />
          {live && !confirming && (
            <Button size="compact" variant="secondary" onClick={() => setConfirming(true)}>
              Revocar
            </Button>
          )}
        </div>
      </div>
      {live && confirming && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-warning-line bg-warning-soft px-4 py-3 text-sm">
          <span className="font-medium text-warning">
            ¿Revocar «{credential.name}»? Los sistemas que la usan dejarán de funcionar de inmediato.
          </span>
          <span className="flex gap-2">
            <Button size="compact" variant="ghost" onClick={() => setConfirming(false)} disabled={revoke.isPending}>
              Cancelar
            </Button>
            <Pending active={revoke.isPending} label="Revocando la llave.">
              <Button size="compact" variant="destructive" disabled={revoke.isPending} onClick={() => revoke.mutate(credential.id)}>
                {revoke.isPending ? "Revocando…" : "Sí, revocar"}
              </Button>
            </Pending>
          </span>
        </div>
      )}
      {revoke.error && (
        <p role="alert" className="text-sm font-medium text-error">
          No pudimos revocar la llave. Intenta de nuevo.
        </p>
      )}
    </li>
  );
}

export function ApiScreen() {
  const { data: actor } = useSession();
  const integration = useApiIntegration();
  const [issued, setIssued] = useState<IssueCredentialResponse | null>(null);
  const timezone = actor?.timezone ?? "America/Mexico_City";
  const timeFormat = actor?.timeFormat ?? "12h";

  return (
    <main className="max-w-3xl px-4 pt-4 lg:px-8 lg:pt-8">
      <Link to="/integrations" className="flex items-center gap-1 text-sm text-link hover:underline">
        <ArrowLeft className="size-4" aria-hidden /> Integraciones
      </Link>
      <h1 className="mt-2 text-xl font-semibold">API de cobros</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Tu propio sistema crea los links de pago, consulta cada cobro y recibe el resultado — sin
        que nadie entre a este panel.
      </p>

      {integration.error && (
        <ListError what="la API" onRetry={() => integration.refetch()} className="mt-4" />
      )}

      <Pending
        active={integration.isPending}
        label="Cargando la API"
        shape={
          <div className="mt-4 space-y-4">
            <Skeleton className="h-40 w-full" />
            <Skeleton className="h-32 w-full" />
          </div>
        }
      >
        {integration.data && (
          <div className="mt-4 space-y-4 pb-8">
            {/* FR-009 / research D5: Devolada's condition, in Devolada's
                words. Nothing here is the business's to configure. */}
            {!integration.data.validationAvailable && (
              <Alert variant="warning" layout="icon">
                <TriangleAlert aria-hidden />
                <span>
                  <strong>La validación de transferencias no está disponible por ahora en Devolada.</strong>{" "}
                  Tus links se crean con normalidad y tu configuración está completa; mientras tanto la
                  página de pago le dice al cliente que el canal no está disponible. No hay nada que
                  cambiar de tu lado.
                </span>
              </Alert>
            )}

            {issued ? <IssuedKey issued={issued} onDismiss={() => setIssued(null)} /> : <IssueCard onIssued={setIssued} />}

            {/* automated-collections-api US2 (FR-018): where the business
                sees its deliveries landing — or not */}
            <Card className="flex flex-wrap items-center justify-between gap-4 p-6">
              <div className="flex items-center gap-4">
                <span className="flex size-12 items-center justify-center rounded-md border border-border bg-well">
                  <Webhook className="size-6 text-foreground" aria-hidden />
                </span>
                <div>
                  <h2 className="text-base font-semibold">Webhook</h2>
                  <p className="text-sm text-muted-foreground">Los avisos que Devolada envía a tu sistema, y si están llegando.</p>
                </div>
              </div>
              <Link to="/integrations/api/webhook">
                <Button size="compact" variant="secondary">
                  Ver entregas
                </Button>
              </Link>
            </Card>

            <Card>
              <h2 className="px-4 pt-4 text-base font-semibold">Tus llaves</h2>
              {integration.data.credentials.length === 0 ? (
                <p className="px-4 pb-4 pt-2 text-sm text-muted-foreground">
                  Todavía no tienes llaves. Crea la primera para activar la API.
                </p>
              ) : (
                <ul className="mt-2 divide-y divide-line-soft border-t border-line-soft">
                  {integration.data.credentials.map((credential) => (
                    <CredentialRow key={credential.id} credential={credential} timezone={timezone} timeFormat={timeFormat} />
                  ))}
                </ul>
              )}
            </Card>
          </div>
        )}
      </Pending>
    </main>
  );
}
