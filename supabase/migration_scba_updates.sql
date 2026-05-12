-- SCBA Updates Migration
-- Task 1: Replace PSI with Full/Not Full toggle
ALTER TABLE scba_inspections ADD COLUMN IF NOT EXISTS pressure_full boolean;
ALTER TABLE spare_bottles ADD COLUMN IF NOT EXISTS is_full boolean;
ALTER TABLE bottle_psi_log ADD COLUMN IF NOT EXISTS is_full boolean;

-- Task 2: Annual Flow Test Tracker
CREATE TABLE IF NOT EXISTS scba_flow_tests (
  id uuid primary key default gen_random_uuid(),
  pack_id uuid references scba_packs(id),
  test_date date not null,
  result text not null check (result in ('passed','failed')),
  tested_by text not null,
  next_due date not null,
  notes text,
  created_at timestamptz default now()
);
