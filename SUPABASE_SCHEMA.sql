-- Hillside Fire Department — Database Schema
-- Run this in the Supabase SQL editor for a fresh project

-- Disable RLS on all tables (internal app, no public access)

CREATE TABLE IF NOT EXISTS firefighters (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name         text NOT NULL,
  rank         text NOT NULL CHECK (rank IN ('FF', 'Captain', 'DC')),
  group_number int NOT NULL CHECK (group_number BETWEEN 1 AND 4),
  badge_number integer,
  active       boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE firefighters DISABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS sick_log (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  firefighter_id     uuid NOT NULL REFERENCES firefighters(id),
  marked_sick_date   timestamptz NOT NULL DEFAULT now(),
  marked_sick_by     text NOT NULL,
  cleared_date       timestamptz,
  cleared_by         text,
  notes              text,
  created_at         timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE sick_log DISABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS recall_list (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  firefighter_id   uuid NOT NULL UNIQUE REFERENCES firefighters(id),
  group_number     int NOT NULL CHECK (group_number BETWEEN 1 AND 4),
  rank_type        text NOT NULL CHECK (rank_type IN ('FF', 'Captain')),
  list_position    int NOT NULL,
  short_min_count  int NOT NULL DEFAULT 0,
  last_recall_date date
);

ALTER TABLE recall_list DISABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS recall_log (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  firefighter_id  uuid NOT NULL REFERENCES firefighters(id),
  shift_date      date NOT NULL DEFAULT CURRENT_DATE,
  recall_type     text NOT NULL CHECK (recall_type IN ('full_shift', 'short_min', 'refused', 'vacation_skip')),
  hours_worked    numeric,
  recorded_by     text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE recall_log DISABLE ROW LEVEL SECURITY;
