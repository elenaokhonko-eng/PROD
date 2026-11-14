import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { documentEffectiveDate, LEGAL_FILES } from '../../lib/legal/legal-document'

// Privacy v2.1 and Terms v2.1 were released together on 14 Nov 2026 with no notice period, because no real users had
// accounts. Terms v2.2 (Elena, 14 Nov) adds Annex T 5.4 to 5.8 and the cross-references in 1.2, 3.1 and 4.3. The
// Privacy Policy's AI-training sentence and its connected-assistant wording wait for legal review.

const read = (path: string) => readFileSync(path, 'utf8').replace(/\r\n/g, '\n')
const section = (source: string, n: number) => source.slice(source.indexOf(`## ${n}.`), source.indexOf(`## ${n + 1}.`))

test('Terms clause 5 is Annex T 5.1 to 5.8, in order', () => {
  const clause5 = section(read(LEGAL_FILES.terms), 5)
  assert.match(clause5, /^## 5\. Acceptable use, automated access and AI assistants\n/)
  assert.deepEqual(
    [...clause5.matchAll(/^(5\.\d) \*\*([^*]+)\*\*/gm)].map((m) => `${m[1]} ${m[2]}`),
    [
      '5.1 What you agree not to do.',
      '5.2 Public pages.',
      '5.3 Public tools.',
      '5.4 Accounts are for people.',
      '5.5 Connecting an AI assistant to your account.',
      '5.6 You remain responsible.',
      '5.7 Only you can confirm and generate.',
      '5.8 What we may do.',
    ],
  )
  assert.match(clause5, /may use that content as our robots\.txt file permits\./)
  assert.match(clause5, /An AI assistant or other automated tool must not give this confirmation or start generation/)
})

test('Terms 1.2, 3.1 and 4.3 point to clause 5', () => {
  const terms = read(LEGAL_FILES.terms)
  assert.match(terms, /^1\.2 .*Using an AI assistant you have connected under clause 5\.5 counts as acting for yourself\./m)
  assert.match(terms, /^3\.1 .*don't give them to an AI assistant; to let an assistant help, connect it under clause 5\.5\./m)
  assert.match(terms, /^4\.3 .*the facts you confirm \(clause 5\.7\)\./m)
})

test('each legal document can take effect on its own day', () => {
  const env = { LEGAL_EFFECTIVE_DATE: '2026-11-14', LEGAL_EFFECTIVE_DATE_TERMS: '2026-11-16' }
  assert.equal(documentEffectiveDate('terms', env), '16 November 2026')
  assert.equal(documentEffectiveDate('privacy', env), '14 November 2026')
  assert.equal(documentEffectiveDate('terms', { LEGAL_EFFECTIVE_DATE: '2026-11-14' }), '14 November 2026')
})

test('Privacy v2.1 covers voice recordings, public tools, statistics, Cloudflare and the 14-day notice', () => {
  const privacy = read(LEGAL_FILES.privacy)
  assert.match(section(privacy, 1), /\| Voice recordings \|/)
  assert.match(section(privacy, 1), /\| Public tools \|.*do not store them/)
  assert.match(section(privacy, 2), /to produce statistics and research about disputes that do not identify you or anyone else/)
  assert.match(section(privacy, 3), /Google \(Gemini\) also turns a voice recording of your story into text/)
  assert.match(section(privacy, 6), /\| Voice recordings \| Not stored/)
  assert.match(section(privacy, 8), /Cloudflare also gives us visit statistics for the site, without advertising cookies\./)
  assert.match(section(privacy, 10), /at least 14 days before they take effect\./)
})

test('Privacy v2.1 keeps the v2.0 promises that wait for legal review', () => {
  const privacy = read(LEGAL_FILES.privacy)
  assert.match(privacy, /We do not use your case data to train artificial-intelligence models/, 'D-OPEN-1')
  assert.match(privacy, /\*\*We never share your case with any bank, FIDReC, the police or any other body\.\*\*/)
  assert.match(privacy, /We share personal data only with providers that process it for us under contract/)
  assert.doesNotMatch(privacy, /AI assistant you connect|connected assistant/i, 'connected assistants are not live')
})
