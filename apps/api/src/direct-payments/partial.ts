/* What a transfer settles, and whether it earns the service back
   (partial-payment.spec.md D3, D4, D5, D6).

   WispHub keeps a running account, so a short payment is not a failure —
   it is money that arrived and has to land somewhere. The only question
   this file answers is where it lands and whether the router is told. */

export type Settlement = {
  /* Registered in WispHub, against the customer's debt. */
  ispRegisteredCents: number;
  /* Devolada's share of what arrived — last in the queue, on purpose. */
  feeReceivedCents: number;
  /* Still owed to the ISP after this payment. Zero means settled. */
  missingCents: number;
  /* Whether the payment reaches the ISP's bar for giving the service
     back — `accion: 1` when true, `accion: 0` when not. */
  reconnect: boolean;
  status: "confirmed" | "partial";
};

export function settle(input: {
  /* What the CEP says actually arrived. */
  receivedCents: number;
  /* The ISP's debt: pending invoices plus the carried balance. */
  ispDebtCents: number;
  serviceFeeCents: number;
  thresholdPercent: number;
  floorCents: number;
}): Settlement {
  const { receivedCents, ispDebtCents, serviceFeeCents, thresholdPercent, floorCents } = input;

  /* D3: the ISP's debt is paid first and Devolada's fee takes only what
     is left over, up to its own amount. Holding a customer's service
     hostage for our fee would make the support call cost more than the
     fee, and the fee is not the ISP's money to be short of. The same
     order makes an overpayment work without a special case: the fee
     takes its part, the surplus travels to WispHub and becomes a credit
     (D10). */
  const feeReceivedCents = Math.min(Math.max(0, receivedCents - ispDebtCents), serviceFeeCents);
  const ispRegisteredCents = receivedCents - feeReceivedCents;
  const missingCents = Math.max(0, ispDebtCents - ispRegisteredCents);

  /* D2 and D4 together, and both must hold. The percentage alone would
     let a token payment buy back a large arrears balance; the floor
     alone would not scale across ISPs with different plan prices.
     Integer arithmetic on both sides — money never meets a float. */
  const meetsPercent = ispRegisteredCents * 100 >= thresholdPercent * ispDebtCents;
  const meetsFloor = ispRegisteredCents >= floorCents;

  return {
    ispRegisteredCents,
    feeReceivedCents,
    missingCents,
    reconnect: meetsPercent && meetsFloor,
    /* D6: `partial` is about the debt, not about the router. A payment
       can reconnect (an ISP with a lenient threshold) and still leave a
       balance — the row says so, and the page says what is missing. */
    status: missingCents > 0 ? "partial" : "confirmed",
  };
}
