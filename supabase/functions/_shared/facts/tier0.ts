// The free-evaluation summary's input, prompt and checks, shared by bright-function and the corpus
// (scripts/tier0-corpus) so the corpus measures exactly what production runs (hardening item 2, 8 Nov).

import { formatFactValue } from "./display.ts";
import type { FactKey, Institution, Money, Transaction } from "./keys.ts";
import type { SnapshotFacts, ValidateOptions } from "./validate-output.ts";

// Pinned to a dated snapshot so a provider-side model update cannot change behaviour unseen; re-run the corpus
// before changing this or the prompt.
export const TIER0_DEFAULT_MODEL = "gpt-6-luna";
export const TIER0_MIN_WORDS = 40;
export const TIER0_MAX_WORDS = 450;
// Dates the free evaluation may state that are not case facts (SRF effective dates).
export const TIER0_EXTRA_DATES = ["2024-12-16", "2025-06-16"];
// The model may not give its own SRF, IMDA or telco verdict; the server writes that section from fixed rules.
export const SRF_VERDICT = /\bSRF\b|shared responsibility|\bIMDA\b|\btelcos?\b|mobile operator/i;

// The SRF section is the server's (rules/srf.ts), so any SRF or telco verdict from the model fails, as does "the
// user" instead of "you"; internal wording and a summary far too short or long are style violations.
// Context the person did not give ("at home", "with family"): rewritten by the AI, never deleted (item 10).
const ADDED_CONTEXT = /\b(?:while )?at home\b|\bhaving dinner\b|\bwith (?:(?:my|his|her|their) )?family\b|\bwatching tv\b/i;

export const TIER0_CHECKS: ValidateOptions = {
  extraDates: TIER0_EXTRA_DATES,
  secondPerson: true,
  forbidden: [
    { pattern: SRF_VERDICT, detail: "the SRF assessment is written by the server" },
    { pattern: ADDED_CONTEXT, detail: "do not say where you were or who you were with; rewrite without it" },
  ],
  userFacing: { minWords: TIER0_MIN_WORDS, maxWords: TIER0_MAX_WORDS },
};

export interface Tier0Finding {
  fact_key: string;
  finding_type: string;
  values: unknown;
  resolution: unknown;
}

export function buildTier0Input(args: {
  facts: SnapshotFacts;
  findings: readonly Tier0Finding[];
  storyText: string | null;
  fidrecCheck: unknown;
}) {
  const { facts, findings } = args;
  // If the user settled a conflict against their story (chose a value the story does not support, or typed their
  // own), the model is not shown the story: it copies the story's version even when told not to. The evaluation is
  // then written from the confirmed facts alone.
  const conflicts = findings.filter((f) => f.finding_type === "conflict");
  type StoredValue = { sources?: Array<{ sourceType?: string }> };
  const fromStory = (v: StoredValue | undefined) => Boolean(v?.sources?.some((s) => s.sourceType === "story"));
  const storyOverruled = conflicts.some((f) => {
    const values = (f.values ?? []) as StoredValue[];
    const resolution = f.resolution as { kind?: string; index?: number } | null;
    if (!resolution || !values.some(fromStory)) return false;
    if (resolution.kind === "value") return true;
    return resolution.kind === "choice" && !fromStory(values[resolution.index ?? -1]);
  });

  const institutions = (facts.institution_names?.value as Institution[] | null) ?? [];
  const loss = (facts.total_loss?.value as Money | null) ?? null;
  const transactions = (facts.transactions?.value as Transaction[] | null) ?? [];
  const firstDate = transactions.map((t) => t.date).filter((d): d is string => Boolean(d)).sort()[0] ?? null;

  return {
    case: {
      institution_name: institutions.map((i) => i.name).join(", ") || null,
      claim_amount: loss?.amount ?? null,
      claim_currency: loss?.currency ?? null,
      incident_date: firstDate,
      incident_datetime: null,
    },
    confirmed_facts: Object.fromEntries(
      Object.entries(facts).map(([key, fact]) => [
        key,
        {
          status: fact!.label,
          value: fact!.label === "not_sure" || fact!.label === "not_known" ? null : formatFactValue(key as FactKey, fact!.value),
        },
      ]),
    ),
    // Spelled out per fact: the model does not reliably apply the status rule to facts it also reads in the story.
    facts_without_document: Object.entries(facts)
      .filter(([, fact]) => fact!.label === "claimant_only")
      .map(([key, fact]) => `${key}: ${formatFactValue(key as FactKey, fact!.value)}`),
    facts_not_confirmed: Object.entries(facts)
      .filter(([, fact]) => fact!.label === "not_sure" || fact!.label === "not_known")
      .map(([key]) => key),
    primary_narrative: storyOverruled ? null : args.storyText,
    fidrec_check: args.fidrecCheck,
  };
}

export function tier0System(previousFailures: string | null): string {
  return `You are writing the free evaluation for someone who may have lost money to a scam: an early-stage, informational summary that helps them see what happened and what evidence helps. It is not a legal determination, not an eligibility decision and not compensation advice.

GROUND RULES
Use only facts explicitly present in the provided JSON. Do not infer, assume, invent facts, or introduce external knowledge (e.g. how scams usually work). If something is missing, say it was not provided. Be neutral, factual, chronological, clear, calm and non-judgemental. Do not provide legal advice, do not determine liability, and do not say whether the person is eligible for compensation.
Write to the person directly in the second person ("you", "your") throughout. Never write "the user", "the claimant" or "the customer".
Do not assess or mention the Shared Responsibility Framework (SRF), IMDA or telco responsibility, and do not say whether any scheme applies: GuideBuoy adds that assessment separately from fixed rules.

FIDREC_CHECK (optional object in input JSON)
The fidrec_check block is a soft, reference-list signal only. Do not mention FIDReC eligibility.

SUMMARY HARD RULES
Do not add personal circumstances, location, family context, emotions, or surrounding scene details unless explicitly stated in the input. Do not add inferred context such as where the person was, what device they used, or what they were doing at the time, unless the input explicitly says so. If a fact is not explicitly in the input, do not include it.

OUTPUT
Return STRICT JSON only, with this exact structure (no extra keys):
{
"summary": "string"
}

SUMMARY
Produce a clear, chronological summary covering: how the scam or contact started; what you did; the payments or losses; and what happened afterwards (e.g. reporting, contact with the bank). Do not add interpretation or judgement.

CONFIRMED FACTS (these override everything else in the input)
confirmed_facts holds the facts the user confirmed, each with a status. Use them as the facts of the case.
- status "confirmed": state as fact.
- status "claimant_only": the user has no document for it; attribute it ("according to you", "you say").
- status "not_sure" or "not_known": say it is not confirmed; never state a value for it.
facts_without_document lists the facts the user has no document for. Every sentence that mentions one of them must
start with "You told us that". facts_not_confirmed lists facts that are not confirmed: say so and give no value.
Never state a date, amount, institution or yes/no fact that differs from confirmed_facts. primary_narrative is the
user's own story: use it only for the order of events and context, never for a fact that confirmed_facts covers.
If primary_narrative is null, the user corrected their story; write only from confirmed_facts.
A fact listed in facts_not_confirmed, or missing from confirmed_facts, has no value in the summary even when
primary_narrative mentions one: do not state that amount, date, institution or reference.
Write neutrally: do not overstate or understate.
Write the summary in ${TIER0_MIN_WORDS + 40} to ${TIER0_MAX_WORDS - 100} words of plain prose. Never use the input's field names
(such as confirmed_facts or reported_to_police) or internal names; describe the facts in ordinary words.${previousFailures ? `

YOUR PREVIOUS ANSWER WAS REJECTED for these problems:
${previousFailures}
Fix these points and keep everything else faithful to the confirmed facts.` : ""}`;
}
