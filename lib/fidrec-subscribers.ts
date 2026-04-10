/**
 * FIDReC subscriber lookup.
 * Source: FIDReC member list + MAS Financial Institutions Directory.
 * E-wallet providers added 16 December 2024 per Shared Responsibility Framework.
 */

const FIDREC_SUBSCRIBER_KEYWORDS: string[] = [
  // Major Singapore / international banks
  "dbs", "posb", "ocbc", "uob", "standard chartered", "stanchart", "citibank", "citi",
  "hsbc", "maybank", "rhb", "cimb", "bank of china", "boc", "icbc", "bnp paribas",
  "credit agricole", "societe generale", "jpmorgan", "goldman sachs", "deutsche bank",
  "barclays", "ing", "abn amro", "ubs", "macquarie", "commonwealth bank", "anz",
  "bank of america", "wells fargo", "state street", "northern trust", "natwest",
  "credit suisse", "rabobank", "westpac", "nab",
  // Singapore finance companies
  "sing investments", "hong leong finance", "singapura finance", "orix leasing",
  // Insurance (if licensed FI disputing financial products)
  "great eastern", "manulife", "prudential", "aia", "aviva", "income", "ntuc income",
  "tokio marine", "allianz", "liberty insurance", "zurich", "axa", "sun life",
  "singlife", "singlife with aviva", "etiqa", "fwd", "china taiping",
  // Brokerages
  "phillip capital", "uob kay hian", "dbs vickers", "ocbc securities", "cgs-cimb",
  "cgs cimb", "lim & tan", "ig markets", "saxo bank",
  // E-wallets (FIDReC subscribers since 16 Dec 2024, per SRF)
  "grabpay", "grab pay", "revolut", "youtrip", "you trip",
  "nets", "paylah", "dbs paylah",
]

/**
 * Returns true if the named institution is likely a FIDReC subscriber.
 * Uses keyword substring matching — intentionally lenient.
 */
export function isFIDReCSubscriber(fiName: string | null | undefined): boolean {
  if (!fiName) return false
  const normalized = fiName.toLowerCase().replace(/[^a-z0-9 ]/g, " ").trim()
  return FIDREC_SUBSCRIBER_KEYWORDS.some(
    (keyword) => normalized.includes(keyword) || keyword.includes(normalized),
  )
}
