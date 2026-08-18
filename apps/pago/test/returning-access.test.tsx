import { beforeEach, describe, expect, it } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { linkStatusResponse } from "@devolada/api/direct-payments-schema";
import { App } from "../src/App";
import { readLinks } from "../src/links";
import { fail, handlers, ok, server } from "./msw";

/* docs/direct-payment/returning-customer-access.spec.md scenarios 1–5
   (US-D08). Phase 1 adds no endpoint: everything here is the device
   remembering what it was already given. */

function renderAt(path: string) {
  window.history.pushState({}, "", path);
  render(<App />);
}

const linkFor = (customerName: string) =>
  linkStatusResponse.parse({
    ispName: "WifiPlus",
    customerName,
    status: "debt",
    monthlyFeeCents: 49900,
    serviceFeeCents: 1500,
    totalCents: 51400,
    speiClabe: "646180157000000004",
    speiBank: "STP",
    speiBeneficiaryName: "WifiPlus SA de CV",
    reference: "greyes@wifiplus",
  });

beforeEach(() => {
  window.localStorage.clear();
});

describe("US-D08: the device remembers the link it was handed", () => {
  it("scenario 1: after opening a link, the bare origin lands on that page", async () => {
    server.use(handlers.link(() => ok(linkFor("Janely"))));
    renderAt("/p/tok2345abcdefgh2");
    /* the payment page renders, and saving happens without being asked */
    expect(await screen.findByText("646180157000000004")).toBeInTheDocument();
    await waitFor(() => expect(readLinks()).toHaveLength(1));

    /* next month: no path, no message from the ISP */
    window.history.pushState({}, "", "/");
    render(<App />);
    expect(await screen.findAllByText("646180157000000004")).not.toHaveLength(0);
    expect(window.location.pathname).toBe("/p/tok2345abcdefgh2");
  });

  it("scenario 2: a device that never held a link is told to ask its ISP", async () => {
    renderAt("/");
    expect(
      await screen.findByText(/aún no tienes un link de pago guardado en este dispositivo/i),
    ).toBeInTheDocument();
    /* D1: no lookup field may exist on this page */
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.queryByRole("searchbox")).not.toBeInTheDocument();
  });

  it("scenario 5: a link the ISP deleted is dropped", async () => {
    window.localStorage.setItem(
      "devolada-pago-links",
      JSON.stringify([{ token: "tokdeleted111111", name: "Janely" }]),
    );
    server.use(handlers.link(() => fail("NOT_FOUND", 404)));
    renderAt("/p/tokdeleted111111");

    expect(await screen.findByText(/este link de pago no existe/i)).toBeInTheDocument();
    await waitFor(() => expect(readLinks()).toHaveLength(0));
  });

  it("scenario 5: an outage does not erase the way back", async () => {
    window.localStorage.setItem(
      "devolada-pago-links",
      JSON.stringify([{ token: "tokoutage2222222", name: "Janely" }]),
    );
    server.use(handlers.link(() => fail("WISPHUB_UNAVAILABLE", 503)));
    renderAt("/p/tokoutage2222222");

    expect(await screen.findByText(/no pudimos consultar tu cuenta/i)).toBeInTheDocument();
    /* the account still exists; only the lookup failed */
    expect(readLinks()).toHaveLength(1);
  });
});

describe("US-D08: one phone, two services", () => {
  beforeEach(() => {
    window.localStorage.setItem(
      "devolada-pago-links",
      JSON.stringify([
        { token: "tok2345abcdefgh2", name: "Janely" },
        { token: "tok9876zyxwvuts9", name: "Don Chuy" },
      ]),
    );
  });

  it("scenario 3: the bare origin lists both and opens the one picked", async () => {
    server.use(handlers.link(() => ok(linkFor("Don Chuy"))));
    renderAt("/");

    expect(await screen.findByText(/¿de quién es el pago\?/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Janely/ })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /^Don Chuy/ }));
    expect(await screen.findByText("646180157000000004")).toBeInTheDocument();
    expect(window.location.pathname).toBe("/p/tok9876zyxwvuts9");
  });

  it("scenario 4: forgetting one leaves the other, and the origin redirects again", async () => {
    server.use(handlers.link(() => ok(linkFor("Don Chuy"))));
    renderAt("/");

    await userEvent.click(
      await screen.findByRole("button", { name: /este no es mi servicio de Janely/i }),
    );

    /* one left → straight through, the chooser is never shown again */
    expect(await screen.findByText("646180157000000004")).toBeInTheDocument();
    expect(window.location.pathname).toBe("/p/tok9876zyxwvuts9");
    expect(readLinks()).toEqual([{ token: "tok9876zyxwvuts9", name: "Don Chuy" }]);
  });
});
