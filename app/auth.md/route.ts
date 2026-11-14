// Addendum A §A5: how access works today, for AI agents. Text approved by Elena on 14 Nov 2026; replaced, with a new
// text for her approval, when an assistant can be connected to an account (Phase 3).
const AUTH_MD = `# GuideBuoy auth.md

This file tells AI agents how access to GuideBuoy works.

## What needs no credentials

All public pages, their markdown copies (the page address plus \`.md\`), \`/llms.txt\` and \`/sitemap.xml\` are open to crawlers and agents under \`/robots.txt\`.

## Accounts are for people

A GuideBuoy account belongs to one person: aged 18 or over, resident in Singapore, acting for themselves. The person creates it at https://guidebuoyai.sg/sign-up with an email code or Google sign-in.

GuideBuoy does not register agents and does not issue credentials to agents. Under the Terms of Service an agent must not create an account, sign in, submit a story, upload documents or confirm facts on a person's behalf.

## What an agent should do

Give the person this link and let them continue themselves: https://guidebuoyai.sg/#tell-your-story

Never ask the person for a bank login, PIN or one-time password. GuideBuoy never asks for these.

## Contact

info@guidebuoyai.sg
`

export function GET() {
  return new Response(AUTH_MD, { headers: { 'Content-Type': 'text/markdown; charset=utf-8' } })
}
