import { describe, expect, it } from "vitest";
import { delay } from "msw";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { businessActor, handlers, ok, server } from "./msw";
import { renderApp } from "./render";

/* feedback-vocabulary-rollout US1 — a wait is stated in words, and stated once.

   The ownership rule (D4): a screen's load is announced by the screen, naming
   what is loading; an action the operator started is announced at the control
   they used; a region nested inside one that already announces stays silent.

   The failure this guards against is not silence — it is TWO voices. A screen
   that owns a live region of its own plus a pending region that always renders
   one leaves a screen-reader user hearing the same state twice, or reaching an
   empty region instead of the note they needed. */

const members = {
  members: [
    { id: "m-owner", userId: "user-1", name: "Leo", email: "demo@devolada.app", role: "owner", createdAt: 1 },
    { id: "m-op", userId: "user-2", name: "Ana López", email: "ana@wifiplus.mx", role: "operator", createdAt: 2 },
  ],
  grantable: ["owner", "admin", "operator", "viewer"],
};

const invitation = {
  id: "inv-1",
  email: "nuevo@wifiplus.mx",
  role: "operator",
  createdAt: 1,
  expiresAt: 2,
};

const liveRegions = () => Array.from(document.querySelectorAll("[aria-live]"));

describe("feedback-vocabulary-rollout US1: one wait, one voice", () => {
  it("names what is loading, in one region, while the screen loads", async () => {
    server.use(
      handlers.session(() => ok(businessActor)),
      handlers.members(async () => {
        await delay(400);
        return ok(members);
      }),
    );
    renderApp("/settings/users");

    /* Past the flash threshold, the region speaks. */
    await waitFor(() => {
      const speaking = liveRegions().filter((el) => el.textContent?.trim());
      expect(speaking).toHaveLength(1);
      expect(speaking[0]).toHaveTextContent(/cargando el equipo/i);
    });

    await screen.findByText("Ana López");
  });

  it("goes quiet once the wait is over, so the screen's own regions are alone", async () => {
    server.use(
      handlers.session(() => ok(businessActor)),
      handlers.members(() => ok(members)),
    );
    renderApp("/settings/users");
    await screen.findByText("Ana López");

    /* Not "the region is empty" — the region is GONE, and the assertion has to
       say so. Filtering to regions that are SPEAKING would pass just as
       happily with an idle empty one still in the DOM, which is the exact
       thing that made findByRole reach the wrong element on the charge feed
       and the client roster.

       Verified by mutation: make Pending render its live region
       unconditionally again and this turns red. */
    await waitFor(() => {
      expect(liveRegions()).toHaveLength(0);
    });
  });

  it("announces a started action at its own control, and only that one", async () => {
    server.use(
      handlers.session(() => ok(businessActor)),
      /* A pending invitation gives the screen a plain button whose only signal
         until now was being disabled with its word changed. */
      handlers.members(() => ok({ ...members, pending: [invitation] })),
      handlers.resendInvitation(async () => {
        await delay(400);
        return ok({ id: "inv-1" });
      }),
    );
    renderApp("/settings/users");
    await screen.findByText("nuevo@wifiplus.mx");

    await userEvent.click(screen.getByRole("button", { name: /reenviar/i }));

    await waitFor(() => {
      const speaking = liveRegions().filter((el) => el.textContent?.trim());
      /* One voice, and it is the resend's — not the screen's, which finished
         loading long ago. */
      expect(speaking).toHaveLength(1);
      expect(speaking[0]).toHaveTextContent(/reenviando la invitación/i);
    });
  });
});
