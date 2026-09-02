import { useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ROLE_LABELS } from "../settings/UsersCard";
import { setActiveBusiness, type BusinessActor } from "../auth/session";

const NEW = "__new__";

/* The workspace switcher (business-and-memberships US-B02, IA): a plain
   label with one business; a menu plus "Crear negocio" with several.
   Switching swaps the whole query cache — no row of A under B.

   Two shapes (shell header, 2026-09-02): the sidebar stacks name and
   role; the phone's bar is one line and carries only the name — the
   role is not something to read on every screen, and the sidebar keeps
   it because "hide, never disable" leaves a viewer wondering why a
   section is missing. */
export function BusinessSwitcher({ actor, variant = "sidebar" }: { actor: BusinessActor; variant?: "sidebar" | "bar" }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const bar = variant === "bar";

  if (actor.businesses.length <= 1) {
    return (
      <div className="min-w-0">
        <p className="truncate text-sm font-medium">{actor.name}</p>
        {!bar && <p className="text-xs text-ink-soft">{ROLE_LABELS[actor.role]}</p>}
      </div>
    );
  }

  async function onChange(value: string) {
    if (value === NEW) {
      void navigate({ to: "/nuevo-negocio" });
      return;
    }
    const target = actor.businesses.find((b) => b.id === value);
    if (!target || target.id === actor.id) return;
    await setActiveBusiness(target.orgId);
    queryClient.clear();
    void navigate({ to: "/" });
  }

  return (
    <Select value={actor.id} onValueChange={(v) => void onChange(v)}>
      <SelectTrigger
        aria-label="Negocio"
        className={bar ? "h-8 w-auto min-w-0 border-0 bg-transparent px-0 font-medium" : "h-9 w-full"}
      >
        <span className="truncate">
          <SelectValue />
        </span>
      </SelectTrigger>
      <SelectContent>
        {actor.businesses.map((b) => (
          <SelectItem key={b.id} value={b.id}>
            {b.name}
          </SelectItem>
        ))}
        <SelectItem value={NEW}>Crear negocio…</SelectItem>
      </SelectContent>
    </Select>
  );
}
