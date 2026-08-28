import { spawnSync } from "node:child_process"
import { readFile } from "node:fs/promises"
import path from "node:path"
import pg from "pg"

const root = process.cwd()
const supabaseBin = process.env.SUPABASE_BIN || "supabase"
const localDatabaseUrl = "postgresql://postgres:postgres@127.0.0.1:54322/postgres"
const legacyVersion = "20260827190000"

function runSupabase(args: string[]) {
  const result = spawnSync(supabaseBin, args, {
    cwd: root,
    env: process.env,
    stdio: "inherit",
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

async function main() {
  let testError: unknown

  try {
    runSupabase(["db", "reset", "--local", "--no-seed", "--version", legacyVersion])
    await runSql("scripts/sql/tests/pattern-c-legacy-fixtures.sql")
    runSupabase(["migration", "up", "--local"])
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
