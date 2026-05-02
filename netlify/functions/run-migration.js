// One-shot migration runner — protected by ADMIN_PASSWORD
// Call: GET /.netlify/functions/run-migration?secret=<ADMIN_PASSWORD>
// After successful run, this function can be deleted.

const { allowOrigin } = require('./_cors')

exports.handler = async (event) => {
  const origin = allowOrigin(event)
  const headers = {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Content-Type': 'application/json'
  }
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' }

  // Protect with admin password
  const secret = event.queryStringParameters?.secret
  if (secret !== process.env.ADMIN_PASSWORD) {
    return { statusCode: 401, headers, body: JSON.stringify({ error: 'Unauthorized' }) }
  }

  const SUPABASE_URL = process.env.SUPABASE_URL
  const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY
  const DB_PASS      = process.env.SUPABASE_DB_PASS

  const log = []

  // ── Try pg connection if SUPABASE_DB_PASS is set ────────────────────────────
  if (DB_PASS) {
    try {
      const { Client } = require('pg')
      const client = new Client({
        host: 'aws-1-us-east-1.pooler.supabase.com',
        port: 6543,
        database: 'postgres',
        user: `postgres.${SUPABASE_URL.match(/\/\/([^.]+)/)?.[1] || ''}`,
        password: DB_PASS,
        ssl: { rejectUnauthorized: false },
        connectionTimeoutMillis: 10000
      })
      await client.connect()
      log.push('Connected to database via pooler')

      const sql = `
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
      `
      await client.query(sql)
      log.push('Migration SQL executed successfully')
      await client.end()
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true, method: 'pg', log }) }
    } catch (e) {
      log.push('pg failed: ' + e.message)
    }
  } else {
    log.push('No SUPABASE_DB_PASS set — skipping pg connection')
  }

  // ── Verify tables exist via REST ────────────────────────────────────────────
  const check = await fetch(`${SUPABASE_URL}/rest/v1/personnel_documents?limit=0`, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` }
  })
  const docsOk = check.ok || check.status === 206

  const check2 = await fetch(`${SUPABASE_URL}/rest/v1/personnel_notes?limit=0`, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` }
  })
  const notesOk = check2.ok || check2.status === 206

  if (docsOk && notesOk) {
    log.push('Tables already exist — no migration needed')
    return { statusCode: 200, headers, body: JSON.stringify({ ok: true, method: 'already_exists', log }) }
  }

  return {
    statusCode: 500,
    headers,
    body: JSON.stringify({
      ok: false,
      message: 'Cannot create tables without SUPABASE_DB_PASS env var. Set it to your Supabase postgres database password in Netlify dashboard, then call this endpoint again.',
      personnel_documents_exists: docsOk,
      personnel_notes_exists: notesOk,
      log
    })
  }
}
