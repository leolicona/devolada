import { useEffect, useState } from "react";
import { Alert, Button, Card } from "@devolada/ui";
import { ChevronRight, Link as LinkIcon } from "lucide-react";
import { forgetLink, readLinks, type SavedLink } from "@/links";

/* The bare origin (returning-customer-access D2, D3).

   Three states and no lookup field anywhere: there is deliberately no way
   to turn a phone or a customer number into somebody's link (D1). What a
   visitor sees here depends only on what this device was already given. */

export function RootScreen({ onOpen }: { onOpen: (path: string) => void }) {
  const [links, setLinks] = useState<SavedLink[]>(readLinks);

  /* One saved link goes straight through, so the customer never meets
     this screen. In an effect, not during render: navigating is a side
     effect, and the list can also drop to one after a "no es mi
     servicio" (scenario 4). */
  useEffect(() => {
    if (links.length === 1) onOpen(`/p/${links[0].token}`);
  }, [links, onOpen]);

  if (links.length === 1) return null;

  if (links.length === 0) {
    return (
      <Card className="space-y-4 p-6">
        <h1 className="text-lg font-semibold">Tu pago</h1>
        {/* D9: the way in is whoever sent the link. Never hint at a
            self-service lookup, because there is not one.
            confirmation-hierarchy D14 (spec FR-021): no business is known
            here, and none is assumed to sell internet. */}
        <Alert layout="icon">
          <LinkIcon aria-hidden />
          Aún no tienes un link de pago guardado en este dispositivo. Pídeselo a quien te envió el link.
        </Alert>
      </Card>
    );
  }

  const forget = (token: string) => {
    forgetLink(token);
    setLinks(readLinks());
  };

  return (
    <Card className="space-y-4 p-6">
      <header>
        <h1 className="text-lg font-semibold">¿De quién es el pago?</h1>
        <p className="text-sm text-ink-soft">Guardaste más de un servicio en este dispositivo.</p>
      </header>

      <ul className="divide-y divide-line-soft border-t border-line-soft">
        {links.map((link) => (
          <li key={link.token} className="py-2">
            <Button
              variant="secondary"
              className="w-full justify-between"
              onClick={() => onOpen(`/p/${link.token}`)}
            >
              {link.name}
              <ChevronRight className="size-5 shrink-0" aria-hidden />
            </Button>
            <Button
              variant="ghost"
              className="mt-1 h-10 px-2 text-sm"
              onClick={() => forget(link.token)}
            >
              Este no es mi servicio
              {/* Every row shows the same words; the name makes each
                  button distinguishable without changing what is read
                  aloud first (WCAG 2.5.3 keeps the visible text). */}
              <span className="sr-only"> de {link.name}</span>
            </Button>
          </li>
        ))}
      </ul>
    </Card>
  );
}
