-- Run this once in the Supabase SQL editor
-- Creates the magic_tokens table for one-click officer login from email links

create table if not exists magic_tokens (
  id          uuid primary key default gen_random_uuid(),
  officer_id  uuid not null references officers(id),
  request_id  uuid references vacation_requests(id),
  token       text not null unique,
  expires_at  timestamptz not null,
  used        boolean not null default false,
  created_at  timestamptz default now()
);

-- No RLS needed — only accessed via service role key in Netlify Functions
-- Optionally: auto-clean expired tokens (run manually or via pg_cron)
-- delete from magic_tokens where expires_at < now() - interval '30 days';
