// The section registry of the FIDReC pack update (Lane 6, assembly; lanes plan, Lane 6 item 2; brief v5 4i). The pack
// calls each lane's SectionBuilder in the contract's order (SECTION_IDS). The three record sections (access records,
// card authentication records, IP locations) are built here: they print the institution's records as the server
// read them, and nothing else. The "standards" section (Phase 5, by retrieval) is a stub that prints nothing until
// the corpus has embeddings.
//
// Records are printed by the server only (Elena's condition B): device and token references, IP addresses and the
// IP lookups appear in these sections and never in the model's input.
//
// Plain TypeScript for Deno and Node: relative imports with .ts extensions, no npm imports.

import { formatMoney } from "../display.ts";
import { buildAccountAccessSequence, CARD_AUTH_METHOD, factValue } from "../rules/account-access-sequence.ts";
import { buildCardDisputeComparison } from "../rules/card-dispute-checks.ts";
import { createCustomerConductBuilder } from "../rules/customer-conduct.ts";
import { createCustomerFaultDefinitionsBuilder } from "../rules/customer-fault-definitions.ts";
import { buildDisputeChargesChecks } from "../rules/dispute-charges-checks.ts";
import { createDutyTimeChecks } from "../rules/duty-time-checks.ts";
import { createIndustryPracticeChecks } from "../rules/industry-practice-checks.ts";
import { NO_TERM_REQUESTS, type TermRequestSource } from "../rules/institution-terms.ts";
import { createMasNoticeChecks } from "../rules/mas-notice-checks.ts";
import { ipLocationFooterLines, ipLocationLines } from "../../ip-location/lookup.ts";
import {
  type AccessEventKind,
  type CardAuthenticationResult,
  type EntryMode,
  SECTION_IDS,
  type SectionBuilder,
  type SectionId,
  type SectionInput,
  type SectionResult,
  type WalletProvisioningAuthentication,
} from "./contract.ts";
import { formatDateTime, SectionWriter } from "./section-writer.ts";

// ---------------------------------------------------------------------------------------------------------------
// The record sections
// ---------------------------------------------------------------------------------------------------------------

// wording awaiting Elena's approval: what each kind of access-record line is called in the records table.
export const ACCESS_EVENT_WORDS: Record<AccessEventKind, string> = {
  login: "Login",
  new_device_login: "Login recorded as from a new device",
  token_activated: "Digital token activated",
  device_registered: "Device registered",
  payee_added: "Payee added",
  limit_changed: "Transaction limit changed",
  notifications_disabled: "Transaction notifications disabled",
  contact_details_changed: "Contact details changed",
  otp_sent: "One-time code sent",
  alert_sent: "Alert sent",
  payment_authenticated: "Payment authenticated",
  account_blocked: "Access blocked",
  other: "Other entry",
};

// wording awaiting Elena's approval: the card record's own fields, in words.
export const ENTRY_MODE_WORDS: Record<EntryMode, string | null> = {
  chip: "chip",
  contactless: "contactless",
  key_entered: "card details keyed in",
  ecommerce: "online",
  wallet_token: "mobile wallet",
  not_known: null,
};

// wording awaiting Elena's approval
export const AUTHENTICATION_RESULT_WORDS: Record<CardAuthenticationResult, string | null> = {
  authenticated: "authenticated",
  attempted: "attempted",
  failed: "failed",
  not_known: null,
};

// wording awaiting Elena's approval
export const WALLET_AUTHENTICATION_WORDS: Record<WalletProvisioningAuthentication, string | null> = {
  sms_otp: "SMS one-time code",
  in_app: "in-app approval",
  digital_token: "digital token",
  not_known: null,
};

/**
 * The field names of a record row, in print order. The renderer prints each field that has a value as
 * "[label]: [value]" (RECORD_FIELD_LABELS in render.ts).
 */
export const ACCESS_RECORD_FIELDS = ["time", "entry", "device", "device_reference", "ip_address", "channel", "authorised_by", "sent_to", "token_reference"] as const;
export const CARD_RECORD_FIELDS = [
  "time",
  "payment",
  "merchant",
  "amount_in_record",
  "card_scheme",
  "entry_mode",
  "authentication",
  "result",
  "sent_to",
  "device",
  "device_reference",
  "token_reference",
  "added_to_wallet",
  "wallet_device",
  "wallet_authentication",
  "removed_from_wallet",
] as const;

const at = (t: string | null) => (t ? formatDateTime(t) : null);

export const buildAccessRecords: SectionBuilder = (input: SectionInput): Promise<SectionResult> => {
  const out = new SectionWriter("access_records", input);
  const events = factValue(input, "access_events") ?? [];
  const evidence = out.evidence("access_events");
  for (const e of events) {
    out.record({
      time: at(e.timestamp),
      entry: ACCESS_EVENT_WORDS[e.kind] ?? null,
      device: e.deviceLabel,
      device_reference: e.deviceRef,
      ip_address: e.ip,
      channel: e.channel,
      authorised_by: e.authorisedBy,
      sent_to: e.sentTo,
      token_reference: e.tokenRef,
    }, evidence);
  }
  return Promise.resolve(out.result());
};

export const buildCardAuthenticationRecords: SectionBuilder = (input: SectionInput): Promise<SectionResult> => {
  const out = new SectionWriter("card_authentication_records", input);
  const events = factValue(input, "card_auth_events") ?? [];
  const evidence = out.evidence("card_auth_events");
  for (const e of events) {
    const payment = e.transactionIndex !== null ? input.payments.find((p) => p.index === e.transactionIndex) ?? null : null;
    out.record({
      time: at(e.timestamp),
      payment: payment ? `Payment ${payment.index + 1} of ${formatMoney(payment.amount)}` : null,
      merchant: e.merchant,
      amount_in_record: e.amount ? formatMoney(e.amount) : null,
      card_scheme: e.cardScheme === "visa" ? "Visa" : e.cardScheme === "mastercard" ? "Mastercard" : null,
      entry_mode: ENTRY_MODE_WORDS[e.entryMode] ?? null,
      authentication: CARD_AUTH_METHOD[e.authentication] ?? null,
      result: AUTHENTICATION_RESULT_WORDS[e.authenticationResult] ?? null,
      sent_to: e.sentTo,
      device: e.deviceLabel,
      device_reference: e.deviceRef,
      token_reference: e.tokenRef,
      added_to_wallet: at(e.walletProvisionedAt),
      wallet_device: e.walletDeviceLabel,
      wallet_authentication: e.walletProvisioningAuthentication ? WALLET_AUTHENTICATION_WORDS[e.walletProvisioningAuthentication] : null,
      removed_from_wallet: at(e.walletTokenRemovedAt),
    }, evidence);
  }
  return Promise.resolve(out.result());
};

/** Each lookup (Lane 2's printed form, brief 3c), then the note with the database date and the licence's attribution. */
export const buildIpLocations: SectionBuilder = (input: SectionInput): Promise<SectionResult> => {
  const out = new SectionWriter("ip_locations", input);
  if (!input.ipLocations.length) return Promise.resolve(out.result());
  const evidence = out.evidence("access_events");
  for (const location of input.ipLocations) {
    for (const line of ipLocationLines(location)) out.text(line, { evidenceIds: evidence });
  }
  for (const line of ipLocationFooterLines(input.ipLocations)) out.text(line);
  return Promise.resolve(out.result());
};

/** Phase 5 ("Standards" by retrieval) needs embeddings in the corpus, which Lane 1 has not built. Prints nothing. */
export const buildStandardsStub: SectionBuilder = (input: SectionInput): Promise<SectionResult> =>
  Promise.resolve(new SectionWriter("standards", input).result());

// ---------------------------------------------------------------------------------------------------------------
// The registry
// ---------------------------------------------------------------------------------------------------------------

export interface RegistryOptions {
  /** The institutions' configured term requests (4e; wallet pages, Decision 5). None: their terms print "not held". */
  termRequests?: TermRequestSource;
}

export function sectionBuilders(options: RegistryOptions = {}): Record<SectionId, SectionBuilder> {
  const termRequests = options.termRequests ?? NO_TERM_REQUESTS;
  return {
    access_records: buildAccessRecords,
    card_authentication_records: buildCardAuthenticationRecords,
    ip_locations: buildIpLocations,
    account_access_sequence: buildAccountAccessSequence,
    duty_time_checks: createDutyTimeChecks(),
    disputed_amount_charges: buildDisputeChargesChecks,
    mas_notice_comparison: createMasNoticeChecks(),
    industry_practice_comparison: createIndustryPracticeChecks({ termRequests }),
    card_dispute_comparison: buildCardDisputeComparison,
    customer_fault_definitions: createCustomerFaultDefinitionsBuilder({ termRequests }),
    customer_conduct_comparison: createCustomerConductBuilder({ termRequests }),
    standards: buildStandardsStub,
  };
}

/** Every section, in the contract's order. A section with nothing to print comes back with no lines. */
export async function buildUpdateSections(input: SectionInput, options: RegistryOptions = {}): Promise<SectionResult[]> {
  const builders = sectionBuilders(options);
  const results: SectionResult[] = [];
  // In order, one at a time: the provider remembers each read, so later sections reuse earlier reads.
  for (const id of SECTION_IDS) {
    const result = await builders[id](input);
    if (result.sectionId !== id) throw new Error(`section registry: ${id} returned ${result.sectionId}`);
    results.push(result);
  }
  return results;
}
