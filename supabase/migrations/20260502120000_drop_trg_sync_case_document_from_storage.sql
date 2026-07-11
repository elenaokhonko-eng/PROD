/*
  case_documents registration is handled explicitly by the application
  (registerCaseDocumentFromEvidenceV1 in lib/case-documents/register-from-evidence-v1.ts),
  not by storage object triggers.

  Legacy trigger trg_sync_case_document_from_storage only ran meaningful work for
  bucket_id = 'case_evidence'; current uploads use bucket 'evidence'. This migration
  removes the trigger only; public.sync_case_document_from_storage() is retained.
*/

DROP TRIGGER IF EXISTS trg_sync_case_document_from_storage ON storage.objects;
