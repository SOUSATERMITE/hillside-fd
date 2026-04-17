-- Hillside Fire Department — Seed Data (Group 4)
-- Run AFTER SUPABASE_SCHEMA.sql

-- Insert firefighters
INSERT INTO firefighters (name, rank, group_number) VALUES
  ('Azevedo',  'FF',      4),
  ('Lukko',    'FF',      4),
  ('Sills',    'FF',      4),
  ('Ramirez',  'FF',      4),
  ('Pereira',  'FF',      4),
  ('Cinbos',   'FF',      4),
  ('David',    'Captain', 4),
  ('Costa',    'Captain', 4),
  ('Sousa',    'DC',      4);

-- Insert recall_list for FFs (positions 1–6)
WITH ff_ids AS (
  SELECT id, name FROM firefighters WHERE group_number = 4 AND rank = 'FF'
)
INSERT INTO recall_list (firefighter_id, group_number, rank_type, list_position, short_min_count)
SELECT id, 4, 'FF',
  CASE name
    WHEN 'Azevedo' THEN 1
    WHEN 'Lukko'   THEN 2
    WHEN 'Sills'   THEN 3
    WHEN 'Ramirez' THEN 4
    WHEN 'Pereira' THEN 5
    WHEN 'Cinbos'  THEN 6
  END,
  0
FROM ff_ids;

-- Insert recall_list for Captains (positions 1–2)
WITH cap_ids AS (
  SELECT id, name FROM firefighters WHERE group_number = 4 AND rank = 'Captain'
)
INSERT INTO recall_list (firefighter_id, group_number, rank_type, list_position, short_min_count)
SELECT id, 4, 'Captain',
  CASE name
    WHEN 'David' THEN 1
    WHEN 'Costa' THEN 2
  END,
  0
FROM cap_ids;

-- DC Sousa is in firefighters table only — DCs do not go on the recall rotation
