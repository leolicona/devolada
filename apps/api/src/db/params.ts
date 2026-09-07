/* D1 binds at most 100 parameters per statement (D1 limits, "Maximum
   bound parameters per query"). A tenant-wide `IN (…)` or a multi-row
   INSERT over the roster crosses that line with a few dozen customers,
   and the local D1 the suite runs on (workerd's SQLite) does not enforce
   it — so a regression here is invisible to the tests. Every statement
   that grows with the tenant goes through `chunks` (BUG-021). */
export const D1_MAX_PARAMS = 100;

export function chunks<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
