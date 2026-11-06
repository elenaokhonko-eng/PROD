// Shared Responsibility Framework scope assessment (design 8.2 and 8.3). The wording is chosen here by the server
// from confirmed facts and cited rules; the model never writes it. Assessments say "likely", never decide.
//
// Sources: G = MAS/IMDA Guidelines on Shared Responsibility Framework (issued 24 Oct 2024, effective 16 Dec 2024);
// R = MAS/IMDA Response to Consultation (24 Oct 2024); CP = Consultation Paper (25 Oct 2023);
// E = MAS E-Payments User Protection Guidelines (from 16 Dec 2024).

import {
  type CredentialsShared,
  type ImpersonatedEntityType,
  type Instrument,
  isDigitalPhishing,
  isNonDigitalPhishing,
  type Money,
  type PhishingChannel,
  type ScamType,
  type Transaction,
} from "../keys.ts";
import { formatMoney } from "../display.ts";

export const SRF_EFFECTIVE_DATE = "2024-12-16";

export type ScopeAssessment = "likely_in_scope" | "likely_out_of_scope" | "unclear";

export interface ScopeReason {
  code: string;
  text: string;
  cite: string;
}

export interface PortionAssessment {
  kind: "srf" | "card" | "unclassified";
  total: Money | null;
  assessment: ScopeAssessment;
  reasons: ScopeReason[];
}

export interface SrfAssessment {
  portions: PortionAssessment[];
  telco: ScopeReason | null;
  remedies: ScopeReason | null;
}

export interface SrfFacts {
  scamTypes: ScamType[] | null;
  channel: PhishingChannel | null;
  credentials: CredentialsShared | null;
  impersonated: ImpersonatedEntityType | null;
  transactions: Transaction[] | null;
}

const R = {
  scope: { code: "srf_scope", cite: "G §2.1 (seemingly authorised transaction, limbs (a)-(d))" },
  protectedAccount: { code: "protected_account", cite: "G §2.1 (protected account, relevant payment service provider); R para 8.4" },
  card: { code: "sg_card_excluded", cite: "G fn 1; R para 8.3(d)" },
  malware: { code: "malware_excluded", cite: "R para 3.4; CP para 4.4(c)" },
  nonDigital: { code: "non_digital_excluded", cite: "R para 3.5; CP para 4.4(b)" },
  givenDirectly: { code: "credentials_given_directly", cite: "G §2.1 limb (c); CP para 4.4(b)" },
  authorised: { code: "authorised_scam_excluded", cite: "CP para 4.4(a); E fn 4(a)" },
  privatePerson: { code: "private_person_impersonated", cite: "G §2.1 (legitimate business or government entity)" },
  beforeEffective: { code: "before_effective_date", cite: "G cover (effective 16 Dec 2024); no source states pre-commencement treatment" },
  telcoSms: { code: "telco_sms", cite: "G paras 6.2-6.5, 7.11; G §2.1 (SMS); R fn 2" },
  telcoOtt: { code: "telco_not_assessed", cite: "G §2.1 (SMS excludes OTT messages)" },
  remedies: { code: "other_remedies", cite: "G paras 6.8, 7.11; E paras 5.2-5.6; R para 6.11(d)" },
};

const AUTHORISED_TYPES: ScamType[] = ["investment", "job", "romance", "ecommerce"];
const DIGITAL_CHANNELS: PhishingChannel[] = ["sms", "email", "messaging_app", "social_media"];

function sum(transactions: Transaction[]): Money | null {
  if (!transactions.length) return null;
  const currency = transactions[0].amount.currency;
  if (transactions.some((t) => t.amount.currency !== currency)) return null;
  const amount = Math.round(transactions.reduce((s, t) => s + t.amount.amount, 0) * 100) / 100;
  return { amount, currency, amountSgd: currency === "SGD" ? amount : null };
}

function assessSrfPortion(facts: SrfFacts, transactions: Transaction[]): Omit<PortionAssessment, "kind" | "total"> {
  const out: ScopeReason[] = [];
  const unclear: ScopeReason[] = [];
  const types = facts.scamTypes ?? [];

  if (types.includes("malware") || facts.credentials === "installed_app_or_malware") {
    out.push({ ...R.malware, text: "Scams that use malware or a remote-access app are outside the SRF." });
  }
  if (types.some(isNonDigitalPhishing) || facts.channel === "phone_call" || facts.channel === "in_person") {
    out.push({ ...R.nonDigital, text: "Phishing by phone call or in person is outside the SRF." });
  }
  if (facts.credentials === "given_directly" || facts.credentials === "given_in_message") {
    out.push({ ...R.givenDirectly, text: "The SRF covers details entered on a fake website or app; details given directly to a scammer are outside it." });
  }
  if (types.some((t) => AUTHORISED_TYPES.includes(t))) {
    out.push({ ...R.authorised, text: "Payments you made knowingly, for example in an investment, job, romance or shopping scam, are outside the SRF." });
  }
  if (facts.impersonated === "private_person") {
    out.push({ ...R.privatePerson, text: "The SRF covers scammers posing as a business or government body, not as a private person." });
  }
  const dated = transactions.filter((t) => t.date);
  if (dated.length && dated.every((t) => t.date! < SRF_EFFECTIVE_DATE)) {
    out.push({ ...R.beforeEffective, text: "These payments were made before the SRF took effect on 16 Dec 2024, so the SRF is likely not to apply." });
  }
  if (out.length) return { assessment: "likely_out_of_scope", reasons: out };

  if (!types.some(isDigitalPhishing) && !types.includes("impersonation") && !types.includes("government_impersonation")) {
    unclear.push({ ...R.scope, text: "We could not confirm that this was a phishing scam through a digital message." });
  }
  if (!facts.channel || !DIGITAL_CHANNELS.includes(facts.channel)) {
    unclear.push({ ...R.scope, text: "The SRF covers scams that start with a digital message (SMS, email, messaging app or social media)." });
  }
  if (facts.credentials !== "entered_on_fake_site_or_app") {
    unclear.push({ ...R.scope, text: "The SRF covers details entered on a fake website or app; this is not confirmed for your case." });
  }
  if (!facts.impersonated || facts.impersonated === "unsure") {
    unclear.push({ ...R.scope, text: "The scammer must have posed as a business or government body serving Singapore." });
  }
  if (unclear.length) return { assessment: "unclear", reasons: unclear };

  const reasons: ScopeReason[] = [{
    ...R.scope,
    text: "This looks like the kind of phishing scam the SRF covers: a digital message impersonating an organisation, details entered on a fake website or app, and payments you did not intend.",
  }];
  if (transactions.some((t) => t.instrument === "ewallet")) {
    reasons.push({
      ...R.protectedAccount,
      text: "For e-wallet payments, the SRF applies only to e-wallets from licensed major payment institutions that can hold more than S$1,000.",
    });
  }
  return { assessment: "likely_in_scope", reasons };
}

export function assessSrf(facts: SrfFacts): SrfAssessment {
  const transactions = facts.transactions ?? [];
  const groups: Record<PortionAssessment["kind"], Transaction[]> = { srf: [], card: [], unclassified: [] };
  for (const t of transactions) {
    const instrument: Instrument | null = t.instrument;
    if (instrument === "sg_card") groups.card.push(t);
    else if (instrument === "account_transfer" || instrument === "ewallet") groups.srf.push(t);
    else groups.unclassified.push(t);
  }

  const portions: PortionAssessment[] = [];
  if (groups.srf.length || !transactions.length) {
    portions.push({ kind: "srf", total: sum(groups.srf), ...assessSrfPortion(facts, groups.srf) });
  }
  if (groups.card.length) {
    const total = sum(groups.card);
    portions.push({
      kind: "card",
      total,
      assessment: "likely_out_of_scope",
      reasons: [{
        ...R.card,
        text: `${total ? `${formatMoney(total)} on your card` : "Your card payments"}: the SRF does not cover credit, charge or debit cards issued in Singapore. These are handled under the E-Payments User Protection Guidelines and the card issuers' code of practice instead.`,
      }],
    });
  }
  if (groups.unclassified.length) {
    portions.push({
      kind: "unclassified",
      total: sum(groups.unclassified),
      assessment: "unclear",
      reasons: [{ ...R.scope, text: "We could not tell whether these payments were bank transfers, e-wallet payments or card payments." }],
    });
  }

  const srfInScope = portions.some((p) => p.kind === "srf" && p.assessment === "likely_in_scope");
  let telco: ScopeReason | null = null;
  if (srfInScope && facts.channel === "sms") {
    telco = {
      ...R.telcoSms,
      text: "Because the scam message came by SMS, your mobile operator may be responsible if your bank met all its duties and the operator did not meet its own. Your bank assesses this; disagreements about the operator go to IMDA in writing, not to FIDReC.",
    };
  } else if (srfInScope && facts.channel === "messaging_app") {
    telco = { ...R.telcoOtt, text: "Messages through WhatsApp or similar apps are not SMS, so the mobile operator's SRF duties do not apply." };
  }

  const anyNotInScope = portions.some((p) => p.assessment !== "likely_in_scope");
  const remedies = anyNotInScope
    ? {
        ...R.remedies,
        text: "Outside the SRF you still have options: your bank's own complaint process, the E-Payments User Protection Guidelines, and FIDReC.",
      }
    : null;

  return { portions, telco, remedies };
}

// Confirmed snapshot facts to SRF inputs. Facts marked "not sure" or "not known" give no input.
export function srfFactsFromSnapshot(
  facts: Partial<Record<string, { value: unknown; label: "confirmed" | "not_sure" | "claimant_only" | "not_known" }>>,
): SrfFacts {
  const value = <T>(key: string): T | null => {
    const fact = facts[key];
    return fact && (fact.label === "confirmed" || fact.label === "claimant_only") ? (fact.value as T) : null;
  };
  return {
    scamTypes: value<ScamType[]>("scam_type"),
    channel: value<PhishingChannel>("phishing_channel"),
    credentials: value<CredentialsShared>("credentials_or_otp_shared"),
    impersonated: value<ImpersonatedEntityType>("impersonated_entity_type"),
    transactions: value<Transaction[]>("transactions"),
  };
}

const ASSESSMENT_HEADINGS: Record<ScopeAssessment, string> = {
  likely_in_scope: "Likely covered by the SRF",
  likely_out_of_scope: "Likely not covered by the SRF",
  unclear: "Not clear yet",
};

// The free evaluation's SRF section, written by the server (never by the model).
export function srfAssessmentText(assessment: SrfAssessment): string {
  const lines: string[] = [
    "Shared Responsibility Framework (SRF): an early view",
    "This is based only on the facts you confirmed. It is not a decision; your bank assesses whether the SRF applies.",
  ];
  for (const portion of assessment.portions) {
    const amount = portion.total ? ` (${formatMoney(portion.total)})` : "";
    const label = portion.kind === "card" ? "Card payments" : portion.kind === "unclassified" ? "Other payments" : "Bank transfers and e-wallet payments";
    lines.push("", `${label}${amount}: ${ASSESSMENT_HEADINGS[portion.assessment]}`);
    for (const reason of portion.reasons) lines.push(`- ${reason.text}`);
  }
  if (assessment.telco) lines.push("", assessment.telco.text);
  if (assessment.remedies) lines.push("", assessment.remedies.text);
  lines.push("", "Source: MAS/IMDA Guidelines on Shared Responsibility Framework (effective 16 Dec 2024).");
  return lines.join("\n");
}
