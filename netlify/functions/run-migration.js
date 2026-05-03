// One-shot migration runner — protected by ADMIN_PASSWORD
// Call: GET /.netlify/functions/run-migration?secret=<ADMIN_PASSWORD>
// After successful run, this function can be deleted.

const { allowOrigin } = require('./_cors')

const MIGRATION_SQL = `
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

  // ── Attempt 1: explicit DB_PASS via pooler ──────────────────────────────────
  if (DB_PASS) {
    try {
      await tryPg('aws-1-us-east-1.pooler.supabase.com', 6543, poolUser, DB_PASS, log)
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true, method: 'pg_dbpass', log }) }
    } catch (e) {
      log.push('pg (DB_PASS, pooler 6543) failed: ' + e.message)
    }
  }

  // ── Attempt 2: service role JWT as password via pooler (Supavisor JWT auth) ─
  try {
    await tryPg('aws-1-us-east-1.pooler.supabase.com', 6543, poolUser, SERVICE_KEY, log)
    return { statusCode: 200, headers, body: JSON.stringify({ ok: true, method: 'pg_jwt_pooler', log }) }
  } catch (e) {
    log.push('pg (JWT, pooler 6543) failed: ' + e.message)
  }

  // ── Attempt 3: service role JWT via pooler session mode port 5432 ──────────
  try {
    await tryPg('aws-1-us-east-1.pooler.supabase.com', 5432, poolUser, SERVICE_KEY, log)
    return { statusCode: 200, headers, body: JSON.stringify({ ok: true, method: 'pg_jwt_pooler_5432', log }) }
  } catch (e) {
    log.push('pg (JWT, pooler 5432) failed: ' + e.message)
  }

  // ── Attempt 4: direct host with JWT ────────────────────────────────────────
  try {
    await tryPg(`db.${ref}.supabase.co`, 5432, 'postgres', SERVICE_KEY, log)
    return { statusCode: 200, headers, body: JSON.stringify({ ok: true, method: 'pg_jwt_direct', log }) }
  } catch (e) {
    log.push('pg (JWT, direct 5432) failed: ' + e.message)
  }

  // ── Attempt 5: DB_PASS via session pooler (port 5432) ──────────────────────
  if (DB_PASS) {
    try {
      await tryPg('aws-1-us-east-1.pooler.supabase.com', 5432, poolUser, DB_PASS, log)
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true, method: 'pg_dbpass_5432', log }) }
    } catch (e) {
      log.push('pg (DB_PASS, pooler 5432) failed: ' + e.message)
    }
    // ── Attempt 6: DB_PASS via direct host ───────────────────────────────────
    try {
      await tryPg(`db.${ref}.supabase.co`, 5432, 'postgres', DB_PASS, log)
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true, method: 'pg_dbpass_direct', log }) }
    } catch (e) {
      log.push('pg (DB_PASS, direct 5432) failed: ' + e.message)
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
