import assert from "node:assert/strict"
import { existsSync, readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, it } from "node:test"

const ROOT = process.cwd()
const FIXTURE_DIR = join(ROOT, "scripts/sql/tests/migration-conflicts")

const expectedFixtures = [
  {
    file: "29-duplicate-checkout-session.sql",
    markers: ["case_purchases", "provider_checkout_session_id", "cs_conflict"],
  },
  {
    file: "29-duplicate-established-purchases.sql",
    markers: ["case_purchases", "paid", "self_serve_report"],
  },
  {
    file: "29-duplicate-fulfilment-event.sql",
    markers: ["fulfilment_provider_event_id", "evt_conflict", "case_purchases"],
  },
  {
    file: "29-duplicate-legacy-payment-intent.sql",
    markers: ["payments", "stripe_payment_intent_id", "pi_legacy_conflict"],
  },
  {
    file: "29-duplicate-payment-intent.sql",
    markers: ["case_purchases", "provider_payment_intent_id", "pi_conflict"],
  },
  {
    file: "29-duplicate-pending-purchases.sql",
    markers: ["case_purchases", "pending", "self_serve_report"],
  },
  {
    file: "29-pending-without-legacy-payment.sql",
    markers: ["case_purchases", "pending", "metadata"],
  },
  {
    file: "30-duplicate-evidence-jobs.sql",
    markers: ["jobs", "evidence_document_processing", "payload"],
  },
  {
    file: "30-evidence-job-missing-document.sql",
    markers: ["jobs", "evidence_document_processing", "queued"],
  },
  {
    file: "30-inconsistent-document-readiness.sql",
    markers: ["case_documents", "processing_status", "is_processed"],
  },
  {
    file: "30-report-job-unexpected-document.sql",
    markers: ["jobs_worker_document_binding_check", "case_documents", "post_payment_report_generation"],
  },
  {
    file: "30-unsupported-job-type.sql",
    markers: ["jobs_job_type_check", "stale_provider_job", "jobs"],
  },
  {
    file: "31-duplicate-clerk-identities.sql",
    markers: ["profiles_clerk_id_unique_idx", "clerk_id", "user_duplicatefixture"],
  },
  {
    file: "31-whitespace-clerk-identity.sql",
    markers: ["profiles_clerk_id_shape_check", "clerk_id", "user_whitespacefixture"],
  },
] as const

describe("migration conflict fixtures", () => {
  it("pins the deterministic 14-fixture conflict corpus", () => {
    assert.ok(existsSync(FIXTURE_DIR), `Missing fixture directory ${FIXTURE_DIR}`)
    const actual = readdirSync(FIXTURE_DIR)
      .filter((entry) => entry.endsWith(".sql"))
      .sort()
    assert.deepEqual(
      actual,
      expectedFixtures.map((item) => item.file).sort(),
    )
  })

  it("covers both migration phases in sorted preflight order", () => {
    const phase29 = expectedFixtures.filter((item) => item.file.startsWith("29-"))
    const phase30 = expectedFixtures.filter((item) => item.file.startsWith("30-"))
    const phase31 = expectedFixtures.filter((item) => item.file.startsWith("31-"))

    assert.equal(phase29.length, 7)
    assert.equal(phase30.length, 5)
    assert.equal(phase31.length, 2)
    assert.ok(phase29.every((item) => item.file < "30-"), "Phase 29 fixtures must sort before phase 30 fixtures")
    assert.ok(phase30.every((item) => item.file < "31-"), "Phase 30 fixtures must sort before phase 31 fixtures")
  })

  it("contains deterministic SQL conflict seeds without randomization", () => {
    for (const fixture of expectedFixtures) {
      const source = readFileSync(join(FIXTURE_DIR, fixture.file), "utf8")
      assert.ok(source.trim().length > 0, `${fixture.file} must not be empty`)
      assert.doesNotMatch(source, /gen_random_uuid\(|random\(|pg_sleep\(/i, `${fixture.file} must be deterministic`)
      for (const marker of fixture.markers) {
        assert.ok(source.includes(marker), `${fixture.file} is missing marker ${marker}`)
      }
    }
  })
})
