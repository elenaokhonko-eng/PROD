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
  // More retail banks in Singapore (Elena, 20 Nov 2026). ICBC comes before Bank of China, whose name it contains.
  { pattern: /\bicbc\b|industrial and commercial bank of china/i, name: "ICBC", type: "bank" },
  { pattern: /\bbank of china\b/i, name: "Bank of China", type: "bank" },
  { pattern: /\bcimb\b/i, name: "CIMB", type: "bank" },
  { pattern: /\bmari\s?bank\b/i, name: "MariBank", type: "bank" },
  { pattern: /\brhb\b/i, name: "RHB", type: "bank" },
  { pattern: /\bsingtel\b/i, name: "Singtel", type: "telco" },
  { pattern: /\bstarhub\b/i, name: "StarHub", type: "telco" },
  { pattern: /\bm1\b/i, name: "M1", type: "telco" },
  { pattern: /\bsimba\b|\btpg telecom\b/i, name: "SIMBA", type: "telco" },
];

// The four mobile network operators covered by the SRF telco duties (R fn 2). MVNOs are not.
export const SRF_MOBILE_NETWORK_OPERATORS = ["Singtel", "StarHub", "M1", "SIMBA"] as const;

// Not banks or payment providers: the police, regulators, dispute bodies and government services. A name with no
// letters (a reference number typed into the wrong box) is not an institution either (finding A2).
const NOT_A_PROVIDER = /\bpolice\b|\bspf\b|\bscamshield\b|\bministry\b|\bimda\b|monetary authority|\bmas\b|\bfidrec\b|\bcourts?\b|\bsingpass\b|\bgov(?:ernment)?\b/i;

export function normaliseInstitution(input: unknown): Institution | null {
  if (typeof input !== "string") return null;
  const text = input.trim().replace(/\s+/g, " ");
  if (!text || !/[a-z]/i.test(text) || text.length > 80 || NOT_A_PROVIDER.test(text)) return null;
  const alias = ALIASES.find((a) => a.pattern.test(text));
  return alias ? { name: alias.name, type: alias.type } : { name: text, type: "other" };
}

// Every distinct institution named in a free-text answer such as "DBS and GrabPay" or "OCBC / Singtel".
export function institutionsIn(text: unknown): Institution[] {
  if (typeof text !== "string" || !text.trim()) return [];
  const found = new Map<string, Institution>();
  // A name with "and" in it is shortened first, so the split below doesn't cut it in two.
  const shortened = text.replace(/industrial and commercial bank of china/gi, "ICBC");
  for (const part of shortened.split(/\s*(?:,|\/|&|\band\b|;|\+)\s*/i)) {
    const institution = normaliseInstitution(part);
    if (institution) found.set(institution.name.toLowerCase(), institution);
  }
  return [...found.values()];
}

// Every known institution named anywhere in a text. A span matched by an earlier alias is not matched again, so
// "DBS PayLah!" counts as the e-wallet, not also as the bank.
/** Any institution name or alias, for phrase checks such as "reported it to DBS" (validate-output.ts). */
export const INSTITUTION_NAME_SOURCE = ALIASES.map((a) => `(?:${a.pattern.source})`).join("|");

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
