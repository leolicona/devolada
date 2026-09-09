export { StatusBadge, type Status, type StatusBadgeProps } from "./components/status-badge";
export {
  AmountBreakdown,
  Amount,
  type AmountBreakdownProps,
  type BreakdownLine,
} from "./components/amount-breakdown";
export { formatMoney, parseMoney } from "./lib/money";
export { cn } from "./lib/cn";
export { Button, buttonVariants, type ButtonProps } from "./components/button";
export { Input, Field, type InputProps } from "./components/input";
export { ListError, type ListErrorProps } from "./components/list-error";

/* Primitives from the shadcn catalog, themed by tokens and shared
   because both surfaces use them (store-pwa/shell.spec.md D5). */
export { Alert, type AlertProps } from "./components/alert";
export {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  type CardProps,
} from "./components/card";
export { Skeleton } from "./components/skeleton";

/* The feedback vocabulary (design-foundations US1). `waiting` and `resolving`
   ship here; `entering`, `leaving` and `retrying` are 002's. */
export { Pending, type PendingProps } from "./components/pending";
export { Reveal, type RevealProps } from "./components/reveal";
