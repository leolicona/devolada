import { useState, useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { Search, Share2, Link as LinkIcon, AlertCircle, Check } from "lucide-react";
import { Card, ListError, Skeleton, Alert } from "@devolada/ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api, ApiError } from "@/lib/api";
import type { LinksSearchResponse } from "@devolada/api/direct-payments-schema";

/* US-D07: ISP searches WispHub customers and shares permanent SPEI payment links via WhatsApp. */

export function LinksScreen() {
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  /* design-review: the clipboard call can reject, and either way the
     admin is about to paste into a customer chat — the button says
     which of the two happened. */
  const [copyResult, setCopyResult] = useState<{ id: number; ok: boolean } | null>(null);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => clearTimeout(copyTimer.current), []);

  const handleCopy = async (result: LinksSearchResponse["results"][0]) => {
    let ok = true;
    try {
      await navigator.clipboard.writeText(result.url);
    } catch {
      ok = false;
    }
    setCopyResult({ id: result.wisphubId, ok });
    clearTimeout(copyTimer.current);
    copyTimer.current = setTimeout(() => setCopyResult(null), 2000);
  };

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search);
    }, 400);
    return () => clearTimeout(timer);
  }, [search]);

  /* design-review: the contract 400s under 2 characters, so firing at 1
     showed an error screen for a normal typing moment. */
  const query = debouncedSearch.trim();
  const searching = query.length >= 2;

  const { data, isPending, isError, refetch, isRefetching, error } = useQuery<LinksSearchResponse, ApiError>({
    queryKey: ["payment-links", "search", query],
    queryFn: () => api<LinksSearchResponse>(`/direct-payments/links/search?q=${encodeURIComponent(query)}`),
    enabled: searching,
    retry: false,
  });

  /* The API hands over a finished wa.me link, message and country code
     included (D3). Building it here was where the number lost its 52. */
  const handleShare = (link: LinksSearchResponse["results"][0]) => {
    window.open(link.waLink, "_blank", "noopener,noreferrer");
  };

  const isConfigError = isError && error?.status === 503;

  return (
    <main className="px-4 pt-4 lg:px-8 lg:pt-8 pb-8">
      <div className="flex items-center justify-between gap-4">
        {/* The glossary's full term; the nav carries the short form */}
        <h1 className="text-xl font-semibold">Links de pago</h1>
      </div>

      <div className="mt-6">
        <label className="relative block max-w-md">
          <span className="sr-only">Buscar cliente</span>
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" aria-hidden />
          <Input
            type="search"
            placeholder="Buscar por nombre, usuario o teléfono..."
            className="pl-9"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
      </div>

      {isConfigError && (
        <Alert
          variant="destructive"
          layout="icon"
          className="mt-6"
        >
          <AlertCircle aria-hidden />
          <span>
            <strong>Sin conexión a WispHub.</strong> No pudimos conectar con WispHub para buscar a tus clientes. Revisa tu llave de API en Configuración.
          </span>
        </Alert>
      )}

      {isError && !isConfigError && (
        <ListError
          what="los enlaces"
          onRetry={() => void refetch()}
          retrying={isRefetching}
          className="mt-6"
        />
      )}

      {isPending && searching && !isError && (
        <Card className="mt-6 p-4">
          {[0, 1, 2].map((k) => (
            <div key={k} className="flex items-center gap-4 py-3">
              <div className="flex-1 space-y-2">
                <Skeleton className="h-4 w-44" />
                <Skeleton className="h-3 w-32" />
              </div>
              <Skeleton className="h-9 w-28 rounded-md" />
            </div>
          ))}
        </Card>
      )}

      {!searching && !isError && (
        <p className="mt-6 max-w-lg text-sm text-muted-foreground">
          Busca a un cliente por nombre, usuario o teléfono para obtener su enlace permanente de pago por transferencia.
        </p>
      )}

      {/* design-review: results arrive while focus stays in the input,
          so the region announces them — the feed's list already does. */}
      <div aria-live="polite">
        {!isPending && !isError && data?.results.length === 0 && searching && (
          <p className="mt-6 max-w-lg rounded-md border border-border bg-muted px-4 py-3 text-sm text-muted-foreground">
            No se encontraron clientes con "{query}".
          </p>
        )}

        {data && data.results.length > 0 && (
          <Card className="mt-6">
            <ul className="divide-y divide-line-soft">
              {data.results.map((result) => (
                <li
                  key={result.wisphubId}
                  /* design-review: no row hover — unlike StoresScreen the
                     row itself does nothing, only its buttons act */
                  className="grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-3 p-4 sm:flex"
                >
                  <div className="min-w-0 sm:flex-1">
                    <span className="block text-sm font-medium">{result.name || result.usuario}</span>
                    <span className="block text-sm text-muted-foreground">
                      {result.usuario} {result.phone ? `· ${result.phone}` : ""}
                    </span>
                  </div>
                
                  <div className="col-span-2 flex items-center justify-end gap-2 sm:contents">
                    <Button
                      variant="outline"
                      className="shrink-0"
                      onClick={() => void handleCopy(result)}
                      title="Copiar enlace"
                      aria-live="polite"
                    >
                      {copyResult?.id === result.wisphubId ? (
                        copyResult.ok ? (
                          <>
                            <Check className="mr-2 size-4" aria-hidden />
                            Copiado
                          </>
                        ) : (
                          <>
                            <AlertCircle className="mr-2 size-4" aria-hidden />
                            No se copió
                          </>
                        )
                      ) : (
                        <>
                          <LinkIcon className="size-4" aria-hidden />
                          <span className="sr-only">Copiar</span>
                        </>
                      )}
                    </Button>
                  
                    <Button
                      className="shrink-0"
                      onClick={() => handleShare(result)}
                    >
                      <Share2 className="mr-2 size-4" aria-hidden />
                      Compartir
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </div>
    </main>
  );
}
