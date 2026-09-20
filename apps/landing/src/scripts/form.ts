import { FLASH_THRESHOLD_MS, MINIMUM_VISIBLE_MS } from "@devolada/ui/motion";
import { API_URL } from "../lib/urls";
import { watchBegan } from "./beacon";

/* The page's one script (landing-page D7, D16; FR-016, FR-019–FR-021;
   contracts/landing-page.md, "The page's script").

   Without it the form still works: the browser posts it and the API
   answers with a page (D6). With it, three things improve: the browser's
   ValidityState becomes es-MX words next to the field the person has to
   fix, with everything else they typed kept (FR-020); the request goes as
   JSON and the outcome renders in place, so nobody leaves the page
   (FR-016); and the wait breathes on the shared thresholds (D16). No zod
   here — the field rules are the attributes the build stamped (D7) — and
   no copy is written by this file: every sentence it shows was rendered
   at build and is only revealed. No tag handling, no theme switch. */

type Outcome = "received" | "REQUEST_REFUSED" | "TOO_MANY_REQUESTS" | "VALIDATION_ERROR" | "unavailable";
const OUTCOMES: readonly Outcome[] = ["received", "REQUEST_REFUSED", "TOO_MANY_REQUESTS", "VALIDATION_ERROR", "unavailable"];

/* es-MX product copy for the browser's own verdicts (FR-020). One sentence
   per field: the person needs to know what to type, not which constraint
   they failed. */
const WHATSAPP_MESSAGE = "Escribe tu WhatsApp con lada, como 55 1234 5678.";
function messageFor(field: HTMLInputElement | HTMLSelectElement): string {
  const v = field.validity;
  if (field.name === "whatsapp") return WHATSAPP_MESSAGE;
  if (field.name === "name") return v.tooLong ? "Tu nombre es muy largo: hasta 80 letras." : "Escribe tu nombre completo, o déjalo vacío.";
  return "Revisa esta respuesta.";
}

const fieldsOf = (form: HTMLFormElement) =>
  Array.from(form.querySelectorAll<HTMLInputElement | HTMLSelectElement>("input[name], select[name]")).filter(
    (f) => f.type !== "hidden" && f.name !== "website",
  );

function clearErrors(form: HTMLFormElement): void {
  for (const field of fieldsOf(form)) field.removeAttribute("aria-invalid");
  for (const error of form.querySelectorAll<HTMLElement>("[data-error]")) {
    error.hidden = true;
    const text = error.querySelector<HTMLElement>("[data-error-text]");
    if (text) text.textContent = "";
  }
}

function showErrors(form: HTMLFormElement): void {
  let first: HTMLElement | null = null;
  for (const field of fieldsOf(form)) {
    if (field.validity.valid) continue;
    field.setAttribute("aria-invalid", "true");
    const error = form.querySelector<HTMLElement>(`[data-field="${field.name}"] [data-error]`);
    if (error) {
      const text = error.querySelector<HTMLElement>("[data-error-text]");
      if (text) text.textContent = messageFor(field);
      error.hidden = false;
    }
    first ??= field;
  }
  first?.focus();
}

function showOutcome(form: HTMLFormElement, outcome: Outcome): void {
  for (const id of OUTCOMES) {
    const box = form.querySelector<HTMLElement>(`[data-outcome-for="${id}"]`);
    if (box) box.hidden = id !== outcome;
  }
  /* FR-016: received asks for nothing further — the fields leave, the
     confirmation stays. A refusal keeps them, so the person can try again. */
  const fields = form.querySelector<HTMLElement>("[data-fields]");
  if (fields) fields.hidden = outcome === "received";
}

/* The waiting state (D16, constitution VI): the breath starts after the
   flash threshold and, once started, stays the minimum. The copy says the
   state; the animation only accompanies it. `data-motion="breath"` is
   what index.css's reduced-motion exception matches — the breath is
   opacity-only and keeps running there, so a working screen never reads
   as frozen. */
function sendingState(form: HTMLFormElement) {
  const region = form.querySelector<HTMLElement>("[data-sending]");
  const text = form.querySelector<HTMLElement>("[data-sending-text]");
  const button = form.querySelector<HTMLButtonElement>('button[type="submit"]');
  let shownAt: number | null = null;
  const timer = setTimeout(() => {
    shownAt = Date.now();
    region?.classList.add("animate-breath");
    region?.setAttribute("data-motion", "breath");
    region?.setAttribute("aria-busy", "true");
    if (text) text.hidden = false;
  }, FLASH_THRESHOLD_MS);
  if (button) button.disabled = true;
  return async () => {
    clearTimeout(timer);
    const since = shownAt;
    if (since !== null) await new Promise((r) => setTimeout(r, Math.max(0, MINIMUM_VISIBLE_MS - (Date.now() - since))));
    region?.classList.remove("animate-breath");
    region?.removeAttribute("data-motion");
    region?.removeAttribute("aria-busy");
    if (text) text.hidden = true;
    if (button) button.disabled = false;
  };
}

async function submit(form: HTMLFormElement): Promise<void> {
  clearErrors(form);
  if (!form.checkValidity()) {
    showErrors(form);
    return;
  }
  const data = new FormData(form);
  const body: Record<string, string> = {};
  for (const [key, value] of data.entries()) if (typeof value === "string") body[key] = value;

  const done = sendingState(form);
  let outcome: Outcome = "unavailable";
  try {
    const res = await fetch(`${API_URL}/landing/requests`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = (await res.json()) as { success: boolean; error?: { code?: string } };
    if (json.success) outcome = "received";
    else if (json.error?.code && (OUTCOMES as readonly string[]).includes(json.error.code)) outcome = json.error.code as Outcome;
  } catch {
    /* The product's services are unavailable (FR-021): the page says so
       and shows the address to write to; every word above still reads. */
  }
  await done();
  showOutcome(form, outcome);
}

export function wireRequestForms(): void {
  const forms = Array.from(document.querySelectorAll<HTMLFormElement>("form[data-form]"));
  for (const form of forms) {
    /* The browser's own bubbles step aside for the words next to the
       field; without this script they still do their job. */
    form.noValidate = true;
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      void submit(form);
    });
  }
  watchBegan(forms);
}
