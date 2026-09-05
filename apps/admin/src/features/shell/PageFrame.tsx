import type { ReactNode } from "react";
import { Card, Skeleton } from "@devolada/ui";
import { cn } from "@/lib/utils";

/* The frame Pagos, Cobros and Links share (espaciado-y-tipografía review
   D1, findings E1/E2/E4). It owns two things and no more: `main`'s
   padding — the bottom included, which Pagos and Cobros had at 0, so a
   full list ended on the viewport's last pixel — and the one vertical
   ladder between a page's blocks. The filters and the list stay each
   page's business; only the rhythm is shared, because three pages of one
   archetype had picked three (16/16/24px under the title, mt-3/mt-4/mt-6
   between blocks, and Pagos disagreeing with itself by 8px depending on
   whether its list was empty).

   The cap on the content width is not here: it lives once in `Shell`
   (design-review D5). */

/* 24px, the ladder. Exported because a Tabs panel is a page block that
   holds page blocks, and it must not invent a fourth number. */
export const PAGE_STACK = "space-y-6";

export function PageFrame({
  title,
  actions,
  children,
  className,
}: {
  title: string;
  /* What sits opposite the title: a total, a freshness label, Actualizar */
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <main className={cn("px-4 pb-8 pt-4 lg:px-8 lg:pt-8", className)}>
      <div className={PAGE_STACK}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-xl font-semibold">{title}</h1>
          {actions}
        </div>
        {children}
      </div>
    </main>
  );
}

/* The placeholder for a list of rows, in the list's own geometry (E4).
   The three skeletons were a `Card p-4` of `py-3` rows against a padded
   list of `p-4` rows: 60px where the row is 72, plus 16px of padding the
   real card does not have, so every row landed 12px from where it was
   drawn. Here the shape is the row's: no padding on the card, `p-4` per
   row, a 40px identity column (two lines of `text-sm`), and the same
   divider. `trailing` is what the page puts at the row's end — a badge
   and an amount, an amount alone, a button. */
export function ListSkeleton({ rows = 3, leading, trailing }: { rows?: number; leading?: ReactNode; trailing?: ReactNode }) {
  return (
    <Card className="overflow-hidden">
      <div className="divide-y divide-line-soft">
        {Array.from({ length: rows }, (_, k) => (
          <div key={k} className="flex items-center gap-4 p-4">
            {leading}
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-4 w-28" />
            </div>
            {trailing}
          </div>
        ))}
      </div>
    </Card>
  );
}
