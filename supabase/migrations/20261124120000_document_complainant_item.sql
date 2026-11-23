-- Evidence minimums for the paid packs (Elena, 23 Nov 2026): a pack is generated only once the documents it needs are
-- in. When the evidence pipeline misreads a real document, the customer can mark it as the item it is ("this is my
-- police report"); the pack then describes it as identified by the complainant. Additive: one nullable column, written
-- only by the server (authenticated keeps its table-level SELECT and has no write grant). No data changes.

ALTER TABLE public.case_documents
  ADD COLUMN complainant_item text
  CONSTRAINT case_documents_complainant_item_check
    CHECK (complainant_item IN ('payment_proof', 'police_report', 'bank_reply_or_complaint', 'scam_message'));

COMMENT ON COLUMN public.case_documents.complainant_item IS
  'The pack evidence item the case owner says this document is, when the classifier did not read it as one.';
