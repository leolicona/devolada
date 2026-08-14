import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { Copy, MessageCircle } from "lucide-react";
import { parseMoney } from "@devolada/ui";
import type { StoreCreateResponse } from "@devolada/api/stores-schema";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api, ApiError } from "@/lib/api";

/* Register a store (US-A02). Until TD-003 is paid, the copyable
   invitation link IS the product — no fake "sent" state (spec D2). */

export function NewStoreScreen() {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({ name: "", contactName: "", phone: "", zone: "", cap: "5,000" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<StoreCreateResponse | null>(null);
  const [copied, setCopied] = useState(false);

  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm({ ...form, [key]: e.target.value });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const capCents = parseMoney(form.cap);
    if (!capCents || capCents <= 0) {
      setError("Escribe un techo de saldo válido.");
      return;
    }
    setBusy(true);
    try {
      const data = await api<StoreCreateResponse>("/stores", {
        method: "POST",
        body: JSON.stringify({
          name: form.name,
          contactName: form.contactName,
          phone: form.phone,
          zone: form.zone || undefined,
          balanceCapCents: capCents,
        }),
      });
      setCreated(data);
      void queryClient.invalidateQueries({ queryKey: ["stores"] });
    } catch (e) {
      setError(
        e instanceof ApiError && e.code === "PHONE_TAKEN"
          ? "Ya existe una tienda con ese teléfono."
          : e instanceof ApiError && e.code === "EMAIL_NOT_VERIFIED"
            ? "Confirma tu correo antes de registrar tiendas."
            : "Revisa los datos e intenta de nuevo.",
      );
    } finally {
      setBusy(false);
    }
  }

  if (created) {
    return (
      <main className="px-4 pt-4 lg:px-8 lg:pt-8">
        <Card className="max-w-lg">
          <CardHeader>
            <CardTitle>{created.store.name} quedó registrada</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Envía este enlace por WhatsApp a {created.store.contactName}. Con él crea su
              contraseña y puede empezar a cobrar.
            </p>
            <p className="break-all rounded-md border border-border bg-muted p-3 font-mono text-sm">
              {created.invitationLink}
            </p>
            <div className="flex gap-3">
              <Button
                onClick={() => {
                  void navigator.clipboard.writeText(created.invitationLink);
                  setCopied(true);
                }}
              >
                <Copy className="size-4" aria-hidden />
                {copied ? "Copiado" : "Copiar enlace"}
              </Button>
              <Link to="/stores">
                <Button variant="outline">Volver a tiendas</Button>
              </Link>
            </div>
            <Alert className="flex items-center gap-2">
              <MessageCircle className="size-4 shrink-0" aria-hidden />
              El envío automático por WhatsApp llegará después; por ahora tú compartes el enlace.
            </Alert>
          </CardContent>
        </Card>
      </main>
    );
  }

  return (
    <main className="px-4 pt-4 lg:px-8 lg:pt-8">
      <Card className="max-w-lg">
        <CardHeader>
          <CardTitle>Nueva tienda</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="space-y-4" noValidate>
            <div>
              <Label htmlFor="name">Nombre de la tienda</Label>
              <Input id="name" value={form.name} onChange={set("name")} />
            </div>
            <div>
              <Label htmlFor="contactName">Responsable</Label>
              <Input id="contactName" value={form.contactName} onChange={set("contactName")} />
            </div>
            <div>
              <Label htmlFor="phone">Teléfono (10 dígitos)</Label>
              <Input id="phone" type="tel" inputMode="numeric" value={form.phone} onChange={set("phone")} />
            </div>
            <div>
              <Label htmlFor="zone">Zona o colonia</Label>
              <Input id="zone" value={form.zone} onChange={set("zone")} />
            </div>
            <div>
              <Label htmlFor="cap">Techo de saldo (pesos)</Label>
              <Input id="cap" inputMode="decimal" value={form.cap} onChange={set("cap")} />
            </div>
            {error && <Alert variant="destructive">{error}</Alert>}
            <Button type="submit" size="lg" disabled={busy}>
              {busy ? "Registrando…" : "Registrar y crear invitación"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
