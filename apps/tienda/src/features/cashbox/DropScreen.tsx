import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDownToLine } from "lucide-react";
import { Alert, Amount, Button, Field, Input, Skeleton, parseMoney } from "@devolada/ui";
import type { CashboxResponse } from "@devolada/api/cashbox-schema";
import type { CashDropResponse } from "@devolada/api/cash-drops-schema";
import { api, ApiError } from "../../api/client";

/* Record a cash drop (US-K02). Suggested amount = the full balance,
   editable downward only (spec D3). */

export function DropScreen() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: cashbox, isPending } = useQuery<CashboxResponse, ApiError>({
    queryKey: ["cashbox"],
    queryFn: () => api<CashboxResponse>("/cashbox"),
  });

  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);

  /* Prefill once with the full balance */
  useEffect(() => {
    if (cashbox && text === "") setText((cashbox.balanceCents / 100).toFixed(2));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cashbox]);

  const record = useMutation<CashDropResponse, ApiError, number>({
    mutationFn: (cents) =>
      api<CashDropResponse>("/cash-drops", {
        method: "POST",
        body: JSON.stringify({ cents }),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["cashbox"] });
      void navigate({ to: "/cashbox" });
    },
    onError: (e) => {
      setError(
        e.code === "DROP_ALREADY_PENDING"
          ? "Ya tienes una entrega pendiente de confirmar."
          : "El monto no puede ser mayor a tu balance.",
      );
    },
  });

  /* The field waits for the balance — every hook has run by now. Rendering
     it earlier lets the prefill land on top of what the shopkeeper typed. */
  if (isPending || !cashbox) {
    return (
      <main className="px-6 pt-8" aria-busy="true" aria-label="Cargando tu balance">
        <h1 className="text-xl font-semibold">Registrar entrega</h1>
        <Skeleton className="mt-2 h-4 w-56" />
        <div className="mt-6">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="mt-2 h-12 w-full" />
        </div>
      </main>
    );
  }

  const balanceCents = cashbox.balanceCents;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const cents = parseMoney(text);
    if (cents === null || cents <= 0) {
      setError("Escribe un monto válido.");
      return;
    }
    if (cents > balanceCents) {
      setError("El monto no puede ser mayor a tu balance.");
      return;
    }
    record.mutate(cents);
  }

  return (
    <main className="px-6 pt-8">
      <h1 className="text-xl font-semibold">Registrar entrega</h1>
      <p className="mt-2 text-sm text-ink-soft">
        Tienes <Amount cents={cashbox.balanceCents} className="font-semibold" /> del ISP en tu poder.
      </p>

      <form onSubmit={submit} className="mt-6 space-y-5" noValidate>
        <Field label="Monto a entregar">
          <Input
            inputMode="decimal"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="0.00"
          />
        </Field>
        {error && <Alert variant="destructive">{error}</Alert>}
        <Button type="submit" disabled={record.isPending} className="w-full">
          <ArrowDownToLine className="size-5" aria-hidden />
          {record.isPending ? "Registrando…" : "Registrar entrega"}
        </Button>
        <p className="text-sm text-ink-soft">
          La entrega quedará pendiente hasta que tu ISP confirme que recibió el efectivo.
        </p>
      </form>
    </main>
  );
}
