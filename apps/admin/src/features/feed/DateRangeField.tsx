import { useState } from "react";
import { Button } from "@devolada/ui";
import { CalendarDays } from "lucide-react";
import type { DateRange } from "react-day-picker";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import {
  dateToIso,
  formatDateRange,
  isoDateIn,
  isoToDate,
  monthStartIso,
  shiftIsoDate,
} from "@/lib/datetime";

/* payments-and-classes D4 (2026-09-02 revision): the date filter is a
   calendar of our own. Bottom sheet under `sm`, popover above — two
   triggers, CSS shows one (the a11y D5 precedent: both navs in the DOM,
   one visible), one draft, one calendar body. Radix mounts only the
   container that opens, so the DOM carries no second calendar.

   The draft is staged: closing discards it, Aplicar commits it, Limpiar
   clears and commits in one tap. A preset is a complete answer and
   applies on the spot. One day picked + Aplicar is that one day — a
   premature Aplicar must never widen the filter in silence. */

type Props = {
  from: string;
  to: string;
  onChange: (from: string, to: string) => void;
  timezone: string;
  /* the business's "today" when the feed has said it; the clock otherwise */
  todayMs?: number | null;
};

type Preset = { label: string; from: string; to: string };

function presetsFor(today: string): Preset[] {
  return [
    { label: "Hoy", from: today, to: today },
    { label: "Últimos 7 días", from: shiftIsoDate(today, -6), to: today },
    { label: "Este mes", from: monthStartIso(today), to: today },
  ];
}

function toRange(from: string, to: string): DateRange | undefined {
  if (!from && !to) return undefined;
  return { from: isoToDate(from || to), to: isoToDate(to || from) };
}

function RangeBody({
  draft,
  setDraft,
  today,
  onApply,
  onClear,
  onPreset,
}: {
  draft: DateRange | undefined;
  setDraft: (r: DateRange | undefined) => void;
  today: string;
  onApply: () => void;
  onClear: () => void;
  onPreset: (p: Preset) => void;
}) {
  const preview =
    draft?.from &&
    formatDateRange(dateToIso(draft.from), dateToIso(draft.to ?? draft.from));
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-2" role="group" aria-label="Rangos rápidos">
        {presetsFor(today).map((p) => (
          <Button size="compact" key={p.label} type="button" variant="secondary" className="h-11 sm:h-9" onClick={() => onPreset(p)}>
            {p.label}
          </Button>
        ))}
      </div>
      <Calendar
        mode="range"
        selected={draft}
        onSelect={setDraft}
        defaultMonth={draft?.from ?? isoToDate(today)}
        /* a payment cannot arrive tomorrow; the boundary is the business's */
        disabled={{ after: isoToDate(today) }}
      />
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground" aria-live="polite">
          {preview ?? "Elige un día o un rango."}
        </p>
        <div className="flex gap-2">
          <Button size="compact" type="button" variant="secondary" className="h-11 sm:h-10" onClick={onClear}>
            Limpiar
          </Button>
          <Button size="compact" type="button" className="h-11 sm:h-10" onClick={onApply}>
            Aplicar
          </Button>
        </div>
      </div>
    </div>
  );
}

export function DateRangeField({ from, to, onChange, timezone, todayMs }: Props) {
  const [sheetOpen, setSheetOpen] = useState(false);
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [draft, setDraft] = useState<DateRange | undefined>(undefined);
  const today = isoDateIn(timezone, todayMs ?? Date.now());
  const label = formatDateRange(from, to) ?? "Fechas";

  const close = () => {
    setSheetOpen(false);
    setPopoverOpen(false);
  };
  const open = (set: (v: boolean) => void) => (next: boolean) => {
    if (next) setDraft(toRange(from, to));
    set(next);
  };
  const apply = () => {
    if (draft?.from) onChange(dateToIso(draft.from), dateToIso(draft.to ?? draft.from));
    else onChange("", "");
    close();
  };
  const clear = () => {
    onChange("", "");
    close();
  };
  const preset = (p: Preset) => {
    onChange(p.from, p.to);
    close();
  };

  const trigger = (
    <>
      <CalendarDays className="size-4" aria-hidden />
      {label}
    </>
  );
  const body = (
    <RangeBody draft={draft} setDraft={setDraft} today={today} onApply={apply} onClear={clear} onPreset={preset} />
  );

  return (
    <>
      <Sheet open={sheetOpen} onOpenChange={open(setSheetOpen)}>
        <SheetTrigger asChild>
          <Button size="compact" type="button" variant="secondary" className="h-11 sm:hidden">
            {trigger}
          </Button>
        </SheetTrigger>
        <SheetContent aria-describedby={undefined}>
          <SheetTitle className="mb-4 text-base font-semibold">Fechas</SheetTitle>
          {body}
        </SheetContent>
      </Sheet>
      <Popover open={popoverOpen} onOpenChange={open(setPopoverOpen)}>
        <PopoverTrigger asChild>
          <Button size="compact" type="button" variant="secondary" className="hidden sm:inline-flex">
            {trigger}
          </Button>
        </PopoverTrigger>
        <PopoverContent aria-label="Fechas">{body}</PopoverContent>
      </Popover>
    </>
  );
}
