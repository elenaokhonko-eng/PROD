import { isFIDReCSubscriber } from "@/lib/fidrec-subscribers"

export type ClaimType = "Financial Dispute"

/** The six routing paths from PRD §5. */
export type TriagePath = "A" | "A2" | "B" | "C" | "D" | "E"

/** Triage signals extracted from the user's narrative by the classify AI. */
export interface TriageSignals {
  /** Did money actually leave the user's account? */
  money_lost: boolean
  /**
   * Three-way Q2 classification (PRD §5).
   * - unauthorized_access: account accessed without user's involvement
   * - deceived_into_acting: tricked into clicking a link / entering credentials / transferring
   * - voluntary_transfer: willingly sent money under false pretences
   */
  transaction_type: "unauthorized_access" | "deceived_into_acting" | "voluntary_transfer" | "unknown"
  scam_type: "phishing" | "investment" | "romance" | "job" | "government_impersonation" | "ecommerce" | "other" | "unknown"
  /**
   * Delivery channel — only relevant for phishing (Q3b in PRD).
   * Only SMS, email, WhatsApp/Telegram/RCS qualify for SRF.
   */
  scam_channel: "sms" | "email" | "whatsapp_telegram_rcs" | "phone_call" | "physical_letter" | "website_social_media" | "unknown" | null
  /** Was the scammer impersonating a legitimate entity (bank, govt, brand)? Q3c in PRD. */
  entity_impersonation: boolean | null
  /** Name of bank or financial platform involved. */
  fi_name: string | null
  /** ISO date string (YYYY-MM-DD) of incident if mentioned. */
  incident_date: string | null
  /** Has user already contacted their bank about this? */
  bank_contacted: boolean | null
  /** ISO date when user first contacted their bank. */
  bank_contact_date: string | null
  /** Has the bank given a final reply or rejection? */
  bank_final_reply: boolean | null
  /** Has the user already filed a police report? */
  police_report_filed: boolean | null
  /** Approximate SGD amount lost. */
  claim_amount_sgd: number | null
  /** One-sentence plain-language summary of what happened. */
  summary: string
  /** Does the narrative suggest the user is overwhelmed, elderly, or in acute distress? */
  distress_signals: boolean
}

/** Output of the rules engine — drives the results page UI. */
export interface PathResult {
  triage_path: TriagePath
  srf_eligible: boolean
  fidrec_subscriber: boolean
  /** Legacy field preserved for backward compatibility with the assess API contract. */
  recommended_path: "fidrec_eligible" | "waitlist" | "self_service" | "not_eligible"
  eligibility_score: number
  success_probability: "high" | "medium" | "low"
  reasoning: string[]
  missing_info: string[]
  next_steps: string[]
  estimated_timeline: string
  /** Urgent deadline warning, if FIDReC 6-month window is within 4 weeks. */
  deadline_warning: string | null
  /** Days elapsed since user contacted their bank (for Path C countdown). */
  bank_contact_days_elapsed: number | null
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

const SRF_DIGITAL_CHANNELS = new Set(["sms", "email", "whatsapp_telegram_rcs"])
/** SRF applies only to incidents on or after this date. */
const SRF_START_DATE = new Date("2024-12-16")

function daysSince(isoDate: string): number {
  return Math.floor((Date.now() - new Date(isoDate).getTime()) / 86_400_000)
}

function deadlineWarning(bankReplyDate: string | null, incidentDate: string | null): string | null {
  const ref = bankReplyDate ?? incidentDate
  if (!ref) return null
  const daysLeft = 180 - daysSince(ref)
  if (daysLeft <= 0) return "The 6-month FIDReC filing window may have passed. File as soon as possible and explain the delay."
  if (daysLeft <= 28) return `Urgent: approximately ${daysLeft} days left to file with FIDReC.`
  return null
}

function getNextStepsForPath(path: TriagePath, signals: TriageSignals): string[] {
  switch (path) {
    case "A":
      return [
        "Call your bank's anti-scam hotline now and request an account freeze.",
        signals.police_report_filed
          ? "You've filed a police report — keep the reference number for your case."
          : "File a police report at police.gov.sg/iwitness or call ScamShield (1799).",
        "Do not delete any messages, screenshots, or bank notifications — these are your evidence.",
        "We'll help you assess whether your bank met its SRF duties and build your FIDReC submission.",
      ]
    case "A2":
      return [
        signals.police_report_filed
          ? "You've filed a police report — keep the reference number."
          : "File a police report first at police.gov.sg/iwitness or call ScamShield (1799).",
        "Preserve all SMS messages, especially those with spoofed sender IDs.",
        "Contact IMDA to file a complaint about the telco's failure to block fraudulent SMS sender IDs.",
        "You can also pursue FIDReC in parallel if your bank had any role in the loss.",
      ]
    case "B":
      return [
        signals.police_report_filed
          ? "You've filed a police report — keep the reference number for your FIDReC submission."
          : "File a police report at police.gov.sg/iwitness before building your FIDReC case.",
        "Locate your bank's final rejection letter — FIDReC requires this to proceed.",
        "Gather all bank statements, transaction records, and correspondence.",
        "We'll help you build a structured FIDReC submission package.",
      ]
    case "C":
      return [
        signals.bank_contacted
          ? "You've contacted your bank — document the date and keep all reference numbers."
          : "Contact your bank's dispute resolution team today and get a written acknowledgement.",
        "FIDReC requires a 4-week waiting period after your first bank contact — we'll track this for you.",
        "Use this time to gather all evidence: screenshots, bank statements, transaction records.",
        "Do not send additional funds or engage further with the scammer.",
        "We'll remind you when it's time to escalate to FIDReC.",
      ]
    case "D":
      return [
        signals.money_lost
          ? "Report this to the police at police.gov.sg/iwitness even if formal recovery is unlikely."
          : "Report suspicious activity to the police or ScamShield (1799) to protect others.",
        "File a complaint with the Consumers Association of Singapore (CASE) if a business is involved.",
        "Check the MAS Financial Institutions Directory to verify if your institution is licensed.",
        "Consider contacting Pro Bono SG if you need free legal advice.",
      ]
    case "E":
      return [
        "File a police report at police.gov.sg/iwitness — this is critical even if recovery is unlikely.",
        "Call ScamShield helpline: 1799 (24/7).",
        "Check the MAS investor alert list to see if the platform was flagged.",
        "Seek free legal advice at a Pro Bono SG legal clinic.",
        "If you are in financial distress, Credit Counselling Singapore (CCS) can help: creditcounselling.org.sg",
      ]
  }
}

function getTimeline(path: TriagePath): string {
  switch (path) {
    case "A":
      return "SRF claims: bank must respond within 21 business days. If unresolved, FIDReC Early Resolution takes 10 business days; mediation can take weeks; adjudication may take months."
    case "A2":
      return "IMDA complaint processing typically takes 2–4 weeks for acknowledgement. Resolution timelines vary."
    case "B":
      return "FIDReC Early Resolution: 10 business days. Mediation: several weeks. Adjudication: up to several months."
    case "C":
      return "4-week mandatory waiting period from your first bank contact. After that, FIDReC Early Resolution takes 10 business days."
    case "D":
      return "Police reports can take weeks to months to investigate. CASE complaints typically resolve within 30–60 days. Civil courts vary widely."
    case "E":
      return "Formal recovery of overseas or crypto funds is very difficult. Police investigations may take many months. We'll be honest about what's realistic."
  }
}

function computeScore(path: TriagePath, signals: TriageSignals, fidrec: boolean): number {
  const baseScores: Record<TriagePath, number> = {
    A: 78, A2: 55, B: 62, C: 55, D: 35, E: 20,
  }
  let score = baseScores[path]

  if (signals.police_report_filed) score += 5
  if (signals.claim_amount_sgd !== null && signals.claim_amount_sgd <= 150_000) score += 5
  if (signals.entity_impersonation === true) score += 4
  if (signals.bank_final_reply === true && (path === "B")) score += 6
  if (fidrec) score += 3
  if (signals.fi_name === null) score -= 5
  if (signals.incident_date === null) score -= 3
  if (signals.claim_amount_sgd === null) score -= 3

  return Math.min(100, Math.max(5, score))
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Deterministic 6-path routing engine implementing PRD §5.
 * Takes triage signals extracted by the classify AI and returns a structured result.
 */
export function determinePath(signals: TriageSignals): PathResult {
  const fiIsFIDReCSubscriber = isFIDReCSubscriber(signals.fi_name)
  const reasons: string[] = []
  const missingInfo: string[] = []

  // SRF eligibility: all 5 conditions must be met
  const incidentAfterSRF =
    signals.incident_date != null ? new Date(signals.incident_date) >= SRF_START_DATE : null
  const srfChannel = signals.scam_channel != null && SRF_DIGITAL_CHANNELS.has(signals.scam_channel)

  const srfEligible =
    signals.money_lost &&
    signals.scam_type === "phishing" &&
    srfChannel &&
    signals.entity_impersonation === true &&
    incidentAfterSRF === true &&
    fiIsFIDReCSubscriber

  // Bank contact timing
  let bankContactDaysElapsed: number | null = null
  if (signals.bank_contact_date) {
    bankContactDaysElapsed = daysSince(signals.bank_contact_date)
  }

  const bankWaitingPeriodComplete =
    signals.bank_final_reply === true ||
    (bankContactDaysElapsed !== null && bankContactDaysElapsed >= 28)

  // ------- Routing decision tree (PRD §5) -------
  let path: TriagePath

  if (!signals.money_lost) {
    path = "D"
    reasons.push("No financial loss has occurred.")
    reasons.push("We'll give you guidance on how to protect yourself and report the suspicious activity.")
  } else if (srfEligible) {
    // Path A — SRF eligible
    path = "A"
    reasons.push("Your case may qualify for a refund under Singapore's Shared Responsibility Framework (SRF).")
    reasons.push("The scam arrived via a digital messaging channel (SMS, email, or messaging app) — a key SRF condition.")
    if (signals.entity_impersonation) reasons.push("The scammer impersonated a legitimate entity, which is required for SRF.")
    if (incidentAfterSRF) reasons.push("The incident occurred after 16 December 2024 when the SRF took effect.")
    if (fiIsFIDReCSubscriber) reasons.push(`${signals.fi_name ?? "Your financial institution"} subscribes to FIDReC.`)
  } else if (
    signals.money_lost &&
    signals.scam_type === "phishing" &&
    signals.scam_channel === "sms" &&
    signals.entity_impersonation === true &&
    incidentAfterSRF === true &&
    fiIsFIDReCSubscriber
  ) {
    // Path A2 — SRF waterfall: FI complied but telco may have failed
    path = "A2"
    reasons.push("Your case involves a phishing scam via SMS with a spoofed sender ID.")
    reasons.push("If your bank met all its SRF duties, the telco may be responsible for failing to block the fraudulent sender ID.")
    reasons.push("We'll guide you through filing a complaint with IMDA about the telco's obligations.")
  } else if (signals.money_lost && fiIsFIDReCSubscriber) {
    if (!signals.bank_contacted) {
      // Must contact bank first
      path = "C"
      reasons.push("FIDReC requires you to raise the dispute with your bank directly before filing.")
      reasons.push("Once contacted, you'll need to wait up to 4 weeks for a bank response before escalating.")
      missingInfo.push("Date you first contacted your bank about this dispute")
    } else if (!bankWaitingPeriodComplete) {
      // Still in 4-week waiting period
      path = "C"
      reasons.push("You've contacted your bank — FIDReC requires a 4-week waiting period before you can escalate.")
      if (bankContactDaysElapsed !== null) {
        const daysLeft = 28 - bankContactDaysElapsed
        reasons.push(`You're on day ${bankContactDaysElapsed} of the waiting period — ${daysLeft} more days before you can file with FIDReC.`)
      }
    } else {
      // Ready for FIDReC
      path = "B"
      reasons.push(`Your dispute with ${signals.fi_name ?? "your financial institution"} may be eligible for FIDReC.`)
      if (signals.bank_final_reply) {
        reasons.push("Your bank has issued a final reply — you can now file with FIDReC.")
      } else {
        reasons.push("More than 4 weeks have passed since you contacted your bank — you're eligible to escalate to FIDReC.")
      }
    }
  } else if (signals.money_lost) {
    // No FIDReC subscriber — check if crypto/overseas
    const likelyCryptoOrOverseas =
      signals.scam_type === "investment" ||
      (signals.fi_name != null &&
        ["crypto", "bitcoin", "binance", "bybit", "coinbase", "metamask", "usdt", "eth"].some((k) =>
          signals.fi_name!.toLowerCase().includes(k),
        ))

    if (likelyCryptoOrOverseas) {
      path = "E"
      reasons.push("Cryptocurrency or overseas platforms have very limited formal recovery options in Singapore.")
      reasons.push("We'll be honest with you about what's realistically possible and guide you on the best available steps.")
    } else {
      path = "D"
      reasons.push(`${signals.fi_name ?? "The financial institution involved"} may not subscribe to FIDReC.`)
      reasons.push("We'll guide you on alternative paths: MAS complaint, CASE (Consumers Association of Singapore), or civil courts.")
    }
  } else {
    path = "D"
    reasons.push("Based on what you've shared, we'll point you to the most relevant options and support resources.")
  }

  // Missing info prompts
  if (signals.fi_name === null) missingInfo.push("Name of your bank or financial platform")
  if (signals.incident_date === null) missingInfo.push("Approximate date the incident occurred")
  if (signals.police_report_filed === null) missingInfo.push("Whether you have filed a police report")
  if (signals.money_lost && signals.claim_amount_sgd === null) missingInfo.push("Approximate amount lost in SGD")

  // Map to legacy recommended_path for backward compatibility
  const recommended_path: PathResult["recommended_path"] =
    path === "A" || path === "A2" || path === "B" || path === "C" ? "fidrec_eligible" : "self_service"

  const deadline_warning = deadlineWarning(
    signals.bank_final_reply && signals.bank_contact_date ? signals.bank_contact_date : null,
    signals.incident_date,
  )

  return {
    triage_path: path,
    srf_eligible: srfEligible,
    fidrec_subscriber: fiIsFIDReCSubscriber,
    recommended_path,
    eligibility_score: computeScore(path, signals, fiIsFIDReCSubscriber),
    success_probability: path === "A" ? "high" : path === "B" || path === "A2" || path === "C" ? "medium" : "low",
    reasoning: reasons,
    missing_info: missingInfo,
    next_steps: getNextStepsForPath(path, signals),
    estimated_timeline: getTimeline(path),
    deadline_warning,
    bank_contact_days_elapsed: bankContactDaysElapsed,
  }
}

/** Legacy helper — still called by legacy code paths. */
export function getNextStepsForRuleEngine(): string[] {
  return [
    "Secure your accounts: reset passwords and enable multi-factor authentication.",
    "Call your bank or platform hotline to freeze affected accounts or cards.",
    "File a police report (SPF) with reference numbers, links, or screenshots.",
    "Document all communications with the institution (dates, times, reference numbers).",
  ]
}
