---
name: cloudflare-release
description: Release a change to the public guidebuoyai.sg site through Render and Cloudflare, and verify it. Use when deploying web changes, crawl files (robots.txt, sitemap.xml, llms.txt, markdown copies, .well-known files) or anything a crawler or AI assistant reads, or when production seems to serve an old file after a deploy.
---

# Releasing the public site behind Cloudflare

Full runbook: `docs/runbooks/web-release-and-cloudflare.md`. Read it before a release.

## Rules

1. **Cloudflare caches `.txt`, `.xml` and other static extensions for 4 hours by default** unless the origin sends
   `Cache-Control`. Every crawl or discovery file the app serves must set `Cache-Control: public, max-age=3600`
   itself. Add a test for the header when you add such a file.
2. **Staging first, production only if staging passes.** Deploy the merge commit by `commitId`; never deploy an
   unmerged branch to production.
3. **Wait one minute after Render reports `live`** before checking: the old instance answers briefly.
4. **A stale file in production with a fresh one behind `?v=1`** (`cf-cache-status: MISS`) is Cloudflare's cache.
   Ask Elena to purge that URL. Do not redeploy to "fix" it.
5. **Cloudflare settings are Elena's.** Do not change them; tell her exactly which setting and why.
6. **Publish a discovery file only for something that exists** (brief W1 Addendum A). The agent-readiness scan
   (`POST https://isitagentready.com/api/scan`) is for reporting, not a target.
7. Never print secrets. Render calls use the token from the release scripts; report status codes only.

## Checks after each release

- Crawl files: status 200, content type, expected body.
- Public pages: `index, follow`, own canonical, `Link: </llms.txt>; rel="describedby"`.
- Sign-in and sign-up: `noindex, nofollow`, no canonical.
- `cf-cache-status` and `Age` on cached files: an `Age` older than the release means a stale copy.
