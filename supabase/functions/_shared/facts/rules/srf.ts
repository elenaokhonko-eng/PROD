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
  type LossPortion,
  type Money,
  type PhishingChannel,
  type ScamType,
  type TotalLoss,
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
  // The kinds of payment in this portion, so its label names only what applies (walkthrough, 8 Nov).
  instruments?: Instrument[];
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
  // Amounts lost by account or card (finding A4), used when no individual payments were confirmed.
  losses?: LossPortion[] | null;
}

const ACCOUNT_INSTRUMENT: Record<string, Instrument> = {
  savings_or_current: "account_transfer",
  ewallet: "ewallet",
  debit_card: "sg_card",
  credit_card: "sg_card",
};

// Without confirmed payments, each amount lost stands in for one, in the account or card it left from.
function paymentsOf(facts: SrfFacts): Transaction[] {
  if (facts.transactions?.length) return facts.transactions;
  return (facts.losses ?? []).map((p) => ({
    date: null,
    amount: p.amount,
    channel: null,
    payee: null,
    last4: null,
    instrument: p.account ? ACCOUNT_INSTRUMENT[p.account] ?? null : null,
  }));
}

const R = {
  scope: { code: "srf_scope", cite: "G §2.1 (seemingly authorised transaction, limbs (a)-(d))" },
  protectedAccount: { code: "protected_account", cite: "G §2.1 (protected account, relevant payment service provider); R para 8.4" },
  card: { code: "sg_card_excluded", cite: "G fn 1; R para 8.3(d)" },
  // Cards (Elena, 8 Nov): the ABS card code and the card scheme's chargeback; the EUPG excludes cards from its
  // loss-sharing rules and keeps only some issuer duties for them.
  cardRules: { code: "card_rules", cite: "ABS Code of Practice for Banks – Credit Cards (rev. 2 July 2020) 5(a), 5(e), 6(a); EUPG (16 Dec 2024) 1.2 fn 3, 5.1; 4.2–4.6, 4.10–4.12, 4.14–4.16" },
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

// The same citations as clause keys (standard_clauses.clause_key), by reason code: what the versioned corpus resolves
// and what standard_rule_citations records (brief section 2; 3.2 rule 7). The cite text above stays the reader's label.
// A paragraph's lettered limb resolves to the whole paragraph or definition. G = mas.srf, R = mas.srf_response,
// CP = mas.srf_consultation, E = mas.eupg. before_effective_date rests on the version's effective date, not a clause.
export const SRF_REASON_CODES: readonly string[] = Object.values(R).map((r) => r.code);

export const SRF_CLAUSE_KEYS: Readonly<Record<string, readonly string[]>> = {
  srf_scope: ["mas.srf/2.1(seemingly-authorised-transaction)"],
  protected_account: [
    "mas.srf/2.1(protected-account)",
    "mas.srf/fn2",
    "mas.srf/2.1(relevant-payment-service-provider)",
    "mas.srf_response/8.4",
  ],
  sg_card_excluded: ["mas.srf/fn1", "mas.srf_response/8.3"],
  card_rules: ["abs.card_code/5", "abs.card_code/6", "mas.eupg/1.2", "mas.eupg/fn3", "mas.eupg/5.1", "mas.eupg/4.1"],
  malware_excluded: ["mas.srf_response/3.4", "mas.srf_consultation/4.4"],
  non_digital_excluded: ["mas.srf_response/3.5", "mas.srf_consultation/4.4"],
  credentials_given_directly: ["mas.srf/2.1(seemingly-authorised-transaction)", "mas.srf_consultation/4.4"],
  authorised_scam_excluded: ["mas.srf_consultation/4.4", "mas.eupg/fn4"],
  private_person_impersonated: ["mas.srf/2.1(legitimate-business-or-government-entity)"],
  before_effective_date: [],
  telco_sms: ["mas.srf/6.2", "mas.srf/6.3", "mas.srf/6.4", "mas.srf/6.5", "mas.srf/7.11", "mas.srf/2.1(sms)", "mas.srf_response/fn2"],
  telco_not_assessed: ["mas.srf/2.1(sms)"],
  other_remedies: [
    "mas.srf/6.8",
    "mas.srf/7.11",
    "mas.eupg/5.2",
    "mas.eupg/5.3",
    "mas.eupg/5.4",
    "mas.eupg/5.5",
    "mas.eupg/5.6",
    "mas.srf_response/6.11",
  ],
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
  const transactions = paymentsOf(facts);
  const groups: Record<PortionAssessment["kind"], Transaction[]> = { srf: [], card: [], unclassified: [] };
  for (const t of transactions) {
    const instrument: Instrument | null = t.instrument;
    if (instrument === "sg_card") groups.card.push(t);
    else if (instrument === "account_transfer" || instrument === "ewallet") groups.srf.push(t);
    else groups.unclassified.push(t);
  }

  const portions: PortionAssessment[] = [];
  if (groups.srf.length || !transactions.length) {
    const instruments = [...new Set(groups.srf.map((t) => t.instrument).filter((i): i is Instrument => Boolean(i)))];
    portions.push({ kind: "srf", total: sum(groups.srf), instruments, ...assessSrfPortion(facts, groups.srf) });
  }
  if (groups.card.length) {
    const total = sum(groups.card);
    portions.push({
      kind: "card",
      total,
      assessment: "likely_out_of_scope",
      reasons: [
        {
          ...R.card,
          text: `${total ? `${formatMoney(total)} on your card` : "Your card payments"}: the SRF does not cover credit, charge or debit cards issued in Singapore.`,
        },
        {
          ...R.cardRules,
          text: "Card losses are covered by the ABS Code of Practice for Banks – Credit Cards. Before you tell your card issuer, your liability for unauthorised charges is capped at S$100, unless you acted fraudulently or with gross negligence, or did not tell the issuer as soon as reasonably practicable (5(a)). If your card details were used without the card being stolen, and you did not act fraudulently or with gross negligence, you are not liable (6(a)). The cap also applies to debit cards that work like credit cards (5(e)). If you approved a payment yourself, for example with a one-time password or an in-app confirmation sent to you for that payment, the issuer may treat it as negligence and the cap may not apply.",
        },
        {
          ...R.cardRules,
          text: "Your card issuer can also dispute the charge with the merchant through the card scheme (a chargeback). The MAS E-Payments User Protection Guidelines (EUPG) do not decide card losses (1.2, 5.1), but some of their duties still apply to your card issuer, such as transaction alerts and a quick way to block your card (4.2–4.6, 4.10–4.12, 4.14–4.16). Ask your card issuer about the cap and a chargeback, in writing.",
        },
      ],
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

  // Losses outside the SRF (C3): payments made knowingly have no liability framework; unauthorised ones fall under
  // the EUPG.
  const anyNotInScope = portions.some((p) => p.assessment !== "likely_in_scope");
  const authorised = (facts.scamTypes ?? []).some((t) => AUTHORISED_TYPES.includes(t));
  const remedies = !anyNotInScope
    ? null
    : authorised
      ? {
          ...R.remedies,
          text: "Payments you made knowingly, for example in an investment, job, romance or shopping scam, are not covered by a liability framework. You can still complain to your bank in writing, and FIDReC can consider whether your bank handled your case properly.",
        }
      : {
          ...R.remedies,
          text: "For losses outside the SRF that you did not authorise, the MAS E-Payments User Protection Guidelines (EUPG) set out how such losses are shared between you and your bank or e-wallet provider (card losses follow the card rules). Your bank assesses this; you can complain in writing and, if you disagree with the outcome, go to FIDReC.",
        };

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
    losses: (() => {
      const loss = value<TotalLoss>("total_loss");
      if (!loss) return null;
      return loss.portions?.length ? loss.portions : [{ account: loss.account ?? null, amount: { amount: loss.amount, currency: loss.currency, amountSgd: loss.amountSgd } }];
    })(),
  };
}

const ASSESSMENT_HEADINGS: Record<ScopeAssessment, string> = {
  likely_in_scope: "Likely covered by the SRF",
  likely_out_of_scope: "Likely not covered by the SRF",
  unclear: "Not clear yet",
};

// One plain sentence for each body or framework named, on first use (finding C3).
const GLOSSARY: Array<[RegExp, string]> = [
  [/\bSRF\b/, "SRF: the Shared Responsibility Framework, under which banks and mobile operators may share losses from certain phishing scams."],
  [/\bEUPG\b/, "EUPG: the E-Payments User Protection Guidelines, MAS's rules on who bears losses from unauthorised electronic payments."],
  [/\bMAS\b/, "MAS: the Monetary Authority of Singapore, the central bank and financial regulator."],
  [/\bIMDA\b/, "IMDA: the Infocomm Media Development Authority, which regulates mobile operators."],
  [/\bFIDReC\b/, "FIDReC: the Financial Industry Disputes Resolution Centre, which resolves disputes between consumers and financial institutions."],
  [/\bScamShield\b/, "ScamShield: the national anti-scam helpline (1799), app and website."],
  [/\bABS\b/, "ABS: the Association of Banks in Singapore, the banks' industry association."],
];

function srfPortionLabel(instruments: readonly Instrument[]): string {
  const account = instruments.includes("account_transfer");
  const ewallet = instruments.includes("ewallet");
  if (account && ewallet) return "Bank account and e-wallet payments";
  if (account) return "Bank account payments";
  if (ewallet) return "E-wallet payments";
  return "Your payments";
}

// The free evaluation's "How the rules may apply" section, written by the server (never by the model): each part of
// the loss under the framework that applies to it (finding C3).
export function srfAssessmentText(assessment: SrfAssessment): string {
  const lines: string[] = [
    "This is based only on the facts you confirmed. It is not a decision; your bank assesses which rules apply.",
  ];
  for (const portion of assessment.portions) {
    const amount = portion.total ? ` (${formatMoney(portion.total)})` : "";
    const label = portion.kind === "card" ? "Card payments" : portion.kind === "unclassified" ? "Other payments" : srfPortionLabel(portion.instruments ?? []);
    const heading = portion.kind === "card" ? "Card rules apply, not the SRF" : ASSESSMENT_HEADINGS[portion.assessment];
    lines.push("", `${label}${amount}: ${heading}`);
    for (const reason of portion.reasons) lines.push(`- ${reason.text}`);
  }
  if (assessment.telco) lines.push("", assessment.telco.text);
  if (assessment.remedies) lines.push("", assessment.remedies.text);
  const body = lines.join("\n");
  const terms = GLOSSARY.filter(([pattern]) => pattern.test(body)).map(([, text]) => `- ${text}`);
  return [
    body,
    "",
    "Sources: MAS/IMDA Guidelines on Shared Responsibility Framework (effective 16 Dec 2024); MAS E-Payments User Protection Guidelines.",
    ...(terms.length ? ["", "Terms used:", ...terms] : []),
  ].join("\n");
}
