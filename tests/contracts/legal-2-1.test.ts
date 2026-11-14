import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { LEGAL_FILES } from '../../lib/legal/legal-document'

// Terms and Privacy v2.1 (Elena, 14 Nov 2026), released together with no notice period because no real users had
// accounts. Only what exists today or Elena decided is in them; connected assistants, the owner's confirmation record
// and AI training wait for legal review.

const read = (path: string) => readFileSync(path, 'utf8').replace(/\r\n/g, '\n')
const section = (source: string, n: number) => source.slice(source.indexOf(`## ${n}.`), source.indexOf(`## ${n + 1}.`))

test('Terms clause 5 is Annex T 5.1 to 5.3 and nothing from 5.4 on', () => {
  const clause5 = section(read(LEGAL_FILES.terms), 5)
  assert.match(clause5, /^## 5\. Acceptable use, automated access and AI assistants\n/)
  assert.deepEqual(
    [...clause5.matchAll(/^(5\.\d) \*\*([^*]+)\*\*/gm)].map((m) => `${m[1]} ${m[2]}`),
    ['5.1 What you agree not to do.', '5.2 Public pages.', '5.3 Public tools.'],
  )
  assert.match(clause5, /may use that content as our robots\.txt file permits\./)
  assert.doesNotMatch(clause5, /connect|confirm|generat/i, 'assistant connection and the generation rule wait for legal review')
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
