import "./load-local-env.ts"

import { createServiceClient } from "../lib/supabase/service.ts"

const CASE_ID = "688154e7-9cda-47ef-9cff-a27581766c3a"
const BUCKETS = ["case_evidence", "evidence"] as const
const POLICE_PATTERN = /E[_\s/-]?20251016[_\s/-]?7004/i

async function listAllUnderPrefix(
  supabase: ReturnType<typeof createServiceClient>,
  bucket: string,
  prefix: string,
): Promise<Array<{ name: string; id?: string; metadata?: Record<string, unknown> }>> {
  const results: Array<{ name: string; id?: string; metadata?: Record<string, unknown> }> = []
  const stack = [prefix]

  while (stack.length > 0) {
    const current = stack.pop()!
    let offset = 0
    const limit = 100

    while (true) {
      const { data, error } = await supabase.storage.from(bucket).list(current, {
        limit,
        offset,
        sortBy: { column: "name", order: "asc" },
      })
      if (error) throw new Error(`list ${bucket}/${current}: ${error.message}`)
      if (!data?.length) break

      for (const item of data) {
        const path = current ? `${current}/${item.name}` : item.name
        if (item.id == null) {
          stack.push(path)
        } else {
          results.push({ name: path, id: item.id, metadata: item.metadata as Record<string, unknown> | undefined })
        }
      }

      if (data.length < limit) break
      offset += limit
    }
  }

  return results
}

async function main() {
  const supabase = createServiceClient()
  const prefix = `cases/${CASE_ID}/documents`

  console.log(`\nSearching storage for case ${CASE_ID}\n`)

  for (const bucket of BUCKETS) {
    console.log(`=== bucket: ${bucket} ===`)
    try {
      const objects = await listAllUnderPrefix(supabase, bucket, prefix)
      console.log(`objects under ${prefix}: ${objects.length}`)

      const policeObjects = objects.filter((obj) => POLICE_PATTERN.test(obj.name))
      if (policeObjects.length) {
        console.log("\nPolice report storage matches:")
        for (const obj of policeObjects) {
          console.log(`  ${obj.name}`)
        }
      }

      const likelyPolice = objects.filter((obj) =>
        /7004|police|e20\d{6}/i.test(obj.name.split("/").pop() ?? ""),
      )
      if (likelyPolice.length) {
        console.log("\nLikely police-related filenames:")
        for (const obj of likelyPolice) {
          console.log(`  ${obj.name}`)
        }
      }
    } catch (error) {
      console.log(`  (skipped: ${error instanceof Error ? error.message : String(error)})`)
    }
  }

  const { data: docs, error: docsError } = await supabase
    .from("case_documents")
    .select(
      "id, original_filename, filename, storage_bucket, storage_path, processing_status, is_processed, processing_error",
    )
    .eq("case_id", CASE_ID)

  if (docsError) throw docsError

  const indexedPaths = new Set(
    (docs ?? [])
      .filter((doc) => doc.storage_bucket && doc.storage_path)
      .map((doc) => `${doc.storage_bucket}:${doc.storage_path}`),
  )

  console.log("\n=== case_documents with police/7004 in name or path ===")
  for (const doc of docs ?? []) {
    const label = `${doc.original_filename ?? ""} ${doc.filename ?? ""} ${doc.storage_path ?? ""}`
    if (!POLICE_PATTERN.test(label) && !/7004/i.test(label)) continue
    console.log({
      id: doc.id,
      name: doc.original_filename ?? doc.filename,
      storage_bucket: doc.storage_bucket,
      storage_path: doc.storage_path,
      processing_status: doc.processing_status,
      is_processed: doc.is_processed,
      processing_error: doc.processing_error,
    })
  }

  console.log("\n=== storage objects missing case_documents row ===")
  for (const bucket of BUCKETS) {
    try {
      const objects = await listAllUnderPrefix(supabase, bucket, prefix)
      for (const obj of objects) {
        const key = `${bucket}:${obj.name}`
        if (indexedPaths.has(key)) continue
        if (!POLICE_PATTERN.test(obj.name) && !/7004/i.test(obj.name)) continue
        console.log({ bucket, storage_path: obj.name, status: "ORPHAN — no case_documents row" })
      }
    } catch {
      // already logged above
    }
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
