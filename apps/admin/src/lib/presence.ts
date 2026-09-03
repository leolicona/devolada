import { useSyncExternalStore } from "react";

/* presence-freshness (US-P07): the signals that replaced the
   "Actualizar" button. A read screen that mirrors a provider refreshes
   when someone is looking at it, and never while nobody is.

   D2 — present = the tab is visible AND the last pointer, key, scroll
   or touch was under IDLE_MS ago. TanStack pauses intervals on a hidden
   tab by itself; the idle guard is what "someone is here" means on a
   monitor nobody touches. One store for the whole app, installed the
   first time a screen asks. */

export const HEARTBEAT_MS = 3 * 60_000;
export const IDLE_MS = 5 * 60_000;
export const PULSE_MS = 30_000;
/* D3: under this, the API's display cache answers the same bytes */
export const FOCUS_FLOOR_MS = 30_000;
const MOVE_THROTTLE_MS = 1_000;

let lastInteraction = Date.now();
let present = true;
let installed = false;
let idleTimer: ReturnType<typeof setTimeout> | undefined;
const listeners = new Set<() => void>();

function compute(): boolean {
  const visible = typeof document === "undefined" || document.visibilityState !== "hidden";
  return visible && Date.now() - lastInteraction < IDLE_MS;
}

function recompute() {
  const next = compute();
  if (next === present) return;
  present = next;
  for (const l of listeners) l();
}

function armIdle() {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(recompute, IDLE_MS + 50);
}

function touch(e: Event) {
  const now = Date.now();
  if (e.type === "pointermove" && now - lastInteraction < MOVE_THROTTLE_MS) return;
  lastInteraction = now;
  armIdle();
  recompute();
}

function install() {
  if (installed || typeof document === "undefined") return;
  installed = true;
  const opts: AddEventListenerOptions = { passive: true, capture: true };
  for (const type of ["pointerdown", "pointermove", "keydown", "scroll", "touchstart"]) {
    document.addEventListener(type, touch, opts);
  }
  document.addEventListener("visibilitychange", recompute);
  armIdle();
}

function subscribe(listener: () => void) {
  install();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const getSnapshot = () => present;
const getServerSnapshot = () => true;

export function usePresence(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

/* The query options a live read carries (D3, D4). `present` comes from
   `usePresence()` so the interval re-arms when presence changes; the
   function form of `refetchInterval` is re-evaluated on every query
   update, which is how a failed background read switches the heartbeat
   off until the next signal. */
/* The slice of TanStack's `Query` the options read — structural, so the
   same options fit every typed `useQuery` */
type LiveQuery = { state: { status: "pending" | "error" | "success"; dataUpdatedAt: number } };

export function liveReadOptions(present: boolean, intervalMs = HEARTBEAT_MS) {
  return {
    refetchInterval: (query: LiveQuery) =>
      present && query.state.status !== "error" ? intervalMs : false,
    refetchIntervalInBackground: false,
    /* "always" ignores staleTime — the 2-minute memory is for navigation
       inside the app, not for the return from WispHub's own tab */
    refetchOnWindowFocus: (query: LiveQuery) =>
      Date.now() - query.state.dataUpdatedAt >= FOCUS_FLOOR_MS ? ("always" as const) : false,
  };
}

/* Tests only: presence is module state and outlives a test's render */
export function resetPresenceForTests() {
  lastInteraction = Date.now();
  present = compute();
}
