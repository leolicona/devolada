import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { CreateLinkResponse, CustomerRow } from "@devolada/api/direct-payments-schema";
import { api, ApiError } from "@/lib/api";
import { readMarks, rowKey, writeMark, type Mark } from "./seen";

/* links-on-demand-search US1: the act.

   Copiar and WhatsApp are the same rule wearing two faces (D8, FR-008):
   the link is created by the press, or the one that exists is used. A
   row that already carries its link pays nothing — `POST` is the door
   only for a customer who has none yet.

   The screen renders what happened from `stateOf`, and the mark itself
   lives in `sessionStorage` for the operator who acted (FR-022, D11).
   Devolada records no delivery: "Enviado" means "you pressed it", and
   it is promised to nobody else. */

export type ActionState = "idle" | "working" | "copied" | "sent" | "failed" | "not_copied";

/* How long the answer stays on the button before the row goes quiet
   again. The MARK survives the session; this is just the confirmation. */
const CONFIRM_MS = 2_000;

type Acted = { url: string; waLink: string };

export function useLinkAction() {
  const client = useQueryClient();
  /* The links this session created, so a second press on the same row
     costs no second call and never a second link (FR-005, FR-009) */
  const [acted, setActed] = useState<Record<string, Acted>>({});
  const [state, setState] = useState<Record<string, ActionState>>({});
  const [marks, setMarks] = useState<Record<string, Mark>>(() => readMarks());
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  useEffect(() => {
    const running = timers.current;
    return () => {
      for (const timer of Object.values(running)) clearTimeout(timer);
    };
  }, []);

  const settle = useCallback((key: string, next: ActionState) => {
    setState((all) => ({ ...all, [key]: next }));
    clearTimeout(timers.current[key]);
    timers.current[key] = setTimeout(() => {
      setState((all) => {
        const { [key]: _gone, ...rest } = all;
        return rest;
      });
    }, CONFIRM_MS);
  }, []);

  const mark = useCallback((key: string, value: Mark) => {
    writeMark(key, value);
    setMarks((all) => ({ ...all, [key]: value }));
  }, []);

  const create = useCallback(
    async (key: string, usuario: string): Promise<Acted> => {
      const link = await api<CreateLinkResponse>("/direct-payments/links", {
        method: "POST",
        body: JSON.stringify({ usuario }),
      });
      const born = { url: link.url, waLink: link.waLink };
      setActed((all) => ({ ...all, [key]: born }));
      /* The row now has a link. Nothing on screen needs to move, but a
         later block read should not claim otherwise. */
      void client.invalidateQueries({ queryKey: ["links-customers"], refetchType: "none" });
      return born;
    },
    [client],
  );

  const linkOf = useCallback(
    (row: CustomerRow): Acted | null => {
      const key = rowKey(row);
      if (acted[key]) return acted[key];
      return row.url && row.waLink ? { url: row.url, waLink: row.waLink } : null;
    },
    [acted],
  );

  const copy = useCallback(
    async (row: CustomerRow) => {
      const key = rowKey(row);
      setState((all) => ({ ...all, [key]: "working" }));
      try {
        const link = linkOf(row) ?? (await create(key, row.usuario ?? ""));
        await navigator.clipboard.writeText(link.url);
        mark(key, "copied");
        settle(key, "copied");
      } catch (e) {
        /* A clipboard the browser refused and a door that failed read
           differently to the operator: one is "press again", the other
           is "something is wrong with the link". */
        settle(key, e instanceof ApiError ? "failed" : "not_copied");
      }
    },
    [create, linkOf, mark, settle],
  );

  const send = useCallback(
    async (row: CustomerRow) => {
      const key = rowKey(row);
      const known = linkOf(row);
      if (known) {
        /* Nothing to wait for: the click itself opens the window */
        window.open(known.waLink, "_blank", "noopener,noreferrer");
        mark(key, "sent");
        settle(key, "sent");
        return;
      }

      /* D9: the link does not exist yet, so there is an await between
         the click and the URL — and a browser blocks `window.open`
         called after one, because the click is no longer its cause. So
         the window opens NOW, blank, and its location is set when the
         answer lands. This is the one place where "create on act" meets
         a browser rule, and it is a silent bug in every browser if it
         is not written down.

         `noopener` is deliberately absent: passing it makes `open`
         return null by specification, and the handle is the whole
         point. The opener is dropped by hand instead. */
      const opened = window.open("about:blank", "_blank");
      if (opened) opened.opener = null;
      setState((all) => ({ ...all, [key]: "working" }));
      try {
        const link = await create(key, row.usuario ?? "");
        if (opened) opened.location.href = link.waLink;
        else window.open(link.waLink, "_blank", "noopener,noreferrer");
        mark(key, "sent");
        settle(key, "sent");
      } catch {
        /* A blank tab left open is worse than no tab: close it and say
           so on the row */
        opened?.close();
        settle(key, "failed");
      }
    },
    [create, linkOf, mark, settle],
  );

  return {
    copy,
    send,
    /* What the row shows right now, and what it remembers from earlier
       in this session (FR-022) */
    stateOf: (row: CustomerRow): ActionState => state[rowKey(row)] ?? "idle",
    markOf: (row: CustomerRow): Mark | null => marks[rowKey(row)] ?? null,
  };
}
