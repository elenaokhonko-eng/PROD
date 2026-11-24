// A table the export reads that can be missing for a while: the app can deploy before the migration that creates it
// is applied (case_ip_locations, migration 20261204120200). A missing table means there are no such records yet, so the
// export carries an empty list and goes on. Any other error still fails the export.

export interface QueryResult<T> {
  data: T[] | null
  error: unknown
}

/** Postgres "undefined_table" (42P01), PostgREST's "table not in the schema cache" (PGRST205), or their messages. */
export function isMissingTableError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false
  const e = error as { code?: unknown; message?: unknown }
  if (e.code === "42P01" || e.code === "PGRST205") return true
  const message = typeof e.message === "string" ? e.message : ""
  return /relation "?[\w.]+"? does not exist/i.test(message) || /could not find the table/i.test(message)
}

/** The rows, or an empty list when the table does not exist yet; other errors are passed through unchanged. */
export function rowsOrEmptyWhenTableMissing<T>(result: QueryResult<T>): QueryResult<T> {
  return result.error && isMissingTableError(result.error) ? { data: [], error: null } : result
}
