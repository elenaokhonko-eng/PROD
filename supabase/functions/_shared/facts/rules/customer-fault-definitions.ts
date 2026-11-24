// The customer-fault definitions section (FIDReC standards brief v5, 4d; decisions 11 and 13): section
// `customer_fault_definitions`. Printed in every FIDReC pack, before the conduct comparison. Per framework that applies
// to the disputed payments it prints the reviewed statements by key, in the revision approved for the clause wording in
// force on the payment date; the wording lives in the statement seeds (Lanes 1 and 5), never here. Then the
// institution's own definition, resolved by its configured term request (4e).
//
// It sets out the definitions only. Nothing here says whether anyone's conduct meets them.
//
// Plain TypeScript for Deno and Node: relative imports with .ts extensions, no npm imports.

import type { IsoDate, SectionBuilder, SectionInput, SectionResult, StatementKey } from "../update/contract.ts";
import {
  distinctDates,
  factValue,
  isAccountPayment,
  isCardPayment,
  isThreeDs,
  SectionCollector,
} from "./account-access-sequence.ts";
import {
  NO_TERM_REQUESTS,
  printFaultDefinition,
  productsForPayment,
  resolveTermRequest,
  type TermProduct,
  type TermRequestSource,
} from "./institution-terms.ts";

/** Statements for account payments (EUPG, then SRF), in print order. */
export const ACCOUNT_STATEMENT_KEYS = {
  eupg: ["eupg.fault.term", "eupg.fault.examples", "eupg.fault.level1", "eupg.fault.level2", "eupg.fault.institution", "eupg.fault.reasons"],
  srf: ["srf.fault.terms", "srf.fault.userduties", "srf.fault.allocation", "srf.fault.section6", "srf.fidrec.scope"],
} as const satisfies Record<string, readonly StatementKey[]>;

/** Statements for card payments: the EUPG and SRF card exclusions, then the ABS card code. */
export const CARD_STATEMENT_KEYS = {
  eupg: ["eupg.fault.cards"],
  srf: ["srf.fault.cards"],
  abs: ["abs.fault.term", "abs.fault.undefined", "abs.fault.finder", "abs.fault.effect", "abs.fault.status"],
} as const satisfies Record<string, readonly StatementKey[]>;

/** The footnote printed from the corpus after `eupg.fault.examples` (4d). */
export const EUPG_EXAMPLES_CLAUSE_KEY = "mas.eupg/fn20";

/** 4d: printed when both the ABS and the MAS-reply statements print. */
export const ABS_MAS_REPLY_CLOSING_LINE =
  "The code's term is 'gross negligence'. The MAS reply's term for authenticating a 3DS transaction is 'negligent'.";

export interface CustomerFaultDefinitionsOptions {
  /** The institutions' configured term requests (4e). Without them every institution prints "not held". */
  termRequests?: TermRequestSource;
}

/**
 * Prints each statement on every distinct payment date of its group, once per distinct revision: a case that spans a
 * version change gets each version (3.2 rule 2), each line carrying its own date. Returns whether any revision printed
 * approved wording.
 */
async function printOnDates(out: SectionCollector, key: StatementKey, dates: IsoDate[]): Promise<boolean> {
  const printed = new Set<string>();
  let anyText = false;
  for (const onDate of dates) {
    const line = await out.statement(key, onDate);
    const id = line.statement.statementId ?? "under_review";
    if (printed.has(id)) continue;
    printed.add(id);
    out.lines.push(line);
    if (line.statement.text !== null) anyText = true;
    if (key === "eupg.fault.examples" && line.statement.text !== null) {
      const footnote = await out.clause(EUPG_EXAMPLES_CLAUSE_KEY, onDate);
      if (footnote) out.text(`"${footnote.text_content}"`, { clauseKeys: [footnote.clause_key] });
    }
  }
  return anyText;
}

async function buildDefinitions(input: SectionInput, options: CustomerFaultDefinitionsOptions): Promise<SectionResult> {
  const out = new SectionCollector(input);
  const account = input.payments.filter(isAccountPayment);
  const card = input.payments.filter(isCardPayment);
  const accountDates = distinctDates(account.map((p) => p.date));
  const cardDates = distinctDates(card.map((p) => p.date));

  // EUPG: the account statements, then the card exclusion.
  if (accountDates.length) for (const key of ACCOUNT_STATEMENT_KEYS.eupg) await printOnDates(out, key, accountDates);
  if (cardDates.length) for (const key of CARD_STATEMENT_KEYS.eupg) await printOnDates(out, key, cardDates);
  // SRF: the same order.
  if (accountDates.length) for (const key of ACCOUNT_STATEMENT_KEYS.srf) await printOnDates(out, key, accountDates);
  if (cardDates.length) for (const key of CARD_STATEMENT_KEYS.srf) await printOnDates(out, key, cardDates);

  if (cardDates.length) {
    let absPrinted = false;
    for (const key of CARD_STATEMENT_KEYS.abs) {
      const any = await printOnDates(out, key, cardDates);
      if (key === "abs.fault.term") absPrinted = any;
    }

    // MAS reply of 7 January 2025: by how the record shows the card payments were authenticated.
    const events = (factValue(input, "card_auth_events") ?? []).filter((e) => e.transactionIndex !== null);
    const dateOf = (index: number | null) => card.find((p) => p.index === index)?.date ?? null;
    const threeDsDates = distinctDates(
      events
        .filter((e) => isThreeDs(e.authentication) && (e.authenticationResult === "authenticated" || e.authenticationResult === "attempted"))
        .map((e) => dateOf(e.transactionIndex)),
    );
    const noAuthDates = distinctDates(events.filter((e) => e.authentication === "none_recorded").map((e) => dateOf(e.transactionIndex)));
    let replyPrinted = false;
    if (threeDsDates.length) replyPrinted = await printOnDates(out, "mas.reply.20250107.3ds", threeDsDates);
    if (noAuthDates.length) await printOnDates(out, "mas.reply.20250107.no3ds", noAuthDates);
    if (absPrinted && replyPrinted) out.text(ABS_MAS_REPLY_CLOSING_LINE);
  }

  // The institution's own terms (4e), per product the payments were made on, as of the earliest payment on it.
  const accountTypes = factValue(input, "account_types") ?? [];
  const byProduct = new Map<TermProduct, IsoDate[]>();
  for (const p of input.payments) {
    for (const product of productsForPayment(p, accountTypes)) {
      byProduct.set(product, [...(byProduct.get(product) ?? []), ...(p.date ? [p.date] : [])]);
    }
  }
  const institutionName = input.institution?.name ?? "The institution";
  for (const [product, dates] of byProduct) {
    const onDate = distinctDates(dates)[0];
    if (!onDate) continue;
    const resolved = await resolveTermRequest(options.termRequests ?? NO_TERM_REQUESTS, input.provider, {
      institution: input.institution?.code ?? null,
      product,
      purpose: "fault_definition",
      onDate,
    });
    printFaultDefinition(out, resolved, institutionName);
  }
  dedupeNotHeld(out);

  return out.result("customer_fault_definitions");
}

/** Two products with no terms held (account and digital banking) print one "not held" line, not two. */
function dedupeNotHeld(out: SectionCollector): void {
  const seen = new Set<string>();
  const kept = out.lines.filter((line) => {
    if (line.kind !== "text" || !line.text.endsWith(" are not held.")) return true;
    if (seen.has(line.text)) return false;
    seen.add(line.text);
    return true;
  });
  out.lines.splice(0, out.lines.length, ...kept);
}

export function createCustomerFaultDefinitionsBuilder(options: CustomerFaultDefinitionsOptions = {}): SectionBuilder {
  return (input) => buildDefinitions(input, options);
}

/** With no term requests configured: every institution's terms print "not held". */
export const buildCustomerFaultDefinitions: SectionBuilder = createCustomerFaultDefinitionsBuilder();
