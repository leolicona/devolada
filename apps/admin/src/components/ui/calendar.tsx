import { ChevronLeft, ChevronRight } from "lucide-react";
import { DayPicker, type DayPickerProps } from "react-day-picker";
import { es } from "react-day-picker/locale";
import { cn } from "@/lib/utils";

/* shadcn Calendar on react-day-picker, themed by tokens — and es-MX by
   construction, which is the whole reason it exists: the native date
   input renders `mm/dd/yyyy` whatever `lang` says (measured 2026-09-02,
   payments-and-classes D4). Every class below is ours; the library's
   stylesheet is not imported. Day cells are 44px under `sm` (a finger),
   36px above (a pointer) — the same rule the chips follow. */

const cell = "size-11 sm:size-9";

export function Calendar({ className, classNames, ...props }: DayPickerProps) {
  return (
    <DayPicker
      locale={es}
      showOutsideDays
      className={cn("select-none", className)}
      classNames={{
        root: "relative",
        months: "flex flex-col gap-4 sm:flex-row",
        month: "flex flex-col gap-3",
        month_caption: "flex h-11 items-center justify-center sm:h-9",
        caption_label: "text-sm font-medium capitalize",
        nav: "absolute inset-x-0 top-0 flex h-11 items-center justify-between sm:h-9",
        button_previous:
          "flex size-11 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40 sm:size-9",
        button_next:
          "flex size-11 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40 sm:size-9",
        month_grid: "w-full border-collapse",
        weekdays: "flex",
        weekday: cn(cell, "text-center text-xs font-normal capitalize text-muted-foreground"),
        week: "mt-1 flex",
        day: cn(cell, "relative p-0 text-center text-sm"),
        day_button: cn(cell, "rounded-full font-normal transition-colors hover:bg-muted"),
        /* the library marks every day of a range `selected`, so the strong
           fill lives on the ends only; the band is the cell behind, round
           on its outer side — a one-day range is both ends and comes out
           a full circle */
        selected: "",
        range_start:
          "rounded-l-full bg-accent-soft [&>button]:bg-primary [&>button]:text-primary-foreground [&>button]:hover:bg-primary",
        range_end:
          "rounded-r-full bg-accent-soft [&>button]:bg-primary [&>button]:text-primary-foreground [&>button]:hover:bg-primary",
        range_middle:
          "rounded-none bg-accent-soft text-foreground [&>button]:rounded-none [&>button]:bg-transparent [&>button]:hover:bg-accent-soft",
        today: "font-semibold text-link",
        outside: "text-ink-faint",
        disabled: "text-ink-faint opacity-40 [&>button]:hover:bg-transparent",
        hidden: "invisible",
        ...classNames,
      }}
      components={{
        Chevron: ({ orientation, className: c }) =>
          orientation === "left" ? (
            <ChevronLeft className={cn("size-5", c)} aria-hidden />
          ) : (
            <ChevronRight className={cn("size-5", c)} aria-hidden />
          ),
      }}
      {...props}
    />
  );
}
