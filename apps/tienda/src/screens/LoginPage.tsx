import { Link, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { LoginForm } from "../auth/LoginForm";

export function LoginPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  return (
    <main className="mx-auto flex min-h-dvh max-w-content flex-col justify-center bg-surface px-8">
      <p className="text-2xl font-semibold tracking-tight">Devolada</p>
      <p className="mt-1 mb-8 text-base text-ink-soft">Punto de cobro de internet</p>
      <LoginForm
        onSuccess={() => {
          void queryClient.invalidateQueries({ queryKey: ["session"] });
          void navigate({ to: "/" });
        }}
      />
      <p className="mt-6 text-center text-sm">
        <Link to="/recuperar" className="text-link hover:underline">
          ¿Olvidaste tu contraseña?
        </Link>
      </p>
    </main>
  );
}
