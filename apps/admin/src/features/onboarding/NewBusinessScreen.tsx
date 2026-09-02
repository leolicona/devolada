import { Alert } from "@devolada/ui";
import { useState } from "react";
import { Navigate, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { BANKS } from "@devolada/api/settings-schema";
import type { Bank } from "@devolada/api/settings-schema";
import { bankForClabe } from "@devolada/api/clabe";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ApiError } from "@/lib/api";
import { AccessLayout } from "../auth/AccessLayout";
import { VerifyEmailBanner } from "../auth/VerifyEmailBanner";
import { createBusiness, useUser } from "../auth/session";

/* The onboarding wizard (business-and-memberships D5, US-B01): one
   decision per screen, and the business is persisted at completion in
   ONE call — an abandoned wizard creates nothing. The bank is picked from
   the provider vocabulary, pre-selected by the CLABE's first digits and
   never typed (direct-payment D16, BUG-007). */

type Step = 1 | 2 | 3;

export function NewBusinessScreen() {
  const user = useUser();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [step, setStep] = useState<Step>(1);
  const [name, setName] = useState("");
  const [clabe, setClabe] = useState("");
  const [bank, setBank] = useState<Bank | "">("");
  const [bankTouched, setBankTouched] = useState(false);
  const [beneficiary, setBeneficiary] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (user.isPending) {
    return (
      <main className="flex min-h-dvh items-center justify-center bg-background">
        <p className="text-sm text-ink-soft">Cargando…</p>
      </main>
    );
  }
  if (!user.data) return <Navigate to="/login" />;

  const clabeDigits = clabe.replace(/\D/g, "");
  const clabeValid = /^\d{18}$/.test(clabeDigits);

  function onClabeChange(value: string) {
    setClabe(value);
    /* The prefix names the bank; the pick stays the user's if they
       already chose one on purpose */
    if (!bankTouched) {
      const guess = bankForClabe(value);
      setBank(guess ?? "");
    }
  }

  async function finish() {
    setBusy(true);
    setError(null);
    try {
      await createBusiness({
        name: name.trim(),
        speiClabe: clabeDigits,
        speiBank: bank as Bank,
        speiBeneficiaryName: beneficiary.trim() || null,
      });
      /* Only the session is stale (it said NO_BUSINESS); the user query
         stays, or this screen falls into "Cargando…" between the two
         steps (identity round, 2026-09-02). */
      queryClient.removeQueries({ queryKey: ["session"] });
      setStep(3);
    } catch (e) {
      setError(
        e instanceof ApiError && e.status === 400
          ? "Revisa los datos: la CLABE son 18 dígitos y el banco se elige de la lista."
          : "No pudimos crear tu negocio. Intenta de nuevo.",
      );
    } finally {
      setBusy(false);
    }
  }

  const stepLabel = `Paso ${step} de 3`;

  return (
    <AccessLayout
      title={step === 3 ? "Tu negocio está listo" : "Crea tu negocio"}
      description={step === 3 ? "Ya puedes cobrar por transferencia." : stepLabel}
    >
      {!user.data.emailVerified && <VerifyEmailBanner email={user.data.email} />}

      {step === 1 && (
        <form
          className="space-y-4"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim().length >= 2) setStep(2);
          }}
        >
          <div>
            <Label htmlFor="business-name">Nombre del negocio</Label>
            <Input
              id="business-name"
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Como lo conocen tus clientes"
            />
          </div>
          <Button type="submit" size="lg" className="w-full" disabled={name.trim().length < 2}>
            Continuar
          </Button>
        </form>
      )}

      {step === 2 && (
        <form
          className="space-y-4"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            if (clabeValid && bank) void finish();
          }}
        >
          <div>
            <Label htmlFor="clabe">CLABE</Label>
            <Input
              id="clabe"
              className="mt-1 font-mono"
              inputMode="numeric"
              maxLength={18}
              autoFocus
              value={clabe}
              onChange={(e) => onClabeChange(e.target.value)}
              placeholder="18 dígitos"
              autoComplete="off"
            />
            {clabe.trim() !== "" && !clabeValid && (
              <p className="mt-1 text-sm font-medium text-error">La CLABE debe tener 18 dígitos.</p>
            )}
            <p className="mt-1 text-sm text-ink-soft">
              La cuenta donde recibes las transferencias. El dinero llega directo a ti.
            </p>
          </div>
          <div>
            <Label htmlFor="bank">Banco</Label>
            <Select
              value={bank}
              onValueChange={(v) => {
                setBankTouched(true);
                setBank(v as Bank);
              }}
            >
              <SelectTrigger id="bank" className="mt-1" aria-label="Banco">
                <SelectValue placeholder="Elige tu banco" />
              </SelectTrigger>
              <SelectContent>
                {[...BANKS]
                  .sort((a, b) => a.localeCompare(b, "es"))
                  .map((b) => (
                    <SelectItem key={b} value={b}>
                      {b}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
            <p className="mt-1 text-sm text-ink-soft">
              Lo tomamos de tu CLABE; si no coincide, elígelo de la lista.
            </p>
          </div>
          <div>
            <Label htmlFor="beneficiary">Nombre del beneficiario (opcional)</Label>
            <Input
              id="beneficiary"
              className="mt-1"
              value={beneficiary}
              onChange={(e) => setBeneficiary(e.target.value)}
              placeholder="Como aparece en tu cuenta"
            />
          </div>
          {error && <Alert variant="destructive">{error}</Alert>}
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={() => setStep(1)}>
              Atrás
            </Button>
            <Button type="submit" size="lg" className="flex-1" disabled={!clabeValid || !bank || busy}>
              {busy ? "Creando…" : "Crear negocio"}
            </Button>
          </div>
        </form>
      )}

      {step === 3 && (
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Tus clientes con banco ya pueden pagarte por transferencia desde su link de pago.
          </p>
          <Button size="lg" className="w-full" onClick={() => void navigate({ to: "/links" })}>
            Comparte un link de pago
          </Button>
        </div>
      )}
    </AccessLayout>
  );
}
