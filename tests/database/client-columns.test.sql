begin;

create extension if not exists pgtap with schema extensions;
select plan(1);

-- Columns the browser selects from case_documents (CASE_DOCUMENT_SELECT in lib/types/documents.ts; the
-- contract test tests/contracts/case-document-columns.test.ts keeps the two lists equal). A missing column turns the
-- dashboard's document query into a 400.
select is_empty(
  $$
    select wanted.name
    from unnest(array[
      'id', 'case_id', 'updated_at', 'filename', 'original_filename', 'file_size', 'mime_type', 'document_type',
      'exhibit_label', 'upload_date', 'file_url', 'is_processed', 'sha256', 'processing_status', 'processing_error',
      'verified_document_type', 'verification_status', 'verification_confidence', 'content_latest_id',
      'storage_provider', 'storage_bucket', 'storage_path', 'complainant_item'
    ]) as wanted(name)
    where not exists (
      select 1 from information_schema.columns c
      where c.table_schema = 'public' and c.table_name = 'case_documents' and c.column_name = wanted.name
    )
  $$,
  'every case_documents column the dashboard selects exists'
);

select * from finish();
rollback;
