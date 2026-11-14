import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { SITE_ORIGIN } from '@/lib/seo/indexing'

// Brief W1 Addendum A §A6: one skill for AI assistants helping a scam or bank-dispute victim. The text was approved
// by Elena on 14 Nov 2026 and is served exactly as written in content/agents; change it only with her approval.
export const SKILL_NAME = 'guidebuoy-scam-help'
export const SKILL_PATH = `/.well-known/agent-skills/${SKILL_NAME}/SKILL.md`
export const SKILLS_INDEX_SCHEMA = 'https://schemas.agentskills.io/discovery/0.2.0/schema.json'

export function skillMarkdown(): string {
  return readFileSync(join(process.cwd(), 'content/agents', SKILL_NAME, 'SKILL.md'), 'utf8').replace(/\r\n/g, '\n')
}

export function skillDescription(markdown = skillMarkdown()): string {
  const match = /^---\n[\s\S]*?^description: (.+)$[\s\S]*?^---\n/m.exec(markdown)
  if (!match) throw new Error('SKILL.md has no description in its front matter')
  return match[1].trim()
}

export function skillsIndex() {
  const markdown = skillMarkdown()
  return {
    $schema: SKILLS_INDEX_SCHEMA,
    skills: [
      {
        name: SKILL_NAME,
        type: 'skill-md',
        description: skillDescription(markdown),
        url: `${SITE_ORIGIN}${SKILL_PATH}`,
        digest: `sha256:${createHash('sha256').update(markdown, 'utf8').digest('hex')}`,
      },
    ],
  }
}
