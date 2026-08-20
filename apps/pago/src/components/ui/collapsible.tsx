import * as CollapsiblePrimitive from "@radix-ui/react-collapsible";

/* shadcn Collapsible on Radix, same copy as the admin's (FRONTEND.md:
   the primitive is copied per surface until a second one needs it —
   this is that second one, but the admin's alias layer is not here, so
   the trigger is styled by the caller in token utilities). */

export const Collapsible = CollapsiblePrimitive.Root;
export const CollapsibleTrigger = CollapsiblePrimitive.Trigger;
export const CollapsibleContent = CollapsiblePrimitive.Content;
