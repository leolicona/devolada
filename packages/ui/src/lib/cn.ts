import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/* Merge class names so the caller always wins (shell spec D6).
   Plain concatenation leaves `h-12 h-14` for the stylesheet order to
   settle; twMerge drops the loser. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
