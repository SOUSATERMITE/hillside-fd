// One-shot migration runner — protected by ADMIN_PASSWORD
// Call: GET /.netlify/functions/run-migration?secret=<ADMIN_PASSWORD>
// After successful run, this function can be deleted.

const { allowOrigin } = require('./_cors')

const MIGRATION_SQL = `
  -- contacts key_code column
  alter table contacts add column if not exists key_code text;

  create table if not exists personnel_documents (
    id             uuid primary key default gen_random_uuid(),
    firefighter_id uuid references firefighters(id) not null,
    document_name  text not null,
    document_type  text not null default 'other',
    file_path      text not null,
    file_name      text not null,
    uploaded_by    text not null,
    officer_id     uuid references officers(id),
    notes          text,
    created_at     timestamptz default now()
  );
  create table if not exists personnel_notes (
    id             uuid primary key default gen_random_uuid(),
    firefighter_id uuid references firefighters(id) not null,
    note           text not null,
    added_by       text not null,
    officer_id     uuid references officers(id),
    created_at     timestamptz default now()
  );
  create index if not exists idx_personnel_docs_ff  on personnel_documents(firefighter_id, created_at desc);
  create index if not exists idx_personnel_notes_ff on personnel_notes(firefighter_id, created_at desc);
  alter table personnel_documents enable row level security;
  alter table personnel_notes      enable row level security;

  create table if not exists board_attachments (
    id          uuid primary key default gen_random_uuid(),
    source_type text not null check (source_type in ('bulletin','event')),
    source_id   uuid not null,
    file_name   text not null,
    file_path   text not null,
    file_size   integer,
    uploaded_by text not null,
    officer_id  uuid references officers(id),
    created_at  timestamptz default now()
  );
  create index if not exists idx_board_attach_source on board_attachments(source_type, source_id, created_at);
  alter table board_attachments enable row level security;

  alter table apparatus_findings add column if not exists findings_data jsonb;

  create table if not exists daily_duties (
    id              uuid primary key default gen_random_uuid(),
    title           text not null,
    description     text,
    duty_type       text not null default 'other' check (duty_type in ('administrative','training','maintenance','inspection','other')),
    recurrence      text not null default 'one_time' check (recurrence in ('one_time','daily','weekly','monthly','specific_day')),
    recurrence_day  int,
    specific_date   date,
    tour_specific   int,
    requires_report boolean default false,
    active          boolean default true,
    created_by      text not null,
    officer_id      uuid references officers(id),
    created_at      timestamptz default now()
  );

  create table if not exists duty_completions (
    id              uuid primary key default gen_random_uuid(),
    duty_id         uuid references daily_duties(id) on delete cascade,
    completed_date  date not null,
    completed_by    text not null,
    officer_id      uuid references officers(id),
    notes           text,
    created_at      timestamptz default now(),
    unique(duty_id, completed_date)
  );

  create table if not exists duty_log (
    id              uuid primary key default gen_random_uuid(),
    duty_id         uuid references daily_duties(id) on delete cascade,
    shift_date      date not null,
    group_on_duty   int,
    status          text not null check (status in ('completed','incomplete','not_applicable')),
    completed_by    text,
    officer_id      uuid references officers(id),
    notes           text,
    created_at      timestamptz default now(),
    unique(duty_id, shift_date)
  );

  create index if not exists idx_daily_duties_active     on daily_duties(active, recurrence);
  create index if not exists idx_duty_completions_date   on duty_completions(duty_id, completed_date);
  create index if not exists idx_duty_log_date           on duty_log(duty_id, shift_date);

  -- Expand recurrence constraint + add recurrence_config JSONB column
  alter table daily_duties add column if not exists recurrence_config jsonb;
  alter table daily_duties drop constraint if exists daily_duties_recurrence_check;
  alter table daily_duties add constraint daily_duties_recurrence_check
    check (recurrence in ('one_time','daily','weekly','biweekly','monthly_date','monthly_dow','yearly','monthly','specific_day'));

  -- Manual issue reporting columns on apparatus_findings
  alter table apparatus_findings alter column apparatus_id drop not null;
  alter table apparatus_findings add column if not exists item_name        text;
  alter table apparatus_findings add column if not exists item_category    text;
  alter table apparatus_findings add column if not exists issue_type       text;
  alter table apparatus_findings add column if not exists resolution_notes text;
`

async function tryPg(host, port, user, password, log) {
  const { Client } = require('pg')
  const client = new Client({
    host, port,
    database: 'postgres',
    user, password,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 10000
  })
  await client.connect()
  log.push(`Connected via pg (${host}:${port})`)
  await client.query(MIGRATION_SQL)
  log.push('Migration SQL executed successfully')
  await client.end()
}

exports.handler = async (event) => {
  const origin = allowOrigin(event)
  const headers = {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Content-Type': 'application/json'
  }
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' }

  const secret = event.queryStringParameters?.secret
  if (secret !== process.env.ADMIN_PASSWORD) {
    return { statusCode: 401, headers, body: JSON.stringify({ error: 'Unauthorized' }) }
  }

  const SUPABASE_URL = process.env.SUPABASE_URL
  const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY
  const DB_PASS      = process.env.SUPABASE_DB_PASS

  const log = []
  const ref  = SUPABASE_URL.match(/\/\/([^.]+)/)?.[1] || ''
  const poolUser = `postgres.${ref}`

  const poolHosts = [
    'aws-0-us-east-1.pooler.supabase.com',
    'aws-0-us-west-1.pooler.supabase.com',
    'aws-0-eu-west-1.pooler.supabase.com',
    'aws-0-ap-southeast-1.pooler.supabase.com',
  ]

  if (DB_PASS) {
    // ── Attempt 1: DB_PASS via direct host (most reliable for DDL) ─────────
    try {
      await tryPg(`db.${ref}.supabase.co`, 5432, 'postgres', DB_PASS, log)
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true, method: 'pg_dbpass_direct', log }) }
    } catch (e) {
      log.push('pg (DB_PASS, direct 5432) failed: ' + e.message)
    }
    // ── Attempt 2–5: DB_PASS via each pooler region (transaction mode) ──────
    for (const host of poolHosts) {
      try {
        await tryPg(host, 6543, poolUser, DB_PASS, log)
        return { statusCode: 200, headers, body: JSON.stringify({ ok: true, method: `pg_dbpass_${host}`, log }) }
      } catch (e) {
        log.push(`pg (DB_PASS, ${host}:6543) failed: ${e.message}`)
      }
    }
    // ── Attempt 6–9: DB_PASS via each pooler region (session mode) ──────────
    for (const host of poolHosts) {
      try {
        await tryPg(host, 5432, poolUser, DB_PASS, log)
        return { statusCode: 200, headers, body: JSON.stringify({ ok: true, method: `pg_dbpass_sess_${host}`, log }) }
      } catch (e) {
        log.push(`pg (DB_PASS, ${host}:5432) failed: ${e.message}`)
      }
    }
  }

  // ── Fallback: service role JWT via pooler ───────────────────────────────────
  for (const host of poolHosts) {
    try {
      await tryPg(host, 6543, poolUser, SERVICE_KEY, log)
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true, method: `pg_jwt_${host}`, log }) }
    } catch (e) {
      log.push(`pg (JWT, ${host}:6543) failed: ${e.message}`)
    }
  }

  // ── Fallback: check if tables already exist via REST ───────────────────────
  const [chk1, chk2] = await Promise.all([
    fetch(`${SUPABASE_URL}/rest/v1/personnel_documents?limit=0`, {
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` }
    }),
    fetch(`${SUPABASE_URL}/rest/v1/personnel_notes?limit=0`, {
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` }
    })
  ])
  const docsOk  = chk1.ok  || chk1.status  === 206
  const notesOk = chk2.ok  || chk2.status  === 206

  if (docsOk && notesOk) {
    log.push('Tables already exist — no migration needed')
    return { statusCode: 200, headers, body: JSON.stringify({ ok: true, method: 'already_exists', log }) }
  }

  return {
    statusCode: 500,
    headers,
    body: JSON.stringify({
      ok: false,
      message: 'All pg connection attempts failed. Go to Supabase dashboard → Project Settings → Database → Database password → copy it → set SUPABASE_DB_PASS in Netlify env vars → call this endpoint again.',
      personnel_documents_exists: docsOk,
      personnel_notes_exists: notesOk,
      log
    })
  }
}
