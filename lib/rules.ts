export type ClaimType =
  | "Phishing Scam"
  | "Mis-sold Product"
  | "Denied Insurance Claim"
  | "Police Matter"
  | "Other/Unclear"

export function getNextStepsForRuleEngine(claimType: ClaimType): string[] {
  switch (claimType) {
    case "Phishing Scam":
      return [
        "Immediately contact the financial institution to freeze affected accounts.",
        "Reset online banking passwords and enable multi-factor authentication.",
        "File a police report with the Singapore Police Force.",
      ]
    case "Mis-sold Product":
      return [
        "Gather all product brochures, chats, and sales documentation.",
        "Submit a formal complaint to the financial institution’s customer care team.",
        "Escalate to the appropriate dispute body if the matter is not resolved within 20 business days.",
      ]
    case "Denied Insurance Claim":
      return [
        "Review the insurer’s rejection letter and note the stated reasons.",
        "Collect medical reports, policy documents, and any appeal correspondence.",
        "File an appeal with the insurer and escalate to the relevant ombudsman if unsatisfied.",
      ]
    case "Police Matter":
      return [
        "File a police report with the Singapore Police Force as soon as possible.",
        "Inform the financial institution of the report number to flag suspicious activity.",
        "Monitor accounts closely for further fraudulent activity.",
      ]
    case "Other/Unclear":
    default:
      return [
        "Request additional details from the user to clarify the dispute.",
        "Encourage the user to compile supporting documents before escalating.",
      ]
  }
}
