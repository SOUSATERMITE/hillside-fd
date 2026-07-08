-- Business Contacts migration
-- Run in Supabase SQL editor: https://app.supabase.com → SQL Editor

create table if not exists business_contacts (
  id                          uuid primary key default gen_random_uuid(),
  business_name               text not null,
  address                     text,
  premises_phone              text,
  owner_name                  text,
  owner_phone                 text,
  emergency_contact_1_name    text,
  emergency_contact_1_phone   text,
  emergency_contact_2_name    text,
  emergency_contact_2_phone   text,
  emergency_contact_3_name    text,
  emergency_contact_3_phone   text,
  created_at                  timestamptz default now(),
  updated_at                  timestamptz default now()
);

create index if not exists idx_business_contacts_name    on business_contacts (business_name);
create index if not exists idx_business_contacts_address on business_contacts (address);

-- RLS: service role key bypasses RLS (used by Netlify functions)
-- All access goes through Netlify functions — no direct client access needed
alter table business_contacts enable row level security;
