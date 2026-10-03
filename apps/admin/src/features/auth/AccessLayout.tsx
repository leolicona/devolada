import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@devolada/ui";
import type { ReactNode } from "react";

/* Shared frame for every access page (login, signup, welcome, the
   invitation). passwordless-access D6: `/welcome`'s offer brings its own
   heading (PasskeyOffer), so the title is optional. */
export function AccessLayout({
  title,
  description,
  children,
}: {
  title?: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-background px-6">
      <div className="w-full max-w-sm">
        {/* design-review 2026-09-01 (must fix): the wordmark is "Devolada" —
            "Admin" was an identifier leaking into es-MX copy, and the shell's
            own sidebar never said it. */}
        <p className="mb-6 text-center text-2xl font-semibold tracking-tight">Devolada</p>
        <Card>
          {title && (
            <CardHeader>
              <CardTitle>{title}</CardTitle>
              {description && <CardDescription>{description}</CardDescription>}
            </CardHeader>
          )}
          <CardContent className={title ? undefined : "pt-6"}>{children}</CardContent>
        </Card>
      </div>
    </main>
  );
}
