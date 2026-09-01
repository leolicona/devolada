import { Alert } from "@devolada/ui";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { MembersResponse } from "@devolada/api/businesses-schema";
import { ROLE_RANK, type Role } from "@devolada/api/role-matrix";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { api, ApiError } from "@/lib/api";

/* Usuarios (business-and-memberships US-B03): who may do what inside the
   business. The roles offered come from the API (`grantable`, D3's
   footnote), so an admin never sees "Administrador" as a choice — hidden,
   not disabled (the brief's law). */

export const ROLE_LABELS: Record<Role, string> = {
  owner: "Dueño",
  admin: "Administrador",
  operator: "Operador",
  viewer: "Lector",
};

export function UsersCard({ role, selfUserId }: { role: Role; selfUserId: string }) {
  const queryClient = useQueryClient();
  const members = useQuery<MembersResponse, ApiError>({
    queryKey: ["members"],
    queryFn: () => api<MembersResponse>("/businesses/members"),
  });
  const [email, setEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<Role | "">("");
  const [sentTo, setSentTo] = useState<string | null>(null);

  const invite = useMutation<unknown, ApiError>({
    mutationFn: () =>
      api("/businesses/members", { method: "POST", body: JSON.stringify({ email: email.trim(), role: inviteRole }) }),
    onSuccess: () => {
      setSentTo(email.trim());
      setEmail("");
      setInviteRole("");
      void queryClient.invalidateQueries({ queryKey: ["members"] });
    },
  });
  const remove = useMutation<unknown, ApiError, string>({
    mutationFn: (memberId) => api(`/businesses/members/${memberId}`, { method: "DELETE" }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["members"] }),
  });

  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());

  return (
    <section className="rounded-lg border border-border bg-card p-6" aria-labelledby="users-title">
      <h2 id="users-title" className="text-base font-semibold">
        Usuarios
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Quién puede entrar a este negocio y qué puede hacer.
      </p>

      {members.isPending && <p className="mt-4 text-sm text-ink-soft">Cargando…</p>}
      {members.error && (
        <Alert variant="destructive" className="mt-4">
          No pudimos cargar los usuarios.{" "}
          <button type="button" className="underline" onClick={() => void members.refetch()}>
            Reintentar
          </button>
        </Alert>
      )}

      {members.data && (
        <>
          <ul className="mt-4 divide-y divide-line-soft">
            {members.data.members.map((m) => {
              /* Same rank rule as the API: below my own, never the owner, never me */
              const removable =
                m.userId !== selfUserId && m.role !== "owner" && ROLE_RANK[m.role] < ROLE_RANK[role];
              return (
                <li key={m.id} className="flex items-center gap-3 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">
                      {m.name}
                      {m.userId === selfUserId && <span className="ml-2 text-sm font-normal text-ink-soft">(tú)</span>}
                    </p>
                    <p className="truncate text-sm text-ink-soft">{m.email}</p>
                  </div>
                  <span className="shrink-0 text-sm">{ROLE_LABELS[m.role]}</span>
                  {removable && (
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button variant="outline" className="shrink-0">
                          Quitar
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogTitle>¿Quitar a {m.name}?</AlertDialogTitle>
                        <AlertDialogDescription>
                          Dejará de ver este negocio de inmediato. Puedes invitarle de nuevo después.
                        </AlertDialogDescription>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancelar</AlertDialogCancel>
                          <AlertDialogAction onClick={() => remove.mutate(m.id)}>Quitar</AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  )}
                </li>
              );
            })}
          </ul>

          {members.data.grantable.length > 0 && (
            <form
              className="mt-4 grid gap-3 sm:grid-cols-[1fr_auto_auto] sm:items-end"
              noValidate
              onSubmit={(e) => {
                e.preventDefault();
                if (emailValid && inviteRole) invite.mutate();
              }}
            >
              <div>
                <Label htmlFor="invite-email">Invitar por correo</Label>
                <Input
                  id="invite-email"
                  type="email"
                  className="mt-1"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="nombre@correo.com"
                />
              </div>
              <div>
                <Label htmlFor="invite-role">Rol</Label>
                <Select value={inviteRole} onValueChange={(v) => setInviteRole(v as Role)}>
                  <SelectTrigger id="invite-role" className="mt-1 sm:w-44" aria-label="Rol">
                    <SelectValue placeholder="Elige un rol" />
                  </SelectTrigger>
                  <SelectContent>
                    {members.data.grantable.map((r) => (
                      <SelectItem key={r} value={r}>
                        {ROLE_LABELS[r]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button type="submit" disabled={!emailValid || !inviteRole || invite.isPending}>
                {invite.isPending ? "Enviando…" : "Invitar"}
              </Button>
            </form>
          )}
          {sentTo && !invite.isPending && (
            <p role="status" className="mt-2 text-sm font-medium text-success">
              Invitación enviada a {sentTo}.
            </p>
          )}
          {invite.error && (
            <Alert variant="destructive" className="mt-2">
              {invite.error.code === "FORBIDDEN_FOR_ROLE"
                ? "No puedes dar ese rol."
                : "No pudimos enviar la invitación. Intenta de nuevo."}
            </Alert>
          )}
        </>
      )}
    </section>
  );
}
