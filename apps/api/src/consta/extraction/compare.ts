import type { Bank } from "../../direct-payments/banks";
import { gateReference, resolveBank, type GatedReading } from "./gate";
import { checkShape, type ShapeRule } from "./shape";

/* two-eyes-receipt D5–D8, D11, D20 — the comparison, at minute zero.

   The first paid call now sends the file to the provider's image door
   with our own reading kept beside it (D3), so when Banxico answers "I
   have nothing yet" both readings exist at once and can be put side by
   side on the spot. That is the whole feature: two machines read the
   same receipt, and what they agree on is never asked of a human.

   This lives in the engine, not in the lifecycle (D11, research R1).
   Everything the comparison needs is here — the gate that says which of
   our fields are trustworthy, the shape rules learned from Banxico's own
   `valid` rows, and the provider's reading of the same file. The
   lifecycle did this at minute two back when the engine was a separate
   service and the product could not reach the shape rules; that reason
   left with consta-api-merge. Doing it here also hands top-ups the same
   flow for free (D18) — they call the same door and have no comparison
   code of their own.

   Pure: no database, no clock, no I/O. The rules are passed in.

   receipt-triage D13: the key of a comparison is the clave when either
   reading found one, and the referencia numérica otherwise. With a clave
   the rules are exactly two-eyes' — the reference, when read, only rides
   along in `accepted`, and never travels while the clave does (D1). With
   no clave the reference is compared the same way — equal as text agrees,
   different disputes, one side missing is blind — but the shape rules
   are never consulted: they are learned from claves, and a reference has
   no bank shape. "038195" and "38195" are different references. One
   fallback joins the clave rules: claves that disagree with no tiebreak,
   as the only field in doubt, fall back to a reference both readings hold
   and the gate passed — the next attempt searches with it, and the payer
   is asked only if Banxico then finds nothing (clarified 2026-09-24). */

/* D8: the only fields a payer is ever asked to fix.
   receipt-triage D13: the reference joins them. */
export type DisputedField = "trackingKey" | "referenceNumber" | "amount" | "date";

/* Our reading, gated, plus the date the gate has no opinion on (it is
   reported, never a search criterion we can validate — proof-extraction
   D3), and the model's legibility verdict, which travels to the verdict
   beside it. */
export type OurReading = GatedReading & {
  date: string | null;
  legibility?: "full" | "partial" | "none" | null;
};

/* What the provider's OCR read off the same file (`verdict.reading`).
   Measured 2026-08-26: it survives a faceless `invalid`, which is
   exactly the answer this comparison runs on. */
export type ProviderReading = {
  trackingKey: string | null;
  /* receipt-triage D13: the adapter already parsed it; now it counts */
  referenceNumber?: string | null;
  amountCents: number | null;
  date: string | null;
  senderBank: string | null;
};

export type Classification = {
  readingCheck: "agreed" | "disputed" | "blind";
  disputedFields: DisputedField[];
  blindSide: "provider" | "reader" | "both" | null;
  /* D6/D7: what later attempts carry through the provider's transfer
     door. Null means nobody can tell, so the payer is asked. */
  /* receipt-triage D13: at least one key set — the clave when there is
     one, the reference otherwise; both when both were read (only the
     clave travels, D1) */
  accepted: {
    trackingKey: string | null;
    referenceNumber: string | null;
    senderBank: Bank;
    amountCents: number;
    date: string | null;
  } | null;
  acceptedFrom: "agreed" | "reader" | "provider" | null;
};

/* D5: a field of ours counts only when the gate said `ok`. A clave the
   gate called malformed is not a second opinion — it is a misread, and
   letting it argue with the provider would manufacture disputes out of
   our own failures. A malformed or missing field is *empty* here, never
   wrong, and an empty field raises no dispute: the other reading simply
   supplies it. */
const gatedFields = (ours: OurReading | null) => ({
  trackingKey: ours?.gate.trackingKey === "ok" ? ours.trackingKey : null,
  /* receipt-triage D12: a generic or malformed reference is empty here */
  referenceNumber: ours?.gate.referenceNumber === "ok" ? ours.referenceNumber : null,
  senderBank: ours?.gate.senderBank === "ok" ? ours.senderBank : null,
  amountCents: ours?.gate.amount === "ok" ? ours.amountCents : null,
});

/* Case and surrounding space are noise on a clave — banks print it in
   either case and sometimes across two lines. Anything else is real. */
const sameClave = (a: string, b: string) => a.trim().toUpperCase() === b.trim().toUpperCase();

/* "Fits" is the bank's learned shape saying `ok`. `unknown` — no
   graduated rule for that bank, or a bank name that resolves to nothing —
   is "no rule", never a fit: a clave nothing vouched for must not win a
   tiebreak just because the other one looked worse (research R3). */
const fits = (rules: ShapeRule[], bank: Bank | null, clave: string | null) =>
  checkShape(rules, bank, clave) === "ok";

export function compareReadings(
  ours: OurReading | null,
  theirs: ProviderReading | null,
  rules: ShapeRule[],
): Classification {
  const mine = gatedFields(ours);
  /* The provider answers a bank *name* in its own spelling, so it goes
     through the same vocabulary our reading does before any rule judges
     its clave. A name that resolves to nothing gives shape `unknown`,
     which is "no rule". */
  const theirBank = resolveBank(theirs?.senderBank ?? null);
  const theirKey = theirs?.trackingKey?.trim() ? theirs.trackingKey.trim() : null;
  const theirAmount = theirs?.amountCents ?? null;
  /* receipt-triage D12: the provider's reference passes the same gate as
     ours before it counts — a folio the provider took for a reference is
     no key either */
  const theirRef =
    gateReference(theirs?.referenceNumber ?? null) === "ok" ? theirs!.referenceNumber!.trim() : null;
  /* The reference that rides along beside a clave: ours first */
  const anyRef = mine.referenceNumber ?? theirRef;

  /* Whichever side read it. Ours first — it is the one that passed a
     gate — and the bank may come from one side while the clave comes
     from the other, because an unresolvable bank name is a hole on our
     side, not a disagreement. */
  const bank = mine.senderBank ?? theirBank;
  const amount = mine.amountCents ?? theirAmount;

  /* Everything the provider's transfer door needs, from whoever has it */
  const buildable = (key: string | null) => Boolean(key && bank && amount != null);
  const build = (clave: string, from: Classification["acceptedFrom"]) => ({
    accepted: { trackingKey: clave, referenceNumber: anyRef, senderBank: bank!, amountCents: amount!, date: null },
    acceptedFrom: from,
  });
  /* receipt-triage D13: a reference as the only key */
  const buildByReference = (reference: string, from: Classification["acceptedFrom"]) => ({
    accepted: { trackingKey: null, referenceNumber: reference, senderBank: bank!, amountCents: amount!, date: null },
    acceptedFrom: from,
  });

  const decided = ((): Omit<Classification, "disputedFields"> & {
    disputedFields: DisputedField[];
  } => {
    /* ---- Both read a clave: the only case where they can disagree ---- */
    if (mine.trackingKey && theirKey) {
      const claveAgrees = sameClave(mine.trackingKey, theirKey);
      /* D5: the amount is compared as integer cents, exactly, like every
         other money comparison here (constitution II) — and only when
         both sides read one. A bank-name or date difference never
         disputes (reading-check D2, kept): banks spell their own name a
         dozen ways and print the date in as many formats, and neither
         decides *which* Banxico record is being asked about. */
      const amountDisputed =
        mine.amountCents != null && theirAmount != null && mine.amountCents !== theirAmount;

      if (claveAgrees && !amountDisputed) {
        /* D6: agreement is evidence, and it stops the spending — the
           next attempt goes straight to the transfer door with this. */
        return {
          readingCheck: "agreed",
          disputedFields: [],
          blindSide: null,
          ...(buildable(mine.trackingKey)
            ? build(mine.trackingKey, "agreed")
            : { accepted: null, acceptedFrom: null }),
        };
      }

      /* D7: the tiebreak. The bank's own learned clave shape is the only
         third party in the room — derived from (bank, clave) pairs
         Banxico itself called valid — so when exactly one of the two
         claves fits its bank's shape, that one is taken and no human is
         disturbed. Both fit, neither fits, or no rule: the machines have
         genuinely run out of ways to tell, and D8 says the payer is
         asked for the fields in doubt and nothing else. */
      const mineFits = fits(rules, mine.senderBank, mine.trackingKey);
      const theirsFits = fits(rules, theirBank, theirKey);

      /* A fitting clave implies a resolved bank (`checkShape` answers
         `unknown` without one), so only the amount can still be missing. */
      if (mineFits && !theirsFits && amount != null) {
        return {
          readingCheck: "disputed",
          disputedFields: [],
          blindSide: null,
          ...build(mine.trackingKey, "reader"),
        };
      }
      if (theirsFits && !mineFits && amount != null) {
        return {
          readingCheck: "disputed",
          disputedFields: [],
          blindSide: null,
          /* Their clave won, so their bank is the one that vouched for
             it — never ours, which the rule just declined. */
          accepted: {
            trackingKey: theirKey,
            referenceNumber: anyRef,
            senderBank: theirBank!,
            amountCents: amount,
            date: null,
          },
          acceptedFrom: "provider",
        };
      }

      /* receipt-triage D13, the fallback (clarified 2026-09-24): the
         claves disagree, their banks' shapes settle nothing, the clave is
         the only field in doubt, and both readings hold the same
         reference that the gate passed. Nobody is asked yet: the next
         attempt searches with the reference, no clave, and the payer is
         asked for either key only if Banxico finds nothing with it. The
         check still says `disputed` — the claves did differ. */
      if (
        !claveAgrees &&
        !amountDisputed &&
        mine.referenceNumber &&
        theirRef &&
        mine.referenceNumber === theirRef &&
        buildable(mine.referenceNumber)
      ) {
        return {
          readingCheck: "disputed",
          disputedFields: [],
          blindSide: null,
          ...buildByReference(mine.referenceNumber, "agreed"),
        };
      }

      /* Nothing decided: ask for exactly the fields that differ. A clave
         both sides read the same way is not re-asked because the amount
         disagrees, and vice versa. */
      const disputed: DisputedField[] = [];
      if (!claveAgrees) disputed.push("trackingKey");
      if (amountDisputed) disputed.push("amount");
      return {
        readingCheck: "disputed",
        disputedFields: disputed,
        blindSide: null,
        accepted: null,
        acceptedFrom: null,
      };
    }

    /* ---- The provider read no clave (D12's case, or an OCR that caught
       only part of the image) ---- */
    if (mine.trackingKey && !theirKey) {
      /* FR-013: a complete reading of ours goes through the transfer
         door on the next attempt. Nobody contradicted it, and asking the
         payer to retype what we already read is the silent friction this
         feature exists to remove. Incomplete, and neither side can
         supply the hole — that is blind on *both* sides (research R3). */
      if (buildable(mine.trackingKey)) {
        return {
          readingCheck: "blind",
          disputedFields: [],
          blindSide: "provider",
          ...build(mine.trackingKey, "reader"),
        };
      }
      return {
        readingCheck: "blind",
        disputedFields: missingOf(mine.trackingKey, bank, amount),
        blindSide: "both",
        accepted: null,
        acceptedFrom: null,
      };
    }

    /* ---- We read no clave, they did ---- */
    if (!mine.trackingKey && theirKey) {
      /* Their reading is unopposed, so the shape rule is the only check
         left. `mismatch` is the one answer that refuses it: a clave the
         bank's own shape contradicts, with nothing of ours to weigh
         against it, is worth a question. `unknown` (no rule yet) passes —
         cold start must not mean "ask everybody". */
      const contradicted = checkShape(rules, theirBank, theirKey) === "mismatch";
      const usable = buildable(theirKey) && !contradicted;
      return {
        readingCheck: "blind",
        disputedFields: usable ? [] : missingOf(theirKey, bank, amount, contradicted),
        blindSide: "reader",
        ...(usable
          ? {
              accepted: { trackingKey: theirKey, referenceNumber: anyRef, senderBank: bank!, amountCents: amount!, date: null },
              acceptedFrom: "provider" as const,
            }
          : { accepted: null, acceptedFrom: null }),
      };
    }

    /* ---- receipt-triage D13: neither read a clave — the reference is
       the key. Compared as text, never as a number, and never judged by
       a shape rule: a disputed reference is the payer's to settle. ---- */
    const myRef = mine.referenceNumber;
    if (myRef && theirRef) {
      const refAgrees = myRef === theirRef;
      const amountDisputed =
        mine.amountCents != null && theirAmount != null && mine.amountCents !== theirAmount;
      if (refAgrees && !amountDisputed) {
        return {
          readingCheck: "agreed",
          disputedFields: [],
          blindSide: null,
          ...(buildable(myRef) ? buildByReference(myRef, "agreed") : { accepted: null, acceptedFrom: null }),
        };
      }
      const disputed: DisputedField[] = [];
      if (!refAgrees) disputed.push("referenceNumber");
      if (amountDisputed) disputed.push("amount");
      return { readingCheck: "disputed", disputedFields: disputed, blindSide: null, accepted: null, acceptedFrom: null };
    }
    if (myRef || theirRef) {
      const ref = (myRef ?? theirRef)!;
      const side = myRef ? ("provider" as const) : ("reader" as const);
      if (buildable(ref)) {
        return {
          readingCheck: "blind",
          disputedFields: [],
          blindSide: side,
          ...buildByReference(ref, myRef ? "reader" : "provider"),
        };
      }
      return {
        readingCheck: "blind",
        disputedFields: missingOf(ref, bank, amount),
        blindSide: "both",
        accepted: null,
        acceptedFrom: null,
      };
    }

    /* ---- Neither read a key: nobody saw anything worth asking Banxico
       about, so the payer is the only source left. receipt-triage
       FR-004/FR-005: either key is enough, so both are asked for; the
       amount only when no reading has one. ---- */
    return {
      readingCheck: "blind",
      disputedFields: amount == null ? ["trackingKey", "referenceNumber", "amount"] : ["trackingKey", "referenceNumber"],
      blindSide: "both",
      accepted: null,
      acceptedFrom: null,
    };
  })();

  /* D6/D7: the date rides whichever reading has one — ours first,
     because it passed our own eyes. It is never part of the dispute
     question (banks print dates a dozen ways), but the provider's
     transfer door requires one. */
  const date = ours?.date ?? theirs?.date ?? null;

  /* D20: when the accepted data has no date on either side, the transfer
     door is never called with a date nobody read — the old code filled
     that hole with today, which quietly asks Banxico about the wrong
     day. Instead `"date"` joins the disputed fields, whatever the check
     said: an `agreed` reading with no date is still agreed (the clock
     retires, the release may fire) and still needs that one field from
     the payer. */
  const needsDate = decided.accepted != null && date == null;

  return {
    ...decided,
    disputedFields: needsDate ? [...decided.disputedFields, "date"] : decided.disputedFields,
    accepted: decided.accepted ? { ...decided.accepted, date } : null,
  };
}

/* Which fields the payer has to supply when nothing could be built. A
   clave contradicted by its bank's own shape is asked for again even
   though it was read — that is what `mismatch` means.

   The bank is the awkward one: D8's vocabulary has three words and none
   of them is "bank", because the payer picks a bank from a list rather
   than typing it. When the bank is the only hole, the form still has to
   open — that is where the picker lives — so the clave is what we name.
   The cost is a payer re-typing a clave we read correctly; the
   alternative is a payment that waits for an escalation five attempts
   away with nobody able to say why. Reachable only when *neither*
   reading named a bank the vocabulary knows, which is a thoroughly
   degraded pair of readings. */
/* receipt-triage D13: `key` is the clave or the reference this branch
   holds; a missing one asks for either (FR-004), a contradicted or
   bankless clave for the clave as before. */
function missingOf(
  key: string | null,
  bank: string | null,
  amount: number | null,
  contradicted = false,
): DisputedField[] {
  const fields: DisputedField[] = [];
  if (!key) fields.push("trackingKey", "referenceNumber");
  else if (contradicted || !bank) fields.push("trackingKey");
  if (amount == null) fields.push("amount");
  return fields.length ? fields : ["trackingKey", "amount"];
}
