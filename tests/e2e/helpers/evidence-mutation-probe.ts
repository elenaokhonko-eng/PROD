import { createClient } from '@supabase/supabase-js'

export type EvidenceMutationSnapshot = {
  evidenceRowIds: string[]
  storagePaths: string[]
}

export async function captureAndCleanupEvidenceMutation(
  caseId: string,
  originalFilename: string,
  category = 'evidence',
): Promise<EvidenceMutationSnapshot> {
  const supabaseUrl = requiredEnvironment('NEXT_PUBLIC_SUPABASE_URL')
  const serviceRoleKey = requiredEnvironment('SUPABASE_SERVICE_ROLE_KEY')
  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const { data: rows, error: rowError } = await supabase
    .from('evidence')
    .select('id, file_path')
    .eq('case_id', caseId)
    .eq('filename', originalFilename)
  if (rowError) throw new Error(`Unable to inspect evidence mutation: ${rowError.message}`)

  const folder = `${caseId}/${category}`
  const { data: objects, error: storageError } = await supabase.storage
    .from('evidence')
    .list(folder, { limit: 1_000 })
  if (storageError) throw new Error(`Unable to inspect evidence storage mutation: ${storageError.message}`)

  const evidenceRowIds = (rows ?? []).map((row) => String(row.id))
  const storagePaths = Array.from(new Set([
    ...(rows ?? []).flatMap((row) => typeof row.file_path === 'string' ? [row.file_path] : []),
    ...(objects ?? [])
      .filter((object) => object.name.endsWith(originalFilename))
      .map((object) => `${folder}/${object.name}`),
  ]))

  if (storagePaths.length) {
    const { error } = await supabase.storage.from('evidence').remove(storagePaths)
    if (error) throw new Error(`Unable to clean unexpected evidence object: ${error.message}`)
  }
  if (evidenceRowIds.length) {
    const { error } = await supabase.from('evidence').delete().in('id', evidenceRowIds)
    if (error) throw new Error(`Unable to clean unexpected evidence row: ${error.message}`)
  }

  return { evidenceRowIds, storagePaths }
}

function requiredEnvironment(name: string) {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`${name} is required for evidence mutation verification.`)
  return value
}
