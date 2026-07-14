/**
 * Document readiness unit + contract tests.
 * Run: pnpm test:document-readiness
 */
import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { readFileSync } from "node:fs"
import path from "node:path"
import {
  areDocumentsSettled,
  classifyDocument,
  countDocumentReadiness,
  decideExtractDocumentReadiness,
  documentsNotReadyResponse,
  extractRunReadinessPersistFields,
  type DocStatusRow,
} from "../lib/case-documents/document-readiness"

function doc(
  id: string,
  processing_status: string | null,
  opts?: { is_processed?: boolean; has_extraction_content?: boolean },
): DocStatusRow {
  return {
    id,
    processing_status,
    is_processed: opts?.is_processed ?? false,
    has_extraction_content: opts?.has_extraction_content ?? false,
  }
}

function usable(id: string): DocStatusRow {
  return doc(id, "ready", { is_processed: true, has_extraction_content: true })
}

describe("classifyDocument", () => {
  it("ready requires status ready + is_processed + extraction", () => {
    assert.equal(classifyDocument(usable("1")), "ready")
    assert.equal(
      classifyDocument(doc("2", "ready", { is_processed: true, has_extraction_content: false })),
      "not_ready_other",
    )
    assert.equal(
      classifyDocument(doc("3", "ready", { is_processed: false, has_extraction_content: true })),
      "not_ready_other",
    )
  })

  it("uploaded / null / unknown are not_ready", () => {
    assert.equal(classifyDocument(doc("1", "uploaded")), "uploaded")
    assert.equal(classifyDocument(doc("2", null)), "not_ready_other")
    assert.equal(classifyDocument(doc("3", "weird")), "not_ready_other")
  })
})

describe("extract preflight gate", () => {
  it("uploaded blocks", () => {
    const d = decideExtractDocumentReadiness([usable("1"), doc("2", "uploaded")])
    assert.equal(d.ready, false)
    assert.equal(d.counts.uploaded, 1)
    assert.equal(d.counts.not_ready, 1)
  })

  it("unknown/null blocks", () => {
    assert.equal(decideExtractDocumentReadiness([doc("1", null)]).ready, false)
    assert.equal(decideExtractDocumentReadiness([doc("1", "???")]).ready, false)
  })

  it("queued/in-flight blocks", () => {
    for (const status of ["queued", "parsing", "verifying", "chunking", "extracting", "processing"]) {
      assert.equal(decideExtractDocumentReadiness([doc("1", status)]).ready, false, status)
    }
  })

  it("ready without extraction blocks", () => {
    const d = decideExtractDocumentReadiness([
      doc("1", "ready", { is_processed: true, has_extraction_content: false }),
    ])
    assert.equal(d.ready, false)
    assert.equal(d.counts.not_ready, 1)
  })

  it("ready with extraction allows", () => {
    const d = decideExtractDocumentReadiness([usable("1"), usable("2")])
    assert.equal(d.ready, true)
    assert.equal(d.counts.ready, 2)
    assert.equal(d.all_settled, true)
  })

  it("failed does not block", () => {
    const d = decideExtractDocumentReadiness([
      usable("1"),
      doc("2", "failed"),
    ])
    assert.equal(d.ready, true)
    assert.equal(d.counts.failed, 1)
    assert.equal(d.all_settled, true)
  })

  it("zero documents allows extract", () => {
    assert.equal(decideExtractDocumentReadiness([]).ready, true)
  })

  it("partial override allows and persist fields mark partial", () => {
    const d = decideExtractDocumentReadiness([doc("1", "queued"), usable("2")], {
      allowPartialEvidence: true,
    })
    assert.equal(d.ready, true)
    const persist = extractRunReadinessPersistFields(d, true)
    assert.equal(persist.allow_partial_evidence, true)
    assert.equal(persist.not_ready_document_count, 1)
    assert.equal(persist.queued_document_count, 1)
    assert.ok(persist.evidence_snapshot.not_ready_ids.includes("1"))
  })

  it("blocked response shape", () => {
    const counts = countDocumentReadiness([
      usable("1"),
      doc("2", "queued"),
      doc("3", "parsing"),
      doc("4", "uploaded"),
      doc("5", "failed"),
    ])
    const body = documentsNotReadyResponse(counts)
    assert.equal(body.error, "documents_not_ready")
    assert.equal(body.documents_not_ready.total, 5)
    assert.equal(body.documents_not_ready.ready, 1)
    assert.equal(body.documents_not_ready.queued, 1)
    assert.equal(body.documents_not_ready.processing, 1)
    assert.equal(body.documents_not_ready.uploaded, 1)
    assert.equal(body.documents_not_ready.failed, 1)
    assert.equal(body.documents_not_ready.not_ready, 3)
  })

  it("areDocumentsSettled only when ready+failed", () => {
    assert.equal(areDocumentsSettled([usable("1"), doc("2", "failed")]), true)
    assert.equal(areDocumentsSettled([usable("1"), doc("2", "queued")]), false)
  })

  it("no auth.uid/auth.users", () => {
    const src = readFileSync(
      path.join(process.cwd(), "lib/case-documents/document-readiness.ts"),
      "utf8",
    )
    assert.doesNotMatch(src, /auth\.uid\(|auth\.users/)
  })
})

describe("edge extract caller contracts", () => {
  it("evidence route treats documents_not_ready as pending", () => {
    const src = readFileSync(
      path.join(process.cwd(), "app/api/edge/evidence/route.ts"),
      "utf8",
    )
    assert.match(src, /documents_not_ready/)
    assert.match(src, /fireExtractWhenSettled/)
  })

  it("auto-refire waits for settled docs and ignores 409", () => {
    const src = readFileSync(
      path.join(process.cwd(), "hooks/state-machine/layer1/use-auto-refire-extract.ts"),
      "utf8",
    )
    assert.match(src, /documents_not_ready/)
    assert.match(src, /areDocumentsSettled/)
    assert.match(src, /409/)
  })

  it("edge function blocks before openai and persists snapshot fields", () => {
    const src = readFileSync(
      path.join(process.cwd(), "supabase/functions/run_case_extract_v4/index.ts"),
      "utf8",
    )
    assert.match(src, /05b_doc_readiness/)
    assert.match(src, /documents_not_ready/)
    assert.match(src, /allow_partial_evidence/)
    assert.match(src, /not_ready_document_count/)
    assert.match(src, /evidence_snapshot/)
    assert.doesNotMatch(src, /auth\.uid\(|auth\.users/)
    // blocked path returns before openaiExtract call positionally: readiness mark precedes openai mark
    const readinessIdx = src.indexOf("05b_doc_readiness")
    const openaiIdx = src.indexOf("08_openai_start")
    assert.ok(readinessIdx > 0 && openaiIdx > readinessIdx)
  })
})

describe("fireExtractWhenSettled overlap", () => {
  it("skips when docs not settled", async () => {
    const { fireExtractWhenSettled } = await import(
      "../lib/case-documents/fire-extract-when-settled"
    )
    const result = await fireExtractWhenSettled({
      caseId: "00000000-0000-0000-0000-000000000001",
      docs: [doc("1", "queued")],
      supabaseUrl: "http://example.invalid",
      serviceKey: "test",
    })
    assert.equal(result.status, "skipped_not_settled")
  })
})
