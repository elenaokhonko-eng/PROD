# Confirmations

A person's record that they checked part of the standards corpus. The loader and the seed step only write drafts;
`scripts/standards/confirm.ts` turns these records into verified versions, dependant reviews and approved statements.

One file per person per sitting: `<date>-<name>.json`.

```json
{
  "by": "Name of the person who checked",
  "at": "2026-11-25T17:48:00+08:00",
  "versions": [
    { "manifest": "<file in ../manifests>", "content_sha256": "<the manifest's>", "clauses_sha256": "<see below>", "note": "optional" }
  ],
  "statement_reviews": [
    { "manifest": "<file>", "statement_key": "<key>", "revision": 1, "text_sha256": "<sha256 of the statement text>", "outcome": "unchanged" }
  ],
  "rule_reviews": [
    { "manifest": "<file>", "rule_id": "<id in standard_rule_citations>", "outcome": "unchanged" }
  ],
  "statements": [
    { "statement_key": "<key>", "revision": 1, "text_sha256": "<sha256 of the statement text>", "clauses_as_of": "2026-11-25" }
  ]
}
```

- `versions`: the stored text of every clause matches the source, and the dates are right.
- `statement_reviews`, `rule_reviews`: the statement or server rule was read against that version's wording of the
  clauses it rests on. `outcome` is `unchanged`, `reworded` or `retired`. The database will not verify a version until
  every statement (drafts included) and rule resting on a clause it changes has one.
- `statements`: the statement is approved as written. Every clause it rests on must be in a verified version in force
  on `clauses_as_of`.

A record names content by hash. `clauses_sha256` is the sha256 of the manifest's `clause_key:text_sha256` lines,
sorted and joined by a newline (`clausesSha256` in `scripts/standards/confirmations.ts`). If a manifest or a
statement's wording changes afterwards, the record no longer covers it: it is reported as stale and skipped, and
`tests/contracts/standards-confirmations.test.ts` fails until the record is renewed or removed in the same change.

Only the person named in `by` decides what goes in a record. An agent may write the file from that person's stated
result (for example the confirmation workbook); it never adds a line the person did not give.

```
npx tsx scripts/standards/confirm.ts                      # what is ready and what each item is waiting on
npx tsx scripts/standards/confirm.ts --psql "<command>"   # apply to a database on this machine; any other host is refused
npx tsx scripts/standards/confirm.ts --sql-out <file>     # write the SQL; a hosted database only with Elena's OK
npx tsx scripts/standards/confirm.ts --require-ready      # also fail while any recorded item is still waiting
```

The command fails, and writes or applies nothing, while any record is malformed, contradicts another or is stale.
`scripts/standards/seed.ts --psql` applies the records after seeding, so a reloaded database gets its confirmations
back (load every confirmed version first; `--no-confirm` leaves the step out).

Not covered yet:
- Card scheme statements (`seeds/statements/schemes`). The seed step does not load them, because each needs a check
  per edition; a result recorded for one is reported as an error.
- A reworded statement. "Change" needs a new revision in the seed file first; the old revision's review is then
  recorded as `reworded` and the new revision is approved on its own.
- Reviews of bank term requests. A version with a term request resting on it is refused by the database until that
  review exists.
