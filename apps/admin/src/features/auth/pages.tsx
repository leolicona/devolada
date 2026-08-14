import { Alert } from "@devolada/ui";
import { useEffect, useState } from "react";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ApiError } from "@/lib/api";
import { AccessLayout } from "./AccessLayout";
import { login, recover, resetPassword, signup, verifyEmail } from "./session";

/* Access pages (isp-signup spec UI contract). Controlled forms, plain
   es-MX copy, generic errors that never leak account existence. */

function useSubmit(action: () => Promise<unknown>, onDone: () => void) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return {
    error,
    setError,
    busy,
    async run() {
      setBusy(true);
      setError(null);
      try {
        await action();
        onDone();
      } catch (e) {
        setError(
          e instanceof ApiError && e.code === "EMAIL_TAKEN"
            ? "Ya existe una cuenta con ese correo."
            : e instanceof ApiError && e.code === "INVALID_TOKEN"
              ? "Este enlace ya no sirve. Solicita uno nuevo."
              : "Correo o contraseña incorrectos",
        );
      } finally {
        setBusy(false);
      }
    },
  };
}

export function LoginPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const submit = useSubmit(
    () => login(email, password),
    () => {
      void queryClient.invalidateQueries({ queryKey: ["session"] });
      void navigate({ to: "/" });
    },
  );

  return (
    <AccessLayout title="Iniciar sesión" description="Administra tu red de puntos de cobro.">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit.run();
        }}
        className="space-y-4"
        noValidate
      >
        <div>
          <Label htmlFor="email">Correo</Label>
          <Input id="email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div>
          <Label htmlFor="password">Contraseña</Label>
          <Input id="password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
        {submit.error && <Alert variant="destructive">{submit.error}</Alert>}
        <Button type="submit" size="lg" className="w-full" disabled={submit.busy}>
          {submit.busy ? "Entrando…" : "Entrar"}
        </Button>
        <div className="flex justify-between text-sm">
          <Link to="/recover" className="text-link hover:underline">
            Olvidé mi contraseña
          </Link>
          <Link to="/signup" className="text-link hover:underline">
            Crear cuenta
          </Link>
        </div>
      </form>
    </AccessLayout>
  );
}

export function SignupPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const submit = useSubmit(
    () => signup(name, email, password),
    () => {
      void queryClient.invalidateQueries({ queryKey: ["session"] });
      void navigate({ to: "/" });
    },
  );

  return (
    <AccessLayout title="Crear cuenta" description="Tu ISP, cobrando en las tiendas de tu zona.">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit.run();
        }}
        className="space-y-4"
        noValidate
      >
        <div>
          <Label htmlFor="name">Nombre del ISP</Label>
          <Input id="name" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div>
          <Label htmlFor="email">Correo</Label>
          <Input id="email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div>
          <Label htmlFor="password">Contraseña</Label>
          <Input id="password" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
        {submit.error && <Alert variant="destructive">{submit.error}</Alert>}
        <Button type="submit" size="lg" className="w-full" disabled={submit.busy}>
          {submit.busy ? "Creando…" : "Crear cuenta"}
        </Button>
        <p className="text-center text-sm">
          <Link to="/login" className="text-link hover:underline">
            Ya tengo cuenta
          </Link>
        </p>
      </form>
    </AccessLayout>
  );
}

export function VerifyPage() {
  const { token } = useSearch({ strict: false }) as { token?: string };
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [state, setState] = useState<"working" | "done" | "failed">("working");

  /* D4: the user's job was clicking the link — redeem on load */
  useEffect(() => {
    if (!token) {
      setState("failed");
      return;
    }
    verifyEmail(token)
      .then(() => {
        setState("done");
        void queryClient.invalidateQueries({ queryKey: ["session"] });
      })
      .catch(() => setState("failed"));
  }, [token, queryClient]);

  return (
    <AccessLayout title="Confirmar correo">
      {state === "working" && <p className="text-sm text-muted-foreground">Confirmando…</p>}
      {state === "done" && (
        <div className="space-y-4">
          <Alert variant="success">Tu correo quedó confirmado.</Alert>
          <Button size="lg" className="w-full" onClick={() => void navigate({ to: "/" })}>
            Ir al panel
          </Button>
        </div>
      )}
      {state === "failed" && (
        <Alert variant="destructive">Este enlace ya no sirve. Solicita uno nuevo desde el panel.</Alert>
      )}
    </AccessLayout>
  );
}

export function RecoverPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);

  return (
    <AccessLayout title="Recuperar contraseña">
      {sent ? (
        /* Same confirmation for any email: no existence leak */
        <Alert>Si existe una cuenta con ese correo, enviamos un enlace para restablecer la contraseña.</Alert>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void recover(email).finally(() => setSent(true));
          }}
          className="space-y-4"
          noValidate
        >
          <div>
            <Label htmlFor="email">Correo</Label>
            <Input id="email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <Button type="submit" size="lg" className="w-full">
            Enviar enlace
          </Button>
        </form>
      )}
    </AccessLayout>
  );
}

export function ResetPage() {
  const { token } = useSearch({ strict: false }) as { token?: string };
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const submit = useSubmit(
    async () => {
      if (password.length < 8) throw new ApiError("VALIDATION", 400);
      if (password !== confirm) throw new ApiError("VALIDATION", 400);
      await resetPassword(token ?? "", password);
    },
    () => {
      void queryClient.invalidateQueries({ queryKey: ["session"] });
      void navigate({ to: "/" });
    },
  );

  return (
    <AccessLayout title="Nueva contraseña">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit.run();
        }}
        className="space-y-4"
        noValidate
      >
        <div>
          <Label htmlFor="password">Nueva contraseña</Label>
          <Input id="password" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
        <div>
          <Label htmlFor="confirm">Repite la contraseña</Label>
          <Input id="confirm" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        </div>
        {submit.error && (
          <Alert variant="destructive">
            {submit.error === "Correo o contraseña incorrectos"
              ? "Revisa que la contraseña tenga 8 caracteres y coincida."
              : submit.error}
          </Alert>
        )}
        <Button type="submit" size="lg" className="w-full" disabled={submit.busy}>
          {submit.busy ? "Guardando…" : "Guardar y entrar"}
        </Button>
      </form>
    </AccessLayout>
  );
}
