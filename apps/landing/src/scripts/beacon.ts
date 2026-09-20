import { API_URL } from "../lib/urls";

/* The page's counting (landing-page D8; FR-023): two events into three
   aggregate steps — `visit` once the page has loaded, `began` on the first
   focus inside either form, once per page load. `sent` is the API's to
   count. Nothing is stored in the browser and no cookie is set (SC-010);
   the channel is read from the hidden input the Worker filled (D4).

   `mode: "no-cors"` with a form-encoded body is a simple request: no
   preflight, and no dependency on the API's origin list; `keepalive` lets
   it survive a navigation. Failures are swallowed — a blocked or lost
   beacon must never disturb the page. */
const channel = () => document.querySelector<HTMLInputElement>('input[name="channel"]')?.value ?? "";

function send(step: "visit" | "began"): void {
  const body = new URLSearchParams({ step, channel: channel() }).toString();
  fetch(`${API_URL}/landing/events`, {
    method: "POST",
    mode: "no-cors",
    keepalive: true,
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  }).catch(() => {});
}

export function sendVisit(): void {
  const go = () => ("requestIdleCallback" in window ? window.requestIdleCallback(() => send("visit")) : setTimeout(() => send("visit"), 0));
  if (document.readyState === "complete") go();
  else window.addEventListener("load", go, { once: true });
}

let began = false;
export function watchBegan(forms: Iterable<HTMLFormElement>): void {
  for (const form of forms) {
    form.addEventListener("focusin", () => {
      if (began) return;
      began = true;
      send("began");
    });
  }
}
