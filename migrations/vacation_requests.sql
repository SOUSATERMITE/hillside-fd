-- ============================================================
-- Migration: Add email to firefighters + vacation_requests
-- ============================================================

-- 1. Add email column to firefighters
ALTER TABLE firefighters ADD COLUMN IF NOT EXISTS email text;

-- 2. Set emails for Group 1 (Tour 1)
UPDATE firefighters SET email = 'cabreu@hillsidefire.org'    WHERE id = 'd664cf9a-c180-4ae7-bc6a-be4ebd6ec51a'; -- DC I. Abreu
UPDATE firefighters SET email = 'rpienciak@hillsidefire.org' WHERE id = '2c5558bf-a58d-4482-99a3-2d33a8e6acc3'; -- CAPT R. Pienciak
UPDATE firefighters SET email = 'kmoran@hillsidefire.org'    WHERE id = '3de8014b-ab5f-4814-a07f-fb7d9fadd336'; -- CAPT K. Moran
UPDATE firefighters SET email = 'awhitaker@hillsidefire.org' WHERE id = 'e79767b0-ab1a-4663-9d1b-6201836cb9e7'; -- FF A. Whitaker
UPDATE firefighters SET email = 'fferriera@hillsidefire.org' WHERE id = '39250d50-3913-4bd6-97ba-a62acbcbc547'; -- FF F. Ferriera
UPDATE firefighters SET email = 'jdasilva@hillsidefire.org'  WHERE id = 'd07824db-00ff-4491-8425-7f6b6b31eb2b'; -- FF J. DaSilva
UPDATE firefighters SET email = 'awomack@hillsidefire.org'   WHERE id = 'ba623789-e001-4aee-a263-ddf63cf85de7'; -- FF A. Womack
UPDATE firefighters SET email = 'tlatimore@hillsidefire.org' WHERE id = '2c284498-8538-4f83-b33d-ff8fd436de57'; -- FF T. Latimore
UPDATE firefighters SET email = 'ahyatt@hillsidefire.org'    WHERE id = 'c55e10d9-2b5e-4e30-9ed1-ce0170307098'; -- FF A. Hyatt
UPDATE firefighters SET email = 'wgenao@hillsidefire.org'    WHERE id = '9457d7df-17b6-4546-bdf3-1de5bb8afead'; -- FF W. Genao-Estevez

-- 3. Set emails for Group 4 (Tour 4)
UPDATE firefighters SET email = 'mlukko@hillsidefire.org'    WHERE id = '7e416164-25f6-430c-8c23-e254d75a6a44'; -- FF M. Lukko
UPDATE firefighters SET email = 'rpereira@hillsidefire.org'  WHERE id = 'caf0318d-0425-4c44-aa46-9156dbd5df45'; -- FF R. Pereira
UPDATE firefighters SET email = 'sgibbs@hillsidefire.org'    WHERE id = '4f857a96-b8b5-4c88-a73e-1351b38b8719'; -- FF S. Gibbs
UPDATE firefighters SET email = 'jsills@hillsidefire.org'    WHERE id = '02a244ec-9374-4239-b049-0ba6131f2d06'; -- FF J. Sills
UPDATE firefighters SET email = 'jazevedo@hillsidefire.org'  WHERE id = 'c9ef7624-2050-4af9-8d62-e566d8c4ab2d'; -- FF J. Azevedo
UPDATE firefighters SET email = 'dramirez@hillsidefire.org'  WHERE id = 'cabf46f2-8903-41a1-9e20-eb5e3d8f2065'; -- FF D. Ramirez
UPDATE firefighters SET email = 'ncrosta@hillsidefire.org'   WHERE id = '1c0c7468-8906-486a-b1ea-17c4eb512836'; -- CAPT N. Crosta

-- 4. Insert Training Officer and Fire Official (not on a regular tour)
INSERT INTO firefighters (name, rank, group_number, email, active)
VALUES
  ('E. Trela',   'Captain', 0, 'etrela@hillsidefire.org',   true),
  ('P. Antunes', 'Captain', 0, 'pantunes@hillsidefire.org', true)
ON CONFLICT DO NOTHING;

-- 5. Create vacation_requests table
CREATE TABLE IF NOT EXISTS vacation_requests (
  id                           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  firefighter_id               uuid REFERENCES firefighters(id),
  ff_name                      text NOT NULL,
  ff_email                     text NOT NULL,
  ff_group                     integer,
  request_date                 date DEFAULT CURRENT_DATE,
  cancelled_dates              jsonb DEFAULT '[]',
  new_dates                    jsonb DEFAULT '[]',
  staffing_impact              boolean DEFAULT false,
  impact_explanation           text,
  ff_signature                 text NOT NULL,
  status                       text DEFAULT 'pending',
  captain_id                   uuid,
  captain_name                 text,
  captain_overtime_acknowledged boolean DEFAULT false,
  captain_action_date          timestamptz,
  dc_id                        uuid,
  dc_name                      text,
  dc_action                    text,
  dc_action_date               timestamptz,
  denial_reason                text,
  denied_by_name               text,
  created_at                   timestamptz DEFAULT now()
);
