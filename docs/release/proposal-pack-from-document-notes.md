# Proposal for the update branch: write the packs from per-document notes

28 Nov 2026. For Elena and the reviewer. Not built, not part of #121.

## Problem

The FIDReC pack is written by one AI request that carries the text of every document, up to 400,000 characters. The pack function has 140 seconds in total and 90 seconds for that request. The 400,000 figure has not been measured with a real model.

The model's own capacity is not the constraint. OpenAI lists a context window of about 1,050,000 tokens for both pack models (gpt-6-luna and gpt-6.1-terra), and 400,000 characters of English is roughly 100,000 tokens. Time, cost and how reliably a model picks details out of a very long input are the constraints.

The target is 50 documents of 15 pages. Dense documents of that size are about 1.8 million characters, so one request cannot be the design.

## Proposal

**Step 1, once per document, when it is uploaded.** After the text is read, a second pass over the whole document, in parts, keeps:
- the facts the document shows (what is already kept today);
- the exact passages that matter to a dispute, each with its page number and copied word for word;
- every payment row;
- what kind of document it is, who issued it and its date.

**Step 2, once per pack.** The pack is written from the confirmed facts, the notes and the passages. No document is sent again in full.

**Rule "every document is read in full"** still holds: step 1 reads every page of every document. A document whose notes could not be made is not marked ready.

**Checks that stay.** Each quoted passage must be found word for word in the stored text. Every payment row appears once in the payments table, which is built by code and not written by the model. A pack that cannot be completed is not delivered.

## Size

If the notes for one document average 6,000 characters (an assumption to measure), 50 documents make 300,000 characters. If they are larger, the pack is written section by section, each section from the notes it needs.

## What it needs

- A place to keep the notes, one set per document version: a database migration.
- A background job for step 1, so 50 documents do not depend on one request staying open.
- Upload and storage limits for 50 documents, and a screen that shows progress per document.
- A cost estimate per case before the limit is raised.

## Order of work

1. Measure today's pack at about 90,000 and 400,000 characters (requirements 11.5).
2. Build step 1 and compare its passages with hand-picked ones on synthetic documents, including facts on last pages.
3. Switch the FIDReC pack to the notes. Compare packs from both ways on the same synthetic cases.
4. Switch the Bank dispute pack.
5. Raise the document limit only to the number proven.

## Not decided

- Whether step 1 uses a cheaper model than pack writing.
- What a person sees while 50 documents are being read.
- Whether notes are made for documents already in cases, or only for new ones.
