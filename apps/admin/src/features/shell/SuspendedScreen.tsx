import { Button } from "@devolada/ui";
import { useQuery } from "@tanstack/react-query";
import { Mail, MessageCircle, WifiOff } from "lucide-react";
import { api } from "@/lib/api";
import { SignOutLink } from "../auth/SignOutLink";

/* operator-panel D1 (identity round): the channel is a platform setting,
   read without a session — the suspended one was just revoked. Its own
   module because two doors answer the suspension with it: the shell, and
   /welcome, which reads the actor first after a código and is then the
   only one that ever hears the answer (passwordless-access D6;
   adversarial review, 2026-10-02). */
export function SuspendedScreen() {
  const support = useQuery<{ whatsapp: string | null; email: string | null }>({
    queryKey: ["support"],
    queryFn: () => api("/support"),
    retry: false,
  });
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-5 bg-background px-8 text-center">
      <span className="flex size-16 items-center justify-center rounded-full border border-error-line bg-error-soft">
        <WifiOff className="size-8 text-error" aria-hidden />
      </span>
      <h1 className="text-xl font-semibold">Cuenta suspendida</h1>
      <p className="max-w-sm text-base text-muted-foreground">
        Tu cuenta está suspendida. Escríbenos para revisarla.
      </p>
      {support.data && (support.data.whatsapp || support.data.email) && (
        <div className="flex flex-wrap justify-center gap-2">
          {support.data.whatsapp && (
            <a href={`https://wa.me/${support.data.whatsapp}`} target="_blank" rel="noopener noreferrer" className="inline-flex">
              <Button size="compact" variant="secondary">
                <MessageCircle className="size-4" aria-hidden />
                WhatsApp
              </Button>
            </a>
          )}
          {support.data.email && (
            <a href={`mailto:${support.data.email}`} className="inline-flex">
              <Button size="compact" variant="secondary">
                <Mail className="size-4" aria-hidden />
                {support.data.email}
              </Button>
            </a>
          )}
        </div>
      )}
      <SignOutLink />
    </main>
  );
}
