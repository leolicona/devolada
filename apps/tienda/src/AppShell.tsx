import { Navigate } from "@tanstack/react-router";
import { useSession } from "./auth/session";
import { SuspendedScreen } from "./screens/SuspendedScreen";
import { TabLayout } from "./layout/TabLayout";

/* Session guard (spec D3): 200 → app, 401 → login, 403 → suspended. */
export function AppShell() {
  const { isPending, error, suspended } = useSession();

  if (isPending) {
    return (
      <main className="flex min-h-dvh items-center justify-center bg-surface">
        <p className="text-base text-ink-soft">Cargando…</p>
      </main>
    );
  }
  if (suspended) return <SuspendedScreen />;
  if (error) return <Navigate to="/login" />;
  return <TabLayout />;
}
