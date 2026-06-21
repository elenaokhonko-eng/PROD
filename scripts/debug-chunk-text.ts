import "./load-local-env.ts"

import { createServiceClient } from "../lib/supabase/service.ts"
import { generateEvidenceLabels } from "../lib/server/fidrec/generate-evidence-labels.ts"

const caseId = "688154e7-9cda-47ef-9cff-a27581766c3a"

async function main() {
  const supabase = createServiceClient()
  const { evidence_labels } = await generateEvidenceLabels({ caseId })

  for (const label of evidence_labels.filter((l) =>
    ["police_report", "customer_narrative"].includes(l.evidence_type),
  )) {
    const { data: doc } = await supabase
      .from("case_documents")
      .select("id, content_latest_id")
      .eq("id", label.case_document_id)
      .maybeSingle()

    let chunkText = ""
    if (doc?.content_latest_id) {
      const { data: chunks } = await supabase
        .from("case_document_chunks")
        .select("chunk_text")
        .eq("content_id", doc.content_latest_id)
        .order("chunk_index", { ascending: true })
      chunkText = (chunks ?? []).map((c) => c.chunk_text).join("\n")
    }

    console.log(`\n=== ${label.label} ${label.evidence_type} len=${chunkText.length} ===`)
    const aed = [...chunkText.matchAll(/\bAED\s*[\d,]+(?:\.\d{2})?/gi)].map((m) => m[0])
    const sgd = [...chunkText.matchAll(/\bS(?:GD|\$)\s*[\d,]+(?:\.\d{2})?/gi)].map((m) => m[0])
    console.log("AED:", aed.slice(0, 10))
    console.log("SGD:", sgd.slice(0, 10))
    console.log("snippet:", chunkText.slice(0, 600))
  }
}

main().catch(console.error)
