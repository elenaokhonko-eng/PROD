export type ClaimType = "Financial Dispute"
export type ClaimSubtype = "Scam" | "Fraud"

export function getNextStepsForRuleEngine(subtype: ClaimSubtype): string[] {
  switch (subtype) {
    case "Scam":
      return [
        "Secure your accounts: reset passwords and enable multi-factor authentication.",
        "Call your bank or platform hotline to freeze affected accounts or cards.",
        "File a police report (SPF) with reference numbers, links, or screenshots.",
      ]
    case "Fraud":
      return [
        "Gather contracts, invoices, chats, and proof of the misrepresentation or deception.",
        "File a formal complaint with the institution or platform; request a reference number.",
        "Escalate with supporting evidence if the institution stalls or rejects your complaint.",
      ]
    default:
      return []
  }
}
