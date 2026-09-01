import { useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ROLE_LABELS } from "../settings/UsersCard";
import { setActiveBusiness, type BusinessActor } from "../auth/session";

const NEW = "__new__";

/* The workspace switcher (business-and-memberships US-B02, IA): a plain
   label with one business; a menu plus "Crear negocio" with several.
   Switching swaps the whole query cache — no row of A under B. */
export function BusinessSwitcher({ actor }: { actor: BusinessActor }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  if (actor.businesses.length <= 1) {
    return (
      <div>
        <p className="truncate text-sm font-medium">{actor.name}</p>
        <p className="text-xs text-ink-soft">{ROLE_LABELS[actor.role]}</p>
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
      <SelectTrigger aria-label="Negocio" className="h-9 w-full">
        <SelectValue />
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
