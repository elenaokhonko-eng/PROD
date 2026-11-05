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
