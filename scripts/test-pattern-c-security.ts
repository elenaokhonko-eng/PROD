import { spawnSync } from "node:child_process"
import { readFile } from "node:fs/promises"
import path from "node:path"
import pg from "pg"

import { runEdgeAuthorizationContractTests } from "./test-edge-authorization"

const root = process.cwd()
const supabaseBin = process.env.SUPABASE_BIN || "supabase"
const localDatabaseUrl = "postgresql://postgres:postgres@127.0.0.1:54322/postgres"
const legacyVersion = "20260827190000"

function runSupabase(args: string[]) {
  const result = spawnSync(supabaseBin, args, {
    cwd: root,
    env: process.env,
    stdio: "inherit",
    shell: process.platform === "win32" && /\.(?:cmd|bat)$/i.test(supabaseBin),
  })

  if (result.error) {
    throw result.error
  }
  if (result.status !== 0) {
    throw new Error(`Supabase CLI exited with status ${result.status}`)
  }
}

async function runSql(relativePath: string) {
  const sql = await readFile(path.join(root, relativePath), "utf8")
  const client = new pg.Client({ connectionString: localDatabaseUrl })

  await client.connect()
  try {
    await client.query(sql)
  } finally {
    await client.end()
  }
}

function extractNamedPreflight(source: string) {
  const startMarker = "DO $preflight$"
  const endMarker = "$preflight$;"
  const start = source.indexOf(startMarker)
  const end = source.indexOf(endMarker, start)

  if (start < 0 || end < 0) {
    throw new Error("Named migration preflight block not found")
  }

  return source.slice(start, end + endMarker.length)
}

async function runMigrationConflictFixtures() {
  const migration29 = await readFile(
    path.join(root, "supabase/migrations/20260829000000_release_security_and_fulfilment_hardening.sql"),
    "utf8",
  )
  const migration30 = await readFile(
    path.join(root, "supabase/migrations/20260830000000_privileged_edge_and_evidence_jobs.sql"),
    "utf8",
  )
  const preflight29 = extractNamedPreflight(migration29)
  const preflight30 = extractNamedPreflight(migration30)

  if (
    migration29.indexOf("DO $preflight$") >
      migration29.indexOf("CREATE UNIQUE INDEX IF NOT EXISTS case_purchases_one_pending_checkout_idx") ||
    migration30.indexOf("DO $preflight$") >
      migration30.indexOf("ADD CONSTRAINT jobs_job_type_check")
  ) {
    throw new Error("Migration preflight must precede release constraints and indexes")
  }

  const fixtures = [
    ["29-duplicate-pending-purchases.sql", preflight29, "23505", "duplicate pending or established Stripe purchases"],
    ["29-duplicate-established-purchases.sql", preflight29, "23505", "duplicate pending or established Stripe purchases"],
    ["29-duplicate-payment-intent.sql", preflight29, "23505", "duplicate case-purchase payment-intent identity"],
    ["29-duplicate-checkout-session.sql", preflight29, "23505", "duplicate Stripe Checkout identity"],
    ["29-duplicate-fulfilment-event.sql", preflight29, "23505", "duplicate Stripe fulfilment-event identity"],
    ["29-duplicate-legacy-payment-intent.sql", preflight29, "23505", "duplicate legacy-payment Stripe identity"],
    ["29-pending-without-legacy-payment.sql", preflight29, "23514", "lack a matching resumable legacy payment"],
    ["30-duplicate-evidence-jobs.sql", preflight30, "23505", "duplicate evidence document job keys"],
    ["30-unsupported-job-type.sql", preflight30, "23514", "unsupported job types"],
    ["30-evidence-job-missing-document.sql", preflight30, "23514", "evidence jobs lack document bindings"],
    ["30-report-job-unexpected-document.sql", preflight30, "23514", "report jobs have unexpected document bindings"],
    ["30-inconsistent-document-readiness.sql", preflight30, "23514", "inconsistent ready markers or missing extraction content"],
  ] as const

  const client = new pg.Client({ connectionString: localDatabaseUrl })
  await client.connect()
  try {
    for (const [fixtureName, preflight, expectedCode, expectedMessage] of fixtures) {
      const fixture = await readFile(
        path.join(root, "scripts/sql/tests/migration-conflicts", fixtureName),
        "utf8",
      )
      await client.query("BEGIN")
      let caught: unknown
      try {
        await client.query(fixture)
        await client.query(preflight)
      } catch (error) {
        caught = error
      } finally {
        await client.query("ROLLBACK")
      }

      const code =
        caught && typeof caught === "object" && "code" in caught
          ? String(caught.code)
          : ""
      const message = caught instanceof Error ? caught.message : ""
      if (code !== expectedCode || !message.includes(expectedMessage)) {
        throw new Error(
          `${fixtureName}: expected preflight ${expectedCode} containing ${JSON.stringify(expectedMessage)}, got ${code} ${message}`,
        )
      }
    }
  } finally {
    await client.end()
  }

  console.log(`Migration preflight conflict fixtures passed (${fixtures.length}/${fixtures.length})`)
}

async function runConcurrentCompletionReservationTest() {
  const ownerId = "10000000-0000-0000-0000-000000000001"
  const caseId = "91000000-0000-4000-8000-000000000001"
  const purchaseId = "92000000-0000-4000-8000-000000000001"
  const paymentId = "93000000-0000-4000-8000-000000000001"
  const clientA = new pg.Client({ connectionString: localDatabaseUrl })
  const clientB = new pg.Client({ connectionString: localDatabaseUrl })
  let transactionOpen = false

  await Promise.all([clientA.connect(), clientB.connect()])
  try {
    await clientA.query(
      `INSERT INTO public.cases (
         id, user_id, owner_user_id, creator_user_id, claim_type, status, case_summary
       ) VALUES ($1, $2, $2, $2, 'phishing_scam', 'draft', 'Concurrent checkout fence test')`,
      [caseId, ownerId],
    )
    await clientA.query(
      `INSERT INTO public.payments (
         id, user_id, case_id, amount, currency, service_type, payment_status
       ) VALUES ($1, $2, $3, 18, 'SGD', 'standard', 'pending')`,
      [paymentId, ownerId, caseId],
    )
    await clientA.query(
      `INSERT INTO public.case_purchases (
         id, case_id, user_id, purchased_by_profile_id, product_code,
         payment_provider, amount, currency, payment_status, metadata,
         created_by_profile_id, updated_by_profile_id
       ) VALUES (
         $1, $2, $3, $3, 'self_serve_report', 'stripe', 18, 'SGD', 'pending',
         jsonb_build_object('legacy_payment_id', $4::text, 'checkout_product_key', 'self_serve_report'),
         $3, $3
       )`,
      [purchaseId, caseId, ownerId, paymentId],
    )

    await clientA.query("BEGIN")
    transactionOpen = true
    await clientA.query(
      `SELECT * FROM public.mark_case_purchase_paid_v1(
         $1, $2, 'self_serve_report', 18, 'SGD',
         'cs_concurrent_fence', 'pi_concurrent_fence', 'evt_concurrent_fence', '{}'::jsonb
       )`,
      [purchaseId, caseId],
    )

    let reservationSettled = false
    const reservationPromise = clientB
      .query(
        `SELECT * FROM public.reserve_checkout_purchase_v1(
           $1, 'self_serve_report', $2
         )`,
        [caseId, ownerId],
      )
      .then((result) => {
        reservationSettled = true
        return result
      })

    await new Promise((resolve) => setTimeout(resolve, 100))
    if (reservationSettled) {
      throw new Error("Concurrent checkout reservation escaped the completion fence")
    }

    await clientA.query("COMMIT")
    transactionOpen = false
    const reservation = await reservationPromise
    if (
      reservation.rows.length !== 1 ||
      reservation.rows[0]?.case_purchase_id !== purchaseId ||
      reservation.rows[0]?.reservation_disposition !== "reconcile_established"
    ) {
      throw new Error(`Concurrent reservation did not reconcile the paid purchase: ${JSON.stringify(reservation.rows)}`)
    }

    const canonical = await clientA.query(
      `SELECT count(*)::integer AS purchase_count,
              max(payment_status) AS payment_status,
              bool_and((metadata->>'fulfilment_reconciliation_required')::boolean) AS reconciliation_required
       FROM public.case_purchases
       WHERE case_id = $1 AND product_code = 'self_serve_report'`,
      [caseId],
    )
    if (
      canonical.rows[0]?.purchase_count !== 1 ||
      canonical.rows[0]?.payment_status !== "paid" ||
      canonical.rows[0]?.reconciliation_required !== true
    ) {
      throw new Error(`Concurrent completion created an unsafe checkout state: ${JSON.stringify(canonical.rows[0])}`)
    }

    console.log("Concurrent completion/reservation fence test passed")
  } finally {
    if (transactionOpen) {
      await clientA.query("ROLLBACK").catch(() => undefined)
    }
    await Promise.all([clientA.end(), clientB.end()])
  }
}

async function main() {
  let testError: unknown

  try {
    await runEdgeAuthorizationContractTests()
    runSupabase(["db", "reset", "--local", "--no-seed", "--version", legacyVersion])
    await runSql("scripts/sql/tests/pattern-c-legacy-fixtures.sql")
    runSupabase(["migration", "up", "--local"])
    await runMigrationConflictFixtures()
    await runConcurrentCompletionReservationTest()
    await runSql("scripts/sql/tests/test-pattern-c-security.sql")
    console.log("Pattern C local migration and authorization tests passed")
  } catch (error) {
    testError = error
  } finally {
    try {
      runSupabase(["db", "reset", "--local", "--no-seed"])
    } catch (cleanupError) {
      if (!testError) {
        testError = cleanupError
      } else {
        console.error("Pattern C test cleanup failed", cleanupError)
      }
    }
  }

  if (testError) {
    throw testError
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
