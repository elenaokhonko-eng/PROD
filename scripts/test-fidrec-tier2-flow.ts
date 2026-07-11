type JsonObject = Record<string, unknown>

type AssertionMatrixRow = {
  assertion_text: string
  links: Array<{
    relationship: string
    explanation: string | null
    finding: {
      finding_text: string
    }
  }>
}

type MatrixResponse = {
  bank_assertions: AssertionMatrixRow[]
  unlinked_findings: Array<{ finding_text: string }>
}

const SAMPLE_BANK_FINAL_RESPONSE = `Dear Sir / Madam
Your recent dispute request(s) on your card transaction is/are unsuccessful following our investigation.
The transaction(s) you indicated cannot be disputed as it falls under one of the following descriptions:
1. 3D Secure transactions are authenticated during the purchase.
2. Contactless transactions require physical or digital cards (mobile wallet device) to be presented during the purchase.
3. EMV Chip transactions require physical cards to be presented during the purchase.
Thank you for banking with us.
Yours faithfully
DBS Bank Ltd`

const SAMPLE_PROCESSED_EVIDENCE_JSON = {
  evidence: [
    {
      type: "hotline_call_log",
      summary: "Customer called the bank fraud hotline at 09:21 on 23 October after discovering disputed transactions.",
    },
    {
      type: "transaction_statement",
      summary: "Five disputed transactions occurred within 18 minutes.",
    },
    {
      type: "sms_token_binding",
      summary: "A new digital token was registered before the disputed transactions.",
    },
  ],
}

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim()
  if (!value) {
    throw new Error(`Missing required env var: ${name}`)
  }
  return value
}

function optionalEnv(name: string): string | undefined {
  const value = process.env[name]?.trim()
  return value || undefined
}

async function requestJson<T>(url: string, init: RequestInit): Promise<T> {
  const response = await fetch(url, init)
  const responseText = await response.text()
  const parsedBody = responseText ? JSON.parse(responseText) : null

  if (!response.ok) {
    throw new Error(
      `Request failed (${response.status}) ${init.method ?? "GET"} ${url}\nResponse: ${JSON.stringify(parsedBody, null, 2)}`,
    )
  }

  return parsedBody as T
}

function printMatrixSummary(matrix: MatrixResponse) {
  console.log("\n=== Tier-2 Matrix Summary ===")
  for (const assertion of matrix.bank_assertions) {
    console.log(`\nAssertion: ${assertion.assertion_text}`)
    if (!assertion.links.length) {
      console.log("  (no links)")
      continue
    }

    for (const link of assertion.links) {
      console.log(`  Finding: ${link.finding.finding_text}`)
      console.log(`  Relationship: ${link.relationship}`)
      console.log(`  Explanation: ${link.explanation ?? ""}`)
    }
  }
}

async function main() {
  const baseUrl = process.env.TEST_BASE_URL?.trim() || "http://localhost:3000"
  const authToken = requiredEnv("TEST_AUTH_TOKEN")
  const caseId = requiredEnv("TEST_CASE_ID")
  const sourceDocumentId = optionalEnv("TEST_SOURCE_DOCUMENT_ID")

  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${authToken}`,
  }

  console.log("Running Tier-2 FIDReC API flow...")
  console.log(`Base URL: ${baseUrl}`)
  console.log(`Case ID: ${caseId}`)

  const extract = await requestJson<{ bank_assertions: unknown[] }>(
    `${baseUrl}/api/fidrec/tier2/extract-bank-assertions`,
    {
      method: "POST",
      headers,
      body: JSON.stringify({
        caseId,
        sourceDocumentId,
        bankFinalResponseText: SAMPLE_BANK_FINAL_RESPONSE,
      }),
    },
  )

  const findings = await requestJson<{ case_findings: unknown[] }>(
    `${baseUrl}/api/fidrec/tier2/generate-case-findings`,
    {
      method: "POST",
      headers,
      body: JSON.stringify({
        caseId,
        processedEvidenceJson: SAMPLE_PROCESSED_EVIDENCE_JSON,
      }),
    },
  )

  const links = await requestJson<{ links: unknown[] }>(`${baseUrl}/api/fidrec/tier2/link-assertions-findings`, {
    method: "POST",
    headers,
    body: JSON.stringify({ caseId }),
  })

  const matrix = await requestJson<MatrixResponse>(
    `${baseUrl}/api/fidrec/tier2/assertion-finding-matrix?caseId=${encodeURIComponent(caseId)}`,
    {
      method: "GET",
      headers,
    },
  )

  console.log("\n=== Counts ===")
  console.log(`Bank assertions: ${extract.bank_assertions.length}`)
  console.log(`Case findings: ${findings.case_findings.length}`)
  console.log(`Links: ${links.links.length}`)
  console.log(`Unlinked findings: ${matrix.unlinked_findings.length}`)

  printMatrixSummary(matrix)
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error)
  console.error("\nTier-2 flow test failed:")
  console.error(message)
  process.exit(1)
})
