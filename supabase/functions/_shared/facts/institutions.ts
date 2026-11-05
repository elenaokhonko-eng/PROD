// Institution aliases: map a name as written to a canonical name and type. Starts from the extract's DBS/POSB, OCBC,
// UOB and Citibank patterns and adds the e-wallet issuers and the four mobile network operators the SRF covers.
// A name that matches nothing is kept as written with type "other", never guessed.

import type { Institution, InstitutionType } from "./keys.ts";

interface Alias {
  pattern: RegExp;
  name: string;
  type: InstitutionType;
}

// Order matters: e-wallet names that contain a bank name (DBS PayLah!) come before the bank.
const ALIASES: Alias[] = [
  { pattern: /\b(?:dbs\s+)?pay\s?lah\b!?/i, name: "DBS PayLah!", type: "payment_service_provider" },
  { pattern: /\bgrab\s?pay\b/i, name: "GrabPay", type: "payment_service_provider" },
  { pattern: /\bshopee\s?pay\b/i, name: "ShopeePay", type: "payment_service_provider" },
  { pattern: /\byou\s?trip\b/i, name: "YouTrip", type: "payment_service_provider" },
  { pattern: /\bsingtel\s+dash\b/i, name: "Singtel Dash", type: "payment_service_provider" },
  { pattern: /\brevolut\b/i, name: "Revolut", type: "payment_service_provider" },
  { pattern: /\btransferwise\b|\bwise\.com\b|\bwise (account|card|transfer)\b/i, name: "Wise", type: "payment_service_provider" },
  { pattern: /\bpaypal\b/i, name: "PayPal", type: "payment_service_provider" },
  { pattern: /\bdbs\b|\bposb\b/i, name: "DBS/POSB", type: "bank" },
  { pattern: /\bocbc\b/i, name: "OCBC", type: "bank" },
  { pattern: /\buob\b|united overseas bank/i, name: "UOB", type: "bank" },
  { pattern: /\bciti(bank)?\b/i, name: "Citibank", type: "bank" },
  { pattern: /\bstandard chartered\b|\bstanchart\b|\bscb\b/i, name: "Standard Chartered", type: "bank" },
  { pattern: /\bhsbc\b/i, name: "HSBC", type: "bank" },
  { pattern: /\bmaybank\b/i, name: "Maybank", type: "bank" },
  { pattern: /\btrust bank\b/i, name: "Trust Bank", type: "bank" },
  { pattern: /\bgxs\b/i, name: "GXS Bank", type: "bank" },
  { pattern: /\bsingtel\b/i, name: "Singtel", type: "telco" },
  { pattern: /\bstarhub\b/i, name: "StarHub", type: "telco" },
  { pattern: /\bm1\b/i, name: "M1", type: "telco" },
  { pattern: /\bsimba\b|\btpg telecom\b/i, name: "SIMBA", type: "telco" },
];

// The four mobile network operators covered by the SRF telco duties (R fn 2). MVNOs are not.
export const SRF_MOBILE_NETWORK_OPERATORS = ["Singtel", "StarHub", "M1", "SIMBA"] as const;

export function normaliseInstitution(input: unknown): Institution | null {
  if (typeof input !== "string") return null;
  const text = input.trim().replace(/\s+/g, " ");
  if (!text) return null;
  const alias = ALIASES.find((a) => a.pattern.test(text));
  return alias ? { name: alias.name, type: alias.type } : { name: text, type: "other" };
}

// Every distinct institution named in a free-text answer such as "DBS and GrabPay" or "OCBC / Singtel".
export function institutionsIn(text: unknown): Institution[] {
  if (typeof text !== "string" || !text.trim()) return [];
  const found = new Map<string, Institution>();
  for (const part of text.split(/\s*(?:,|\/|&|\band\b|;|\+)\s*/i)) {
    const institution = normaliseInstitution(part);
    if (institution) found.set(institution.name.toLowerCase(), institution);
  }
  return [...found.values()];
}

// Every known institution named anywhere in a text. A span matched by an earlier alias is not matched again, so
// "DBS PayLah!" counts as the e-wallet, not also as the bank.
export function institutionsMentioned(text: string): Institution[] {
  let remaining = text;
  const found = new Map<string, Institution>();
  for (const alias of ALIASES) {
    const global = new RegExp(alias.pattern.source, alias.pattern.flags.includes("g") ? alias.pattern.flags : alias.pattern.flags + "g");
    if (global.test(remaining)) {
      found.set(alias.name, { name: alias.name, type: alias.type });
      remaining = remaining.replace(new RegExp(alias.pattern.source, global.flags), " ");
    }
  }
  return [...found.values()];
}

export function sameInstitutionSet(a: readonly Institution[], b: readonly Institution[]): boolean {
  const key = (list: readonly Institution[]) => [...new Set(list.map((i) => i.name.toLowerCase()))].sort().join("|");
  return key(a) === key(b);
}
