import {
  createServiceClientFromEnvironment,
  requireUuid,
  requireUuidScopedEvidencePath,
  requireUuidScopedFilename,
} from './disposable-records'

export type EvidenceMutationSnapshot = {
  evidenceRowIds: string[]
  storagePaths: string[]
}

export async function captureAndCleanupEvidenceMutation(
  caseId: string,
  originalFilename: string,
): Promise<EvidenceMutationSnapshot> {
  requireUuid(caseId, 'evidence mutation case id')
  requireUuidScopedFilename(originalFilename, 'evidence upload filename')
  const supabase = createServiceClientFromEnvironment()

  const { data: rows, error: rowError } = await supabase
    .from('evidence')
    .select('id, file_path')
    .eq('case_id', caseId)
    .eq('filename', originalFilename)
  if (rowError) throw new Error(`Unable to inspect evidence mutation: ${rowError.message}`)

  const evidenceRowIds = (rows ?? []).map((row) => requireUuid(String(row.id), 'evidence row id'))
  const storagePaths = Array.from(new Set(
    (rows ?? []).flatMap((row) =>
      typeof row.file_path === 'string'
        ? [requireUuidScopedEvidencePath(row.file_path, caseId)]
        : [],
    ),
  ))

  if (storagePaths.length) {
    const { error } = await supabase.storage.from('evidence').remove(storagePaths)
    if (error) throw new Error(`Unable to clean exact evidence object: ${error.message}`)
  }
  if (evidenceRowIds.length) {
    const { error } = await supabase.from('evidence').delete().in('id', evidenceRowIds)
    if (error) throw new Error(`Unable to clean exact evidence row: ${error.message}`)
  }

  return { evidenceRowIds, storagePaths }
}
