-- Run this once in the Supabase SQL editor for this project.
-- Adds the columns /api/extract-legacy writes to land_records that
-- Mode 1 (standard/typed) ingestion never populates. Nothing here
-- changes existing rows or existing columns — Mode 1 records simply
-- leave these new columns null/empty, matching the ingestion_mode
-- "standard" contract described in lib/types.ts.

alter table land_records
  add column if not exists ingestion_mode text default 'standard';

alter table land_records
  add column if not exists field_confidence jsonb;

alter table land_records
  add column if not exists preprocessing_diagnostics jsonb;

-- Optional but recommended: constrain ingestion_mode to the two known
-- values so a typo in future code doesn't silently create a third,
-- unhandled mode.
alter table land_records
  drop constraint if exists land_records_ingestion_mode_check;

alter table land_records
  add constraint land_records_ingestion_mode_check
  check (ingestion_mode in ('standard', 'legacy'));
