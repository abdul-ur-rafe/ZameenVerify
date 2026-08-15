-- Run this once in the Supabase SQL editor for this project.
-- Creates the table /api/report writes to and /verify/[reportId] reads from.
-- This is a deliberate snapshot store, separate from `verifications` —
-- see the comment at the top of app/api/report/route.ts for why.

create table if not exists verification_reports (
  id uuid primary key default gen_random_uuid(),
  report_id text unique not null,
  generated_at timestamptz not null,
  records jsonb not null,
  verification jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists verification_reports_report_id_idx
  on verification_reports (report_id);

-- Public read access: the whole point of the QR code is that anyone who
-- scans it (no login) can confirm the report is real. Insert stays
-- restricted to your service — the anon key used by the app can insert
-- because /api/report runs server-side, but you may want to tighten this
-- further (e.g. a dedicated service-role key) before a real deployment.
alter table verification_reports enable row level security;

create policy "Public can read verification reports"
  on verification_reports for select
  using (true);

create policy "Anyone can insert verification reports"
  on verification_reports for insert
  with check (true);
