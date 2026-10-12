-- Recall log edit tracking migration
-- Additive only: three new nullable columns on recall_log. Nothing is dropped,
-- rewritten or backfilled, so existing entries show no "Edited by" note.
--   edited_by           - officer display_name from the authenticated session (set server-side)
--   edited_at           - when the most recent edit was saved
--   original_shift_date - the shift_date before the first date change (set once; NULL = date never changed)

alter table recall_log add column if not exists edited_by           text;
alter table recall_log add column if not exists edited_at           timestamptz;
alter table recall_log add column if not exists original_shift_date date;
