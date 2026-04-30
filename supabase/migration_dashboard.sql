-- Dashboard tables migration
-- Run in Supabase SQL editor

create table if not exists bulletin_posts (
  id          uuid primary key default gen_random_uuid(),
  title       text not null,
  content     text not null,
  category    text not null default 'general', -- general/safety/equipment/training/reminder
  pinned      boolean not null default false,
  posted_by   text not null,
  officer_id  uuid references officers(id),
  created_at  timestamptz default now(),
  active      boolean not null default true
);

create table if not exists scheduled_events (
  id                    uuid primary key default gen_random_uuid(),
  title                 text not null,
  description           text,
  event_date            date not null,
  event_time            time,
  group_number          int,  -- null = all groups
  category              text not null default 'other', -- training/inspection/drill/meeting/other
  created_by            text not null,
  officer_id            uuid references officers(id),
  notify_on_duty_group  boolean not null default true,
  created_at            timestamptz default now()
);

create table if not exists work_orders (
  id            uuid primary key default gen_random_uuid(),
  title         text not null,
  description   text,
  location      text,
  priority      text not null default 'medium', -- low/medium/high/urgent
  status        text not null default 'submitted', -- submitted/in_progress/completed/cancelled
  submitted_by  text not null,
  officer_id    uuid references officers(id),
  assigned_to   text,
  completed_date date,
  created_at    timestamptz default now(),
  updated_at    timestamptz default now()
);

create table if not exists contacts (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  title       text,
  phone       text,
  email       text,
  category    text not null default 'other', -- vendor/staff/emergency/utility/other
  notes       text,
  active      boolean not null default true,
  created_at  timestamptz default now()
);

-- Indexes for performance
create index if not exists idx_bulletin_posts_active_created  on bulletin_posts(active, created_at desc);
create index if not exists idx_scheduled_events_date          on scheduled_events(event_date);
create index if not exists idx_work_orders_status             on work_orders(status);
create index if not exists idx_contacts_category              on contacts(category);
