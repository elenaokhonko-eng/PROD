import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import pg from 'pg'
import ts from 'typescript'

// Checks every literal table and column the app uses in Supabase query chains (.from('t').select/.order/filters)
// against the migrated database, so a query for a column that doesn't exist fails CI instead of returning 400 at
// runtime. Run after migrations: CI points it at the local Supabase database.
//
// Usage: pnpm exec tsx scripts/check-supabase-columns.ts
//   COLUMN_CHECK_DATABASE_URL  defaults to the local Supabase database
//   COLUMN_CHECK_DB_CA         optional PEM CA for a verify-full remote URL (read-only use)

const root = resolve(__dirname, '..')
const sourceDirs = ['app', 'hooks', 'lib', 'components']
const localDatabaseUrl = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'

// First argument is a column for these PostgREST builder methods.
const columnMethods = new Set([
  'eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'like', 'ilike', 'likeAllOf', 'likeAnyOf', 'ilikeAllOf', 'ilikeAnyOf',
  'is', 'in', 'contains', 'containedBy', 'rangeGt', 'rangeGte', 'rangeLt', 'rangeLte', 'rangeAdjacent', 'overlaps',
  'textSearch', 'order', 'not', 'filter',
])

export type ColumnUse = { file: string; line: number; table: string; column: string; via: string }

export function collectColumnUses(fileName: string, source: string): { uses: ColumnUse[]; skipped: number } {
  const sourceFile = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true)
  const uses: ColumnUse[] = []
  let skipped = 0

  const visit = (node: ts.Node) => {
    const table = fromTable(node)
    if (table) {
      // Walk up the fluent chain: from(...).select(...).eq(...).order(...)
      let call = node as ts.CallExpression
      while (ts.isPropertyAccessExpression(call.parent) && ts.isCallExpression(call.parent.parent)) {
        const method = call.parent.name.text
        call = call.parent.parent
        const first = call.arguments[0]
        const line = sourceFile.getLineAndCharacterOfPosition(call.getStart()).line + 1
        if (method === 'select' && first && ts.isStringLiteralLike(first)) {
          const { columns, nested } = selectColumns(first.text)
          skipped += nested
          for (const column of columns) uses.push({ file: fileName, line, table, column, via: 'select' })
        } else if (columnMethods.has(method) && first && ts.isStringLiteralLike(first)) {
          if (hasForeignTableOption(call)) {
            skipped += 1
            continue
          }
          const column = baseColumn(first.text)
          if (column) uses.push({ file: fileName, line, table, column, via: method })
        } else if (columnMethods.has(method) || method === 'select') {
          if (first) skipped += 1
        }
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  return { uses, skipped }
}

// A `.from('literal')` call on a Supabase client (not storage.from, Array.from or Buffer.from).
function fromTable(node: ts.Node): string | null {
  if (!ts.isCallExpression(node) || !ts.isPropertyAccessExpression(node.expression)) return null
  if (node.expression.name.text !== 'from') return null
  const target = node.expression.expression
  if (ts.isIdentifier(target) && ['Array', 'Buffer', 'Object', 'Uint8Array'].includes(target.text)) return null
  if (ts.isPropertyAccessExpression(target) && target.name.text === 'storage') return null
  const first = node.arguments[0]
  return first && ts.isStringLiteralLike(first) ? first.text : null
}

function hasForeignTableOption(call: ts.CallExpression) {
  return call.arguments.some(
    (argument) =>
      ts.isObjectLiteralExpression(argument) &&
      argument.properties.some((property) => property.name && ['foreignTable', 'referencedTable'].includes(property.name.getText())),
  )
}

// Top-level columns of a PostgREST select string. Embedded relations ("rel(cols)", "alias:rel!fk(cols)") are counted
// as skipped rather than resolved.
export function selectColumns(select: string): { columns: string[]; nested: number } {
  const items: string[] = []
  let depth = 0
  let current = ''
  for (const character of select) {
    if (character === '(') depth += 1
    if (character === ')') depth -= 1
    if (character === ',' && depth === 0) {
      items.push(current)
      current = ''
    } else {
      current += character
    }
  }
  items.push(current)

  const columns: string[] = []
  let nested = 0
  for (const raw of items.map((item) => item.trim()).filter(Boolean)) {
    if (raw.includes('(')) {
      nested += 1
      continue
    }
    const column = baseColumn(raw.includes(':') && !raw.includes('::') ? raw.slice(raw.indexOf(':') + 1) : raw)
    if (column && column !== '*' && column !== 'count') columns.push(column)
  }
  return { columns, nested }
}

// "alias:col::text" / "col->>key" / "col.not" → "col"
function baseColumn(value: string) {
  return value.trim().replace(/::.*$/, '').split(/->>?/)[0].trim()
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) return entry === 'node_modules' ? [] : sourceFiles(path)
    return /\.(ts|tsx)$/.test(entry) && !/\.d\.ts$/.test(entry) ? [path] : []
  })
}

async function main() {
  const uses: ColumnUse[] = []
  let skipped = 0
  for (const dir of sourceDirs) {
    for (const path of sourceFiles(join(root, dir))) {
      const result = collectColumnUses(relative(root, path).replaceAll('\\', '/'), readFileSync(path, 'utf8'))
      uses.push(...result.uses)
      skipped += result.skipped
    }
  }

  const ca = process.env.COLUMN_CHECK_DB_CA
  const client = new pg.Client({
    connectionString: process.env.COLUMN_CHECK_DATABASE_URL || localDatabaseUrl,
    ...(ca ? { ssl: { ca, rejectUnauthorized: true } } : {}),
  })
  await client.connect()
  let schema: Map<string, Set<string>>
  try {
    await client.query('begin read only')
    const { rows } = await client.query<{ table_name: string; column_name: string }>(
      // pg_attribute rather than information_schema, which omits materialized views.
      `select c.relname as table_name, a.attname as column_name
       from pg_attribute a
       join pg_class c on c.oid = a.attrelid
       join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm', 'f') and a.attnum > 0 and not a.attisdropped`,
    )
    await client.query('rollback')
    schema = new Map()
    for (const row of rows) {
      if (!schema.has(row.table_name)) schema.set(row.table_name, new Set())
      schema.get(row.table_name)!.add(row.column_name)
    }
  } finally {
    await client.end()
  }

  const problems = uses.flatMap((use) => {
    const columns = schema.get(use.table)
    if (!columns) return [`${use.file}:${use.line} table public.${use.table} does not exist (${use.via})`]
    if (!columns.has(use.column)) return [`${use.file}:${use.line} ${use.table}.${use.column} does not exist (${use.via})`]
    return []
  })
  const unique = Array.from(new Set(problems))
  console.log(`Checked ${uses.length} column references; ${skipped} dynamic or embedded references not checked.`)
  if (unique.length) {
    console.error(`${unique.length} reference(s) to missing tables or columns:\n${unique.join('\n')}`)
    process.exit(1)
  }
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(__filename)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  })
}
