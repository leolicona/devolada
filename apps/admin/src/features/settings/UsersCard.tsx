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
import { ROLE_LABELS } from "../auth/roles";
import { cancelInvitation, resendInvitation, updateMemberRole } from "../auth/session";

export { ROLE_LABELS };

/* Usuarios (business-and-memberships US-B03): who may do what inside the
   business. The roles offered come from the API (`grantable`, D3's
   footnote), so an admin never sees "Administrador" as a choice — hidden,
   not disabled (the brief's law). D8: the pending invitations live here
   too, with resend and cancel; D12: the role is a picker for the members
   I could have invited. better-auth D13: inviting needs a verified email. */

function expiresIn(expiresAt: number): string {
  const hours = Math.max(0, Math.round((expiresAt - Date.now()) / 3_600_000));
  if (hours < 1) return "Vence en menos de una hora";
  if (hours < 48) return `Vence en ${hours} ${hours === 1 ? "hora" : "horas"}`;
  const days = Math.round(hours / 24);
  return `Vence en ${days} días`;
}

export function UsersCard({ role, selfUserId, emailVerified }: { role: Role; selfUserId: string; emailVerified: boolean }) {
  const queryClient = useQueryClient();
  const members = useQuery<MembersResponse, ApiError>({
    queryKey: ["members"],
    queryFn: () => api<MembersResponse>("/businesses/members"),
  });
  const [email, setEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<Role | "">("");
  const [sentTo, setSentTo] = useState<string | null>(null);
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ["members"] });

  const invite = useMutation<unknown, ApiError>({
    mutationFn: () =>
      api("/businesses/members", { method: "POST", body: JSON.stringify({ email: email.trim(), role: inviteRole }) }),
    onSuccess: () => {
      setSentTo(email.trim());
      setEmail("");
      setInviteRole("");
      refresh();
    },
  });
  const remove = useMutation<unknown, ApiError, string>({
    mutationFn: (memberId) => api(`/businesses/members/${memberId}`, { method: "DELETE" }),
    onSuccess: refresh,
  });
  const changeRole = useMutation<unknown, ApiError, { memberId: string; role: Role }>({
    mutationFn: ({ memberId, role }) => updateMemberRole(memberId, role),
    onSuccess: refresh,
  });
  const resend = useMutation<unknown, ApiError, string>({ mutationFn: resendInvitation, onSuccess: refresh });
  const cancel = useMutation<unknown, ApiError, string>({ mutationFn: cancelInvitation, onSuccess: refresh });

  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  const pending = members.data?.pending ?? [];
  const grantable = members.data?.grantable ?? [];
  const mayInvite = grantable.length > 0;

  return (
    <section id="usuarios" className="scroll-mt-24 rounded-lg border border-border bg-card p-6" aria-labelledby="users-title">
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
              const changeable =
                mayInvite && m.userId !== selfUserId && m.role !== "owner" && ROLE_RANK[m.role] < ROLE_RANK[role];
              return (
                <li key={m.id} className="flex items-center gap-3 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">
                      {m.name}
                      {m.userId === selfUserId && <span className="ml-2 text-sm font-normal text-ink-soft">(tú)</span>}
                    </p>
                    {/* D11: the email rides only for inviters; below sm the
                        role rides this line (three columns squeezed the
                        email to "ana@wifiplus…" at 375px) */}
                    <p className="truncate text-sm text-ink-soft">
                      {m.email ?? ""}
                      {!changeable && <span className={m.email ? "sm:hidden" : undefined}>{m.email ? " · " : ""}{ROLE_LABELS[m.role]}</span>}
                    </p>
                  </div>
                  {changeable ? (
                    <Select
                      value={m.role}
                      onValueChange={(v) => changeRole.mutate({ memberId: m.id, role: v as Role })}
                      disabled={changeRole.isPending}
                    >
                      <SelectTrigger className="w-40 shrink-0" aria-label={`Rol de ${m.name}`}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {grantable.map((r) => (
                          <SelectItem key={r} value={r}>
                            {ROLE_LABELS[r]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <span className={`shrink-0 text-sm ${m.email ? "hidden sm:inline" : "hidden"}`}>{ROLE_LABELS[m.role]}</span>
                  )}
                  {changeable && (
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
          {changeRole.error && (
            <Alert variant="destructive" className="mt-2">
              No pudimos cambiar el rol. Intenta de nuevo.
            </Alert>
          )}

          {pending.length > 0 && (
            <div className="mt-6">
              <h3 className="text-sm font-semibold">Invitaciones pendientes</h3>
              <ul className="mt-2 divide-y divide-line-soft" aria-label="Invitaciones pendientes">
                {pending.map((p) => (
                  <li key={p.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 py-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{p.email}</p>
                      <p className="text-sm text-ink-soft">
                        {ROLE_LABELS[p.role]} ·{" "}
                        {p.expired ? <span className="font-medium text-error">Vencida</span> : expiresIn(p.expiresAt)}
                      </p>
                    </div>
                    <Button
                      variant="outline"
                      className="shrink-0"
                      disabled={resend.isPending}
                      onClick={() => resend.mutate(p.id)}
                    >
                      Reenviar
                    </Button>
                    <Button
                      variant="ghost"
                      className="shrink-0"
                      disabled={cancel.isPending}
                      onClick={() => cancel.mutate(p.id)}
                    >
                      Cancelar
                    </Button>
                  </li>
                ))}
              </ul>
              {resend.isSuccess && (
                <p role="status" className="mt-2 text-sm font-medium text-success">
                  Invitación reenviada.
                </p>
              )}
              {(resend.error || cancel.error) && (
                <Alert variant="destructive" className="mt-2">
                  No pudimos actualizar la invitación. Intenta de nuevo.
                </Alert>
              )}
            </div>
          )}

          {mayInvite && !emailVerified && (
            <Alert variant="warning" className="mt-4">
              Confirma tu correo para invitar a tu equipo. El código está en el aviso de arriba.
            </Alert>
          )}
          {mayInvite && emailVerified && (
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
                    {grantable.map((r) => (
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
              Invitación enviada a {sentTo}. Vence en 48 horas.
            </p>
          )}
          {invite.error && (
            <Alert variant="destructive" className="mt-2">
              {invite.error.code === "FORBIDDEN_FOR_ROLE"
                ? "No puedes dar ese rol."
                : invite.error.code === "EMAIL_NOT_VERIFIED"
                  ? "Confirma tu correo para invitar a tu equipo."
                  : "No pudimos enviar la invitación. Intenta de nuevo."}
            </Alert>
          )}
        </>
      )}
    </section>
  );
}
