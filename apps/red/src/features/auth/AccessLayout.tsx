import type { ReactNode } from "react";
import { Card } from "@devolada/ui";

/* The access screens' frame: centred on a phone, the product's name above */
export function AccessLayout({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center px-4 py-6">
      <p className="mb-4 text-center text-sm font-semibold text-ink-soft">Devolada · Tienda</p>
      <Card className="space-y-4 p-6">
        <h1 className="text-xl font-semibold">{title}</h1>
        {children}
      </Card>
    </main>
  );
}

export function FieldError({ id, children }: { id: string; children: string | null }) {
  if (!children) return null;
  return (
    <p id={id} role="alert" className="text-sm font-medium text-error">
      {children}
    </p>
  );
}

export const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
