-- Apparatus report support migration
-- Adds vehicle-info fields to apparatus, and maintenance/repair accountability
-- fields to apparatus_findings, for the per-unit history report.

alter table apparatus add column if not exists year  integer;
alter table apparatus add column if not exists make  text;
alter table apparatus add column if not exists model text;

alter table apparatus_findings add column if not exists maintenance_type     text;
alter table apparatus_findings add column if not exists maintenance_category text; -- 'routine' or 'emergency'
alter table apparatus_findings add column if not exists cost                 numeric;
alter table apparatus_findings add column if not exists parts_replaced       text;
