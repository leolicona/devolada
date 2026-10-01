import { useState } from "react";
import { Button, cn } from "@devolada/ui";
import { CheckCircle2, Copy } from "lucide-react";

/* Transfer apps want paste, so every SPEI value carries a copy button. */
export function CopyButton({
  value,
  text = "Copiar",
  /* What the button says for a moment after copying — "Copiado", or
     "Copiada" for the reference (confirmation-hierarchy D19) */
  copied: copiedText = "Copiado",
  /* Read by assistive tech only. Several buttons on the card show the
     same word, and the field name is what tells them apart — appended
     rather than substituted, so the visible text stays the start of the
     accessible name (WCAG 2.5.3). */
  srSuffix,
  variant = "secondary",
  className,
}: {
  value: string;
  text?: string;
  copied?: string;
  srSuffix?: string;
  variant?: "secondary" | "ghost";
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      variant={variant}
      className={cn("h-10 shrink-0 px-3 text-sm", className)}
      onClick={() => {
        void navigator.clipboard?.writeText(value);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }}
    >
      {copied ? <CheckCircle2 className="size-4" aria-hidden /> : <Copy className="size-4" aria-hidden />}
      {copied ? copiedText : text}
      {srSuffix && <span className="sr-only"> {srSuffix}</span>}
    </Button>
  );
}
