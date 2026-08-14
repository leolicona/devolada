/* The shadcn CLI writes `import { cn } from "@/lib/utils"` into every
   primitive it generates. The helper itself lives in the package that
   owns the tokens (store-pwa/shell.spec.md D6); this is the alias the
   generated code expects. */
export { cn } from "@devolada/ui";
