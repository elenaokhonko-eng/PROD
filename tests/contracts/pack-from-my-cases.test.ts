import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { CONTINUE_TO_STORY_KEY, myCasesPackHref, storylessCaseDestination } from '../../lib/journey/pack-case'

// Requirements 10.1 (28 Nov): from "My cases" reached by a pack button, an existing case and "Add a new case" both lead
// to that pack's payment step first, then to that pack's path.
const read = (file: string) => readFileSync(file, 'utf8')

test('from My cases with a pack, both choices lead to that pack’s payment step', () => {
  assert.equal(myCasesPackHref('fidrec', 'abc'), '/app/pack/fidrec?case=abc')
  assert.equal(myCasesPackHref('bank', 'new'), '/app/pack/bank?case=new')
  const page = read('app/(case)/app/page.tsx')
  assert.match(page, /wanted \? myCasesPackHref\(wanted, caseItem\.id\)/)
  assert.match(page, /const addCaseHref = wanted \? myCasesPackHref\(wanted, 'new'\) : '\/app\/case\/new'/)
  assert.equal(page.match(/href=\{addCaseHref\}/g)?.length, 2)
})

test('the payment step takes the chosen case, never charges twice, and never starts a free evaluation instead', () => {
  const page = read('app/(case)/app/pack/[pack]/page.tsx')
  assert.match(page, /already_purchased'\) redirect\(`\/app\/case\/\$\{chosen\.id\}\/dashboard`\)/)
  assert.match(page, /\.eq\('user_id', user\.supabaseUuid\)/)
  assert.match(page, /if \(!chosenCase\) \{[\s\S]*packDestinationForCases/, 'the one-case and several-case rules apply only to a pack button')
  const client = read('app/(case)/app/pack/[pack]/_components/pack-first-client.tsx')
  assert.match(client, /CONTINUE_TO_STORY_KEY/)
  assert.ok(client.indexOf('await rememberWhereNext(') < client.indexOf("await buy('self_serve_report'"), 'recorded before Stripe opens')
})

test('after paying on a case without a story, a person who came from My cases goes on to the story', () => {
  const paid = { checkout: 'success', product: 'fidrec_tier2_pack' }
  assert.equal(storylessCaseDestination(paid, true), '/app/case/new?checkout=success&product=fidrec_tier2_pack')
  assert.equal(storylessCaseDestination(paid, false), '/app?checkout=success&product=fidrec_tier2_pack', 'pack first from the public pages: My cases, as before')
  assert.equal(storylessCaseDestination({ checkout: 'cancel', product: 'fidrec_tier2_pack' }, true), '/app?checkout=cancel&product=fidrec_tier2_pack')
  assert.equal(CONTINUE_TO_STORY_KEY, 'continue_to_story')
  assert.match(read('app/(case)/app/case/new/page.tsx'), /CONFIRMING_PAYMENT/)
})
