export type ClaimType = "Financial Dispute"

export function getNextStepsForRuleEngine(): string[] {
  return [
    "Secure your accounts: reset passwords and enable multi-factor authentication.",
    "Call your bank or platform hotline to freeze affected accounts or cards.",
    "File a police report (SPF) with reference numbers, links, or screenshots.",
    "Document all communications with the institution (dates, times, reference numbers).",
  ]
}
