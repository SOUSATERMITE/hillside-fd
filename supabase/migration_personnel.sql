-- Personnel file system migration
-- Run in Supabase SQL editor: https://app.supabase.com → SQL Editor

create table if not exists personnel_documents (
  id             uuid primary key default gen_random_uuid(),
  firefighter_id uuid references firefighters(id) not null,
  document_name  text not null,
  document_type  text not null default 'other',  -- certification/medical/disciplinary/commendation/training/other
  file_path      text not null,
  file_name      text not null,
  uploaded_by    text not null,
  officer_id     uuid references officers(id),
  notes          text,
  created_at     timestamptz default now()
);

create table if not exists personnel_notes (
  id             uuid primary key default gen_random_uuid(),
  firefighter_id uuid references firefighters(id) not null,
  note           text not null,
  added_by       text not null,
  officer_id     uuid references officers(id),
  created_at     timestamptz default now()
);

create index if not exists idx_personnel_docs_ff    on personnel_documents(firefighter_id, created_at desc);
create index if not exists idx_personnel_notes_ff   on personnel_notes(firefighter_id, created_at desc);

-- Storage bucket was created automatically via API.
-- To confirm: Supabase dashboard → Storage → personnel-documents (private bucket)

-- RLS: service role key bypasses RLS (used by Netlify functions)
-- All access goes through Netlify functions — no direct client access needed
alter table personnel_documents enable row level security;
alter table personnel_notes      enable row level security;
