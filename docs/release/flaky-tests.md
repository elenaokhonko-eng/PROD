# Flaky test notes

A test that fails once and passes on a rerun is recorded here with its evidence. A rerun is never the fix, and no
test is weakened to make it pass.

## 2026-11-05: public UI, "resources page enforces unavailable + retry behavior when API is down" (chromium-768)

- **Run:** Harbor release gates 42011991737, attempt 1, commit `256b876`. It passed on the rerun (attempt 2) at
  every viewport in about 2 s, and on the three previous runs (1-7 s).
- **What failed:** `expect(heading 'Official resources are not currently available').toBeVisible()` timed out after
  30 s. The page was still showing the loading state.
- **Immediate cause, from the retained trace:** for about 90 s the local `next start` server on the Windows runner
  was slow to answer every request, static files included. Every JavaScript chunk the page needed took 13-37 s
  (`app/error-*.js` 37 s, `app/layout-*.js` 21 s), so the navigation took 20.5 s and the client code that renders
  the error state had not loaded when the 30 s wait ran out. The test logic is correct; the mocked 503 was
  fulfilled.
- **Coincident:** on the other worker, "/onboarding renders a non-crashing setup shell when unauthenticated" took
  1.5 min instead of its usual 0.4-3.8 s, during the same window. Everything was fast again from 10:41:46.
- **Underlying cause: not yet found.** A slowdown that also delays static files points to the server process
  itself being blocked or starved (CPU, disk or event loop) rather than to one slow request. The open lead is
  whatever the onboarding request does server-side under CI's placeholder Clerk keys.
- **Next step if it recurs:** read the trace for the coincident onboarding test and the web server log for that
  window. Until then this test stays as it is.

## 2026-11-05: database, fact-reconciliation.test.sql test 4 (my test, fixed)

- **Run:** Harbor release gates 42018054197, commit `f05243c`; it had passed on the three runs before.
- **Cause:** the test ordered two answer revisions by `created_at, id`. Inside one test transaction `now()` is
  constant, so both rows had the same `created_at` and the order fell to random UUIDs. In the product each answer
  is saved in its own request, so revision times differ.
- **Fix:** the assertion compares the two revisions as a set (exactly "No" and "Yes", so saving the same value
  added nothing). Same check, no dependence on row order. Passed 5 of 5 runs locally after the fix.

## 2026-11-05: signed-in, "layer1Evidence fixture renders its contract state" (chromium-768), under watch

- **Run:** Harbor release gates 42023839032, commit `c23acf0`; first occurrence.
- **What failed:** the page check found 15 browser errors, all "Failed to fetch", on the seeded evidence-step case.
  The state itself rendered. The other viewports passed in the same run.
- **Cause: not yet known.** The signed-in lane's artifacts are encrypted, so no trace was read. Watching the
  next runs; if it recurs, decrypt the trace and find which request failed.

## 2026-11-05: signed-in, "layer2Ready fixture renders its contract state" (chromium-768), under watch

- **Run:** Harbor release gates 42034171587, commit `2e7c7c5`; first occurrence.
- **What failed:** `page.goto(..., { waitUntil: 'networkidle' })` timed out after 30 s on the seeded report-ready
  case. The other viewports passed in the same run.
- **Pattern to watch:** this is the second different state-fixture test to fail at 768 px in two runs (see
  layer1Evidence above). If either recurs, decrypt the signed-in trace before doing anything else; do not rerun
  as a fix.

## 2026-11-05: the two 768-px state-fixture failures above, root cause found and fixed

- **Root cause:** the state tests opened the dashboard with `waitUntil: 'networkidle'`. Since D7 the dashboard
  polls its case queries every 5 to 10 seconds, so "no requests for 500 ms" happens only by chance between polls.
  Which viewport lost the race varied with timing; CI runs one worker, so it was not browser concurrency. The
  "Failed to fetch" errors fit the same cause: a poll still in flight when the test moved on and closed the page.
  Locally the tests passed 65 of 65 at 768 px, where responses are faster.
- **Fix (D12):** the dashboard sets `data-harbor-ready="true"` on `<main>` once the queries that decide its state
  have settled, and the tests wait for that signal instead of network idle. No timeout was lengthened and nothing
  retries. Both tests have passed at every viewport in the four runs since (42053205624 to 42065053458).

## 2026-11-06: signed-in, fresh free path "confirm facts" step (chromium-1440), my test, fixed

- **Run:** 42065053458, commit `6977ff8`; it passed end to end on the run before (42059997693).
- **Cause:** the uploaded statement finished being read while the test was answering the confirm screen. By design
  (Q2) that re-runs the fact check, and the cards are replaced by "Checking your story…" until it ends; the test
  waited 30 s for a radio that was not on the page.
- **Fix:** before each answer and before confirming, the test waits until no document is still being read and
  the panel shows its "left to check" or "Everything is confirmed" summary, which is what a person waits for. The
  6-minute limit is from the slowest fact check measured on staging (310 s), not a guess.

## 2026-11-06: signed-in, "file exceeds the configured storage limit is rejected before persistence", under watch

- **Run:** 42065053458, commit `6977ff8`; first failure; it passed on every earlier run tonight.
- **What failed:** the 50 MB upload (52,429,269 bytes) did not get a response within the 30 s request timeout.
- **Likely cause, not yet proven:** the body is just under the route's multipart cap (51 MiB), so the server reads
  the whole upload before rejecting the file by size; the time is the upload from the GitHub runner to Render. The
  route and the test are unchanged tonight. Not retried and no timeout changed. If it recurs, the fix to consider
  is rejecting a declared file size above 50 MB before reading the body, not a longer timeout.

## 2026-11-07: signed-in, "layer1FreeDraft fixture renders its contract state" (chromium-768), under watch

- **Run:** 42370131271, commit `c1984ae`; first failure; it passed at 390 and 1440 in the same run and on every
  earlier run. The re-run of the failed job passed.
- **What failed:** the clean-console check. Next.js prefetched `/app` and `/app/settings`; the middleware answered
  with a redirect to the Clerk sign-in page, which the browser blocked (CORS). The page itself rendered correctly,
  and in real use Next falls back to a full navigation.
- **Likely cause, not yet proven:** the test's short-lived Clerk session cookie lapsed between refreshes just as the
  prefetch fired (compare D5/H1 in authenticated-lane-triage-2026-11-03.md). The signed-in screens are unchanged
  since the last two green runs. Nothing retried or relaxed. If it recurs, the fix to consider is turning off
  prefetch for signed-in links (`prefetch={false}`), not ignoring the console error.

## 2026-11-07: public, "resources page renders loading and ready/filter states when API responds" (chromium-1440)

- **Run:** 42370131271, commit `c1984ae`; failed on the first attempt and passed on the re-run, as before (teardown
  timeout). Still under watch.

## 2026-11-07: public, resources "loading and ready/filter states" and "/ renders without … client errors" (chromium-1440), cause found

- **Run:** 42382284016, commit `daa7d7e`; both in the chromium-1440 project; the public lane took 8.3 min (usual 3–5).
- **Evidence (trace):** the CI-local production server (`127.0.0.1:3000`) took 24–39 s per JavaScript chunk and 13 of 20
  chunks never completed, so the page never hydrated and never requested `/api/resources`; it stayed on the
  server-rendered "Loading official resources…". No console or page errors. The home-page failure in the same
  project was a context teardown timeout from the same stall.
- **Conclusion:** runner/server slowness, not application behaviour; the same test failed on earlier runs only on
  this project. Failed jobs re-run; no timeout raised and no assertion relaxed. If it recurs, the fix to consider is
  fewer parallel workers for the public lane against the single local server, not longer timeouts.
