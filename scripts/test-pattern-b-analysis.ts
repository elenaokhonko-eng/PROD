import assert from "node:assert/strict"
import test from "node:test"
import { inspectInvitationMutations, inspectProfileMutations } from "./check-state-machine-rules"

const inspect = (source: string) => inspectProfileMutations(source)

test("follows table constants, builder aliases, and generated identity aliases", () => {
  const result = inspect(`
    const baseTable = "profiles"
    const tableAlias = baseTable
    const firstBuilder = supabase.from(tableAlias)
    const builderAlias = firstBuilder
    const generated = crypto.randomUUID()
    const generatedAlias = generated
    builderAlias.upsert({ id: generatedAlias, clerk_id: user.id })
  `)
  assert.deepEqual(result, { found: true, generatedIdentity: true })
})

test("recognises generated-ID call variants in profile payloads", () => {
  for (const expression of ["randomUUID()", "uuidv4()", "v4()", "nanoid()"]) {
    assert.deepEqual(
      inspect(`const profile = db.from("profiles"); profile.insert({ id: ${expression} })`),
      { found: true, generatedIdentity: true },
      expression,
    )
  }
})

test("lexical shadowing does not contaminate unrelated table identifiers", () => {
  const result = inspect(`
    const table = "profiles"
    { const table = "cases"; db.from(table).insert({ id: existingId }) }
  `)
  assert.deepEqual(result, { found: false, generatedIdentity: false })
})

test("reassignment clears table, builder, and generated-ID taint", () => {
  const result = inspect(`
    let table = "profiles"
    table = "cases"
    let builder = db.from("profiles")
    builder = db.from(table)
    let id = crypto.randomUUID()
    id = existingId
    builder.upsert({ id })
  `)
  assert.deepEqual(result, { found: false, generatedIdentity: false })
})

test("analyses aliases declared and used inside arrow functions", () => {
  const result = inspect(`
    const sync = () => {
      const table = "profiles"
      const builder = db.from(table)
      const id = randomUUID()
      builder.insert({ id })
    }
  `)
  assert.deepEqual(result, { found: true, generatedIdentity: true })
})

test("respects arrow-parameter and for-of lexical shadowing", () => {
  const result = inspect(`
    const table = "profiles"
    const run = (table) => db.from(table).insert({ id: existingId })
    for (const table of tables) db.from(table).upsert({ id: existingId })
  `)
  assert.deepEqual(result, { found: false, generatedIdentity: false })
})

test("applies assignments nested in earlier call arguments", () => {
  const result = inspect(`
    let table = "profiles"
    consume(table = "cases")
    db.from(table).insert({ id: existingId })
  `)
  assert.deepEqual(result, { found: false, generatedIdentity: false })
})

test("resolves later immutable aliases captured by functions", () => {
  const result = inspect(`
    const sync = () => builder.insert({ id: generatedId })
    const table = "profiles"
    const builder = db.from(table)
    const generatedId = crypto.randomUUID()
  `)
  assert.deepEqual(result, { found: true, generatedIdentity: true })
})

test("respects classic-for initializer shadowing", () => {
  const result = inspect(`
    const table = "profiles"
    for (let table = "cases"; ready(table); table = next(table)) {
      db.from(table).insert({ id: existingId })
    }
  `)
  assert.deepEqual(result, { found: false, generatedIdentity: false })
})

test("detects direct and aliased invitation inserts", () => {
  assert.equal(inspectInvitationMutations(`db.from("invitations").insert({ case_id: caseId })`), true)
  assert.equal(
    inspectInvitationMutations(`
      const table = "invitations"
      const invitationWriter = db.from(table)
      const writerAlias = invitationWriter
      writerAlias.upsert({ case_id: caseId })
    `),
    true,
  )
})

test("allows invitation reads and the canonical RPC", () => {
  assert.equal(inspectInvitationMutations(`db.from("invitations").select("id")`), false)
  assert.equal(inspectInvitationMutations(`db.rpc("create_case_invitation", payload)`), false)
})
