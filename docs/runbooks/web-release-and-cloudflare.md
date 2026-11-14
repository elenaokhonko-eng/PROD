# Web releases behind Cloudflare

How a change to the public site reaches visitors, crawlers and AI assistants on `guidebuoyai.sg`, and how to check
it. Written after the releases of 14 November 2026 (PR #8 crawl files, PR #9 content signals).

## The path a request takes

Visitor or crawler → Cloudflare (DNS proxy, cache, bot rules) → Render (production web service) → Next.js.

A deploy changes Render only. Anything Cloudflare has cached keeps being served until it expires or is purged.

## What Cloudflare caches

Cloudflare caches responses by file extension unless the origin says otherwise. `.txt`, `.xml`, `.ico`, `.png` and
`.webmanifest` are cached by default; HTML pages are not.

**Lesson, 14 Nov:** `robots.txt`, `sitemap.xml` and `llms.txt` were sent without a `Cache-Control` header, so
Cloudflare applied its 4-hour default (`Cache-Control: max-age=14400`, `cf-cache-status: HIT`). After PR #9 went
live, production kept serving the previous robots.txt (no content signals) for hours, although Render served the new
one.

**Rule:** every crawl and discovery file the app serves (robots.txt, sitemap.xml, llms.txt, llms-full.txt, the
markdown copies, auth.md, `.well-known` files) sets `Cache-Control: public, max-age=3600` itself, so a change
reaches crawlers within the hour. Icons may keep long caches; give them a new file name if they change.

## Release steps

1. Merge the PR (Elena).
2. Deploy the merge commit to staging web (`srv-dabtf78jo6nc738snvh0`), Render `POST /services/{id}/deploys` with
   `commitId`.
3. Wait for `live`, then **wait one more minute**: for a short time after `live`, the old instance still answers.
   (On 14 Nov a check run straight after `live` failed and passed a minute later.)
4. Check staging (below). Deploy to production web (`srv-dbq8ogt6e07s73fe6qq0`) only if staging passes.
5. Wait for `live`, plus one minute, then check production.
6. If production shows an old crawl file but the cache bypass shows the new one (`?v=1` gives
   `cf-cache-status: MISS`), it is Cloudflare's cache, not the deploy. Elena purges the URL: Cloudflare → Caching →
   Configuration → Purge Cache → Custom Purge.
7. Run the agent-readiness scan for reporting only:
   `POST https://isitagentready.com/api/scan` with `{"url": "https://guidebuoyai.sg"}`. The score is not a target
   (Addendum A).

## What to check after a web release

- `/robots.txt`, `/sitemap.xml`, `/llms.txt`: HTTP 200, `text/plain` or XML, and the expected content.
- `/robots.txt`: both groups carry the same `Content-Signal` and `Disallow` lines; the sitemap line is last.
- Public pages: `<meta name="robots" content="index, follow">`, a canonical to their own address, and
  `Link: </llms.txt>; rel="describedby"`. Sign-in and sign-up: `noindex, nofollow`, no canonical, no Link header.
- Headers on cached files: `cf-cache-status` and `Age`. An `Age` older than the release means a stale copy.

## Settings that stay in Cloudflare (Elena)

- Managed robots.txt: off. The app serves robots.txt.
- Block AI bots: off. AI Crawl Control: every crawler set to Allow (decision D1).
- SSL mode Full (strict), Always Use HTTPS, the rate-limit rule.
