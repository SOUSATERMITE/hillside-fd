-- Hillside Fire Department — Full Roster (all 4 tours)
-- Run AFTER SUPABASE_SCHEMA.sql
-- Safe to re-run: clears existing data before seeding

-- Add badge_number column if it doesn't exist yet
ALTER TABLE firefighters ADD COLUMN IF NOT EXISTS badge_number integer;

-- Clear existing data (cascade handles FK dependencies)
TRUNCATE recall_log, sick_log, recall_list, firefighters;

-- ─── TOUR 1 ──────────────────────────────────────────────────────────────────
INSERT INTO firefighters (name, rank, group_number, badge_number) VALUES
  ('I. Abreu',          'DC',      1, 150),
  ('R. Pienciak',       'Captain', 1, 147),
  ('K. Moran',          'Captain', 1, 152),
  ('A. Whitaker',       'FF',      1, 144),
  ('F. Ferriera',       'FF',      1, 159),
  ('J. DaSilva',        'FF',      1, 162),
  ('A. Womack',         'FF',      1, 165),
  ('T. Latimore',       'FF',      1, 170),
  ('A. Hyatt',          'FF',      1, 174),
  ('W. Genao-Estevez',  'FF',      1, 179);

-- ─── TOUR 2 ──────────────────────────────────────────────────────────────────
INSERT INTO firefighters (name, rank, group_number, badge_number) VALUES
  ('J. Pienciak',  'DC',      2, 140),
  ('M. Gwidzz',    'Captain', 2, 143),
  ('J. Bananzio',  'Captain', 2, 166),
  ('R. DePack',    'FF',      2, 141),
  ('M. Moran',     'FF',      2, 145),
  ('J. Williams',  'FF',      2, 160),
  ('C. Ryan',      'FF',      2, 172),
  ('E. Ruhl',      'FF',      2, 173),
  ('M. Salters',   'FF',      2, 178);

-- ─── TOUR 3 ──────────────────────────────────────────────────────────────────
INSERT INTO firefighters (name, rank, group_number, badge_number) VALUES
  ('D. Ferrigno',   'DC',      3, 154),
  ('T. Korzeneski', 'Captain', 3, 139),
  ('Z. Lofton',     'Captain', 3, 167),
  ('C. Alfano',     'FF',      3, 146),
  ('J. Allende',    'FF',      3, 155),
  ('M. Kelly',      'FF',      3, 161),
  ('B. Suarez',     'FF',      3, 169),
  ('R. Gomez',      'FF',      3, 175),
  ('D. Rodrigues',  'FF',      3, 177),
  ('K. Bien-Aime',  'FF',      3, 180);

-- ─── TOUR 4 ──────────────────────────────────────────────────────────────────
INSERT INTO firefighters (name, rank, group_number, badge_number) VALUES
  ('F. Sousa',   'DC',      4, 148),
  ('J. David',   'Captain', 4, 151),
  ('N. Crosta',  'Captain', 4, 158),
  ('M. Lukko',   'FF',      4, 156),
  ('R. Pereira', 'FF',      4, 157),
  ('S. Gibbs',   'FF',      4, 163),
  ('J. Sills',   'FF',      4, 168),
  ('D. Ramirez', 'FF',      4, 176),
  ('J. Azevedo', 'FF',      4, 171);

-- ─── RECALL LIST POSITIONS ───────────────────────────────────────────────────
-- Tour 1 — FFs (recall order as listed: Whitaker→Ferriera→DaSilva→Womack→Latimore→Hyatt→Genao-Estevez)
WITH t AS (
  SELECT id, name FROM firefighters WHERE group_number = 1 AND rank = 'FF'
)
INSERT INTO recall_list (firefighter_id, group_number, rank_type, list_position)
SELECT id, 1, 'FF',
  CASE name
    WHEN 'A. Whitaker'      THEN 1
    WHEN 'F. Ferriera'      THEN 2
    WHEN 'J. DaSilva'       THEN 3
    WHEN 'A. Womack'        THEN 4
    WHEN 'T. Latimore'      THEN 5
    WHEN 'A. Hyatt'         THEN 6
    WHEN 'W. Genao-Estevez' THEN 7
  END
FROM t;

-- Tour 1 — Captains (Pienciak→Moran)
WITH t AS (
  SELECT id, name FROM firefighters WHERE group_number = 1 AND rank = 'Captain'
)
INSERT INTO recall_list (firefighter_id, group_number, rank_type, list_position)
SELECT id, 1, 'Captain',
  CASE name
    WHEN 'R. Pienciak' THEN 1
    WHEN 'K. Moran'    THEN 2
  END
FROM t;

-- Tour 2 — FFs (DePack→Moran→Williams→Ryan→Ruhl→Salters)
WITH t AS (
  SELECT id, name FROM firefighters WHERE group_number = 2 AND rank = 'FF'
)
INSERT INTO recall_list (firefighter_id, group_number, rank_type, list_position)
SELECT id, 2, 'FF',
  CASE name
    WHEN 'R. DePack'   THEN 1
    WHEN 'M. Moran'    THEN 2
    WHEN 'J. Williams' THEN 3
    WHEN 'C. Ryan'     THEN 4
    WHEN 'E. Ruhl'     THEN 5
    WHEN 'M. Salters'  THEN 6
  END
FROM t;

-- Tour 2 — Captains (Gwidzz→Bananzio)
WITH t AS (
  SELECT id, name FROM firefighters WHERE group_number = 2 AND rank = 'Captain'
)
INSERT INTO recall_list (firefighter_id, group_number, rank_type, list_position)
SELECT id, 2, 'Captain',
  CASE name
    WHEN 'M. Gwidzz'   THEN 1
    WHEN 'J. Bananzio' THEN 2
  END
FROM t;

-- Tour 3 — FFs (Alfano→Allende→Kelly→Suarez→Gomez→Rodrigues→Bien-Aime)
WITH t AS (
  SELECT id, name FROM firefighters WHERE group_number = 3 AND rank = 'FF'
)
INSERT INTO recall_list (firefighter_id, group_number, rank_type, list_position)
SELECT id, 3, 'FF',
  CASE name
    WHEN 'C. Alfano'     THEN 1
    WHEN 'J. Allende'    THEN 2
    WHEN 'M. Kelly'      THEN 3
    WHEN 'B. Suarez'     THEN 4
    WHEN 'R. Gomez'      THEN 5
    WHEN 'D. Rodrigues'  THEN 6
    WHEN 'K. Bien-Aime'  THEN 7
  END
FROM t;

-- Tour 3 — Captains (Korzeneski→Lofton)
WITH t AS (
  SELECT id, name FROM firefighters WHERE group_number = 3 AND rank = 'Captain'
)
INSERT INTO recall_list (firefighter_id, group_number, rank_type, list_position)
SELECT id, 3, 'Captain',
  CASE name
    WHEN 'T. Korzeneski' THEN 1
    WHEN 'Z. Lofton'     THEN 2
  END
FROM t;

-- Tour 4 — FFs (Lukko→Pereira→Gibbs→Sills→Ramirez→Azevedo)
WITH t AS (
  SELECT id, name FROM firefighters WHERE group_number = 4 AND rank = 'FF'
)
INSERT INTO recall_list (firefighter_id, group_number, rank_type, list_position)
SELECT id, 4, 'FF',
  CASE name
    WHEN 'M. Lukko'   THEN 1
    WHEN 'R. Pereira' THEN 2
    WHEN 'S. Gibbs'   THEN 3
    WHEN 'J. Sills'   THEN 4
    WHEN 'D. Ramirez' THEN 5
    WHEN 'J. Azevedo' THEN 6
  END
FROM t;

-- Tour 4 — Captains (David→Crosta)
WITH t AS (
  SELECT id, name FROM firefighters WHERE group_number = 4 AND rank = 'Captain'
)
INSERT INTO recall_list (firefighter_id, group_number, rank_type, list_position)
SELECT id, 4, 'Captain',
  CASE name
    WHEN 'J. David'  THEN 1
    WHEN 'N. Crosta' THEN 2
  END
FROM t;
