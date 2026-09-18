import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import { Input } from "@devolada/ui";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

/* A picker whose field is its own search box (searchable-picker D1).

   The catalogue's Select is right for a list you can read: three timezones,
   four roles. The bank vocabulary is 97 names, and a list that long is not
   read — it is searched. Typing filters it here, in the same input, and the
   arrows and Enter finish the job. Measured 2026-09-18 against the ranking in
   D2: every bank reaches the visible rows within 4 characters, 76 of the 97
   within one.

   It commits ONLY a name from the vocabulary it was given, and every way out
   puts the committed name back (searchable-picker D3). A half-typed fragment
   left sitting in the field reads exactly like a choice that was made, and
   for the bank that is the difference between a payment and a silent false
   rejection: the name travels as `beneficiary.bank` on every validation the
   business ever runs, and apiCEP answers `invalid` — never an error — for one
   it does not know (direct-payment D16, measured 2026-08-19 in banks.ts).

   ARIA 1.2 combobox with a listbox popup (searchable-picker D6): the role is
   on the input, the popup is owned by `aria-controls` only while it is open,
   and the highlighted option is named by `aria-activedescendant` — `axe` runs
   on every admin screen and this is the shape it checks. */

/* Accent- and case-insensitive (searchable-picker D2): "banorte" finds
   BANORTE and "méxico" finds BBVA MEXICO, on a keyboard with or without dead
   keys. Fuzzy matching was rejected with it — tolerating a typo means
   offering a name nobody typed, in the one field where a near miss is what
   fails payments. */
function normalize(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

export interface ComboboxProps {
  id?: string;
  /* The accessible name, for the input and for its listbox. */
  label: string;
  /* The committed choice; "" when there is none yet. */
  value: string;
  onValueChange: (value: string) => void;
  options: readonly string[];
  placeholder?: string;
  emptyMessage?: string;
  className?: string;
  disabled?: boolean;
}

export function Combobox({
  id,
  label,
  value,
  onValueChange,
  options,
  placeholder,
  emptyMessage = "Sin resultados",
  className,
  disabled,
}: ComboboxProps) {
  const generated = useId();
  const listId = `${id ?? generated}-list`;
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const anchorRef = useRef<HTMLDivElement>(null);

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState(value);
  const [active, setActive] = useState(0);

  /* The CLABE's prefix picks the bank while the owner types it
     (business-and-memberships D5), so the field has to follow a value it
     did not choose itself. */
  useEffect(() => setQuery(value), [value]);

  /* Sitting on the committed choice is not a search (searchable-picker D4):
     the whole list stays open so the next name is one arrow away. Filtering
     down to the name already chosen would open a one-item list and make the
     next bank feel unreachable — the very feeling this control removes. */
  const matches = useMemo(() => {
    const q = normalize(query.trim());
    if (!q || query === value) return [...options];
    const starts: string[] = [];
    const contains: string[] = [];
    for (const option of options) {
      const candidate = normalize(option);
      if (candidate.startsWith(q)) starts.push(option);
      else if (candidate.includes(q)) contains.push(option);
    }
    /* What you typed the start of comes first (searchable-picker D2) —
       "ban" should open on BANAMEX, not on the first name that happens to
       contain it. */
    return [...starts, ...contains];
  }, [options, query, value]);

  useEffect(() => {
    if (!open) return;
    listRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: "nearest" });
  }, [active, open, matches]);

  function openWith(nextActive: number) {
    setActive(nextActive);
    setOpen(true);
  }

  function commit(next: string) {
    onValueChange(next);
    setQuery(next);
    setOpen(false);
    inputRef.current?.focus();
  }

  /* Closing always restores the committed name (searchable-picker D3).
     Committing the highlighted name on the way out is the common alternative
     and is wrong here: it turns "I changed my mind and tabbed away" into a
     saved bank nobody chose. */
  function close() {
    setOpen(false);
    setQuery(value);
  }

  function move(delta: number) {
    if (matches.length === 0) return;
    setActive((current) => (current + delta + matches.length) % matches.length);
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (!next) close();
      }}
    >
      <PopoverAnchor asChild>
        <div className="relative" ref={anchorRef}>
          <Input
            size="compact"
            ref={inputRef}
            id={id}
            role="combobox"
            aria-label={label}
            aria-expanded={open}
            aria-controls={open && matches.length > 0 ? listId : undefined}
            aria-activedescendant={open && matches[active] ? `${listId}-${active}` : undefined}
            aria-autocomplete="list"
            autoComplete="off"
            disabled={disabled}
            placeholder={placeholder}
            className={cn("pr-9", className)}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              openWith(0);
            }}
            onPointerDown={() => {
              if (disabled) return;
              /* Opening on a click, never on focus (searchable-picker D9):
                 tabbing through a form must not leave a list hanging open
                 behind the next field. */
              openWith(Math.max(0, matches.indexOf(value)));
              inputRef.current?.select();
            }}
            onBlur={close}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                e.preventDefault();
                if (!open) openWith(Math.max(0, matches.indexOf(value)));
                else move(e.key === "ArrowDown" ? 1 : -1);
              } else if (e.key === "Home" || e.key === "End") {
                if (!open) return;
                e.preventDefault();
                setActive(e.key === "Home" ? 0 : matches.length - 1);
              } else if (e.key === "Enter") {
                /* Only while the list is open, so Enter still submits the
                   form it sits in (the top-up's). */
                if (!open || !matches[active]) return;
                e.preventDefault();
                commit(matches[active]);
              } else if (e.key === "Escape") {
                if (!open) return;
                e.preventDefault();
                close();
              } else if (e.key === "Tab") {
                close();
              }
            }}
          />
          <ChevronDown
            className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-ink-faint"
            aria-hidden
          />
        </div>
      </PopoverAnchor>
      <PopoverContent
        align="start"
        sideOffset={4}
        /* searchable-picker D6: Radix gives its content `role="dialog"`. A
           combobox's popup is not a dialog — it is the listbox below, which
           `aria-controls` already names; an unnamed dialog wrapping it is
           what axe reports and what a screen reader would announce instead
           of the options. */
        role="presentation"
        /* searchable-picker D5: bounded by the space the popup actually has,
           never by a number alone. 18rem is the reading size — about eight
           rows, which is what SC-001's "within 4 characters" was measured
           against — and the available height is what keeps it inside a short
           window. A fixed cap alone is the mistake that made the panel's
           other dropdown unreachable (bug: bank-picker-unreachable). */
        className="max-h-[min(18rem,var(--radix-popover-content-available-height))] w-[var(--radix-popover-trigger-width)] overflow-y-auto p-1"
        /* The input keeps the keyboard the whole time: it is the control. */
        onOpenAutoFocus={(e) => e.preventDefault()}
        onCloseAutoFocus={(e) => e.preventDefault()}
        onInteractOutside={(e) => {
          if (anchorRef.current?.contains(e.target as Node)) e.preventDefault();
        }}
      >
        {matches.length === 0 ? (
          <p className="px-3 py-2 text-sm text-ink-soft">{emptyMessage}</p>
        ) : (
          <ul ref={listRef} id={listId} role="listbox" aria-label={label}>
            {matches.map((option, index) => (
              <li
                key={option}
                id={`${listId}-${index}`}
                role="option"
                aria-selected={option === value}
                data-active={index === active}
                className={cn(
                  "flex cursor-default items-center justify-between gap-3 rounded-sm px-3 py-2 text-sm text-ink",
                  index === active && "bg-well",
                )}
                /* Never let the field lose focus to the list: the blur that
                   would follow closes it (D3) before the click can land. */
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => commit(option)}
                onMouseEnter={() => setActive(index)}
              >
                {option}
                {option === value && <Check className="size-4 shrink-0 text-link" aria-hidden />}
              </li>
            ))}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  );
}
