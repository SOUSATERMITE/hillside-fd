# Hillside Fire Department — Project Brain

## Project Purpose
Web app for Hillside Fire Department to manage daily operations: sick tracking, recall list, officer vacation requests, documents, policy search, and an operational dashboard. Phil Sousa is the DC and the admin.

---

## Pages (all in `/public/`)

| URL | File | Purpose |
|-----|------|---------|
| `/` | `index.html` | **Dashboard** — shift status, bulletins, events, work orders, contacts. This is the app home/start page. |
| `/sick` | `sick/index.html` | Mark firefighters sick, clear RTD, 96hr hold tracking |
| `/recall` | `recall/index.html` | View and record recalls, rotation fairness |
| `/docs` | `docs/index.html` | Upload and view department documents |
| `/search` | `search/index.html` | Full-text search across policies and documents |
| `/vacation` | `vacation/index.html` | FF submits vacation change request; officers approve via email link |
| `/admin` | `admin/index.html` | Password-protected: manage firefighters, positions, logs, officer accounts |

---

## Tech Stack

- **Frontend**: Vanilla HTML/JS, Tailwind CSS via CDN, no build step
- **Backend**: Netlify Functions (Node.js CommonJS) in `/netlify/functions/`
- **Database**: Supabase (PostgreSQL), project ref `oyyxbfguzmpsidcsgsyf`
- **Hosting**: Netlify, site ID `6f61044e-fc21-4db6-99dc-a1e084da5e42`, URL `hillside-fd.netlify.app`
- **Netlify account**: sousatermite@gmail.com (NOT sousatermite@aol.com — that's a different account)
- **GitHub repo**: `SOUSATERMITE/hillside-fd`, branch `main`
- **Deploy**: `git push origin main` → Netlify auto-deploys. Manual deploy: `netlify deploy --prod --dir=public` (must be logged into gmail account)
- **PWA**: Service worker (`sw.js` v3) + manifest. Start URL is `/` (dashboard). Install via Safari/Chrome → Add to Home Screen.

---

## Auth System

### Admin (Phil)
- Password stored in Netlify env var `ADMIN_PASSWORD`
- Passed as `x-admin-password` header on every admin request
- Session stored in `sessionStorage` — clears on tab close

### Officers (Captains, DCs, Chief)
- Stored in `officers` table with hashed PIN
- Login via PIN or one-click email magic link (token stored in `magic_tokens` table)
- Session token stored in `localStorage` as `hfd_session` JSON
- Session expires at 0730 ET next morning (shift turnover)
- Auth helper: `public/auth.js` — `AUTH.isLoggedIn()`, `AUTH.isOfficer()`, `AUTH.isAdmin()`, `AUTH.getHeaders()`
- Server-side: `_auth.js` exports `verifySession(event)` and `checkAdmin(event)` and `findOfficerInFirefighters(supabase, officer)`
- `findOfficerInFirefighters` uses 4-strategy name matching (exact → wildcard → display_name → last name) because officer names in `officers` table don't always match `firefighters` table exactly

---

## Database Tables

### `firefighters`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid pk | auto |
| name | text | e.g. "M. Gwidzz" |
| rank | text | 'FF', 'Captain', 'DC', 'Chief' |
| group_number | int | 1–4 |
| email | text | nullable |
| active | bool | default true |
| created_at | timestamptz | |

### `sick_log`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid pk | |
| firefighter_id | uuid FK | → firefighters |
| marked_sick_date | timestamptz | |
| marked_sick_by | text | |
| cleared_date | timestamptz | NULL = still sick |
| cleared_by | text | nullable |
| confirmed_24hr | bool | |
| confirmed_by | text | nullable |
| confirmed_at | timestamptz | nullable |
| notes | text | nullable |
| created_at | timestamptz | |

### `recall_list`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid pk | |
| firefighter_id | uuid FK UNIQUE | → firefighters |
| group_number | int | 1–4 |
| rank_type | text | 'FF' or 'Captain' |
| list_position | int | 1 = next to be called |
| short_min_count | int | resets when moved to bottom |
| last_recall_date | date | nullable |

### `recall_log`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid pk | |
| firefighter_id | uuid FK | → firefighters |
| shift_date | date | |
| recall_type | text | full_shift / short_min / refused / vacation_skip |
| hours_worked | numeric | nullable |
| recall_start_time | text | nullable |
| recall_end_time | text | nullable |
| tour_worked | int | nullable |
| recorded_by | text | officer name |
| created_at | timestamptz | |

### `officers`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid pk | |
| name | text | login key, e.g. "CAPT M. Gwidzz" |
| display_name | text | shown in UI |
| role | text | 'officer' or 'admin' |
| pin_hash | text | SHA-256 of PIN |
| must_change_pin | bool | true on first login |
| is_temporary | bool | acting officer flag |
| active | bool | |
| created_at | timestamptz | |

### `sessions`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid pk | |
| officer_id | uuid FK | → officers |
| token | uuid | random UUID |
| expires_at | timestamptz | 0730 ET next morning |
| created_at | timestamptz | |

### `magic_tokens`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid pk | |
| officer_id | uuid FK | → officers |
| request_id | uuid | → vacation_requests |
| token | text | 64-char hex, single-use |
| expires_at | timestamptz | 7 days |
| used | bool | marked true on redeem |
| created_at | timestamptz | |

### `vacation_requests`
Key columns: `id`, `firefighter_id`, `ff_name`, `ff_email`, `ff_group`, `request_date`, `cancelled_dates` (date[]), `new_dates` (date[]), `staffing_impact` (bool), `status` (pending → captain_approved → dc_approved → approved / denied), `captain_name`, `captain_action_date`, `dc_name`, `dc_action_date`, `chief_name`, `chief_action_date`, `denial_reason`, `notified_captains` (text[])

### `documents`
Stores uploaded file metadata; actual files in Supabase Storage bucket.

### `bulletin_posts`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid pk | |
| title | text | |
| content | text | |
| category | text | general/safety/equipment/training/reminder |
| pinned | bool | pinned posts show first |
| posted_by | text | officer display_name |
| officer_id | uuid FK | → officers |
| active | bool | soft delete |
| created_at | timestamptz | |

### `scheduled_events`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid pk | |
| title | text | |
| description | text | nullable |
| event_date | date | |
| event_time | time | nullable |
| group_number | int | nullable = all groups |
| category | text | training/inspection/drill/meeting/other |
| created_by | text | |
| officer_id | uuid FK | → officers |
| created_at | timestamptz | |

### `work_orders`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid pk | |
| title | text | |
| description | text | nullable |
| location | text | nullable |
| priority | text | low/medium/high/urgent |
| status | text | submitted/in_progress/completed/cancelled |
| submitted_by | text | |
| officer_id | uuid FK | → officers |
| assigned_to | text | nullable |
| completed_date | date | nullable |
| created_at | timestamptz | |
| updated_at | timestamptz | |

### `contacts`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid pk | |
| name | text | |
| title | text | nullable |
| phone | text | nullable |
| email | text | nullable |
| category | text | vendor/staff/emergency/utility/other |
| notes | text | nullable |
| active | bool | |
| created_at | timestamptz | |

---

## Netlify Functions

All in `/netlify/functions/`. CommonJS. All include CORS headers.

### Shared helpers
- `_cors.js` — `allowOrigin(event)` for CORS
- `_auth.js` — `verifySession(event)`, `checkAdmin(event)`, `findOfficerInFirefighters(supabase, officer)`

### Sick & Recall
| Function | Method | Auth | Purpose |
|----------|--------|------|---------|
| `get-firefighters.js` | GET | None | All active FFs |
| `get-sick.js` | GET | None | Currently sick + 96hr window |
| `mark-sick.js` | POST | None | Mark FF sick |
| `clear-sick.js` | POST | None | Clear RTD |
| `confirm-24hr.js` | POST | None | Confirm 24hr sick |
| `get-recall-list.js` | GET | None | Recall list with sick status |
| `record-recall.js` | POST | None | Record recall, rotate list |

### Officers & Auth
| Function | Method | Auth | Purpose |
|----------|--------|------|---------|
| `officer-login.js` | POST | PIN | Create session |
| `officer-logout.js` | POST | Session | Destroy session |
| `officer-change-pin.js` | POST | Session | Change PIN |
| `redeem-magic-token.js` | POST | Token | Auto-login from email link |
| `get-officers.js` | GET | None | List active officers (for login dropdown) |

### Vacation
| Function | Method | Auth | Purpose |
|----------|--------|------|---------|
| `submit-vacation.js` | POST | None | FF submits request, emails captains with magic link |
| `get-vacation-requests.js` | GET | Session | Officer views requests for their tour |
| `approve-vacation.js` | POST | Session | Approve/deny; emails next approver |
| `delete-vacation-request.js` | POST | Admin | Hard delete a request |

### Documents
| Function | Method | Auth | Purpose |
|----------|--------|------|---------|
| `get-documents.js` | GET | None | List documents |
| `upload-document.js` | POST | Admin | Upload to Supabase Storage |
| `delete-document.js` | POST | Admin | Delete document |

### Admin
| Function | Method | Auth | Purpose |
|----------|--------|------|---------|
| `admin-login.js` | POST | Password | Validate admin password |
| `admin-firefighters.js` | GET/POST/PUT/DELETE | Admin | CRUD firefighters + recall list |
| `admin-positions.js` | GET/POST | Admin | View/update recall positions |
| `admin-officers.js` | GET/POST/PUT/DELETE | Admin | CRUD officer accounts |
| `get-logs.js` | GET | Admin | Sick or recall log entries |
| `get-acting.js` | GET | None | Acting officers list |
| `grant-acting.js` | POST | Admin | Grant acting status |
| `revoke-acting.js` | POST | Admin | Revoke acting status |
| `edit-record.js` | POST | Admin | Edit sick/recall log entry |
| `delete-record.js` | POST | Admin | Delete sick/recall log entry |

### Dashboard
| Function | Method | Auth | Purpose |
|----------|--------|------|---------|
| `get-dashboard.js` | GET | None | All dashboard data in one call |
| `post-bulletin.js` | POST | Officer/Admin | Post, pin, delete bulletins |
| `manage-events.js` | POST | Officer | Add scheduled events |
| `manage-work-orders.js` | POST | Officer | Submit/update work orders |
| `manage-contacts.js` | POST | Officer | Add/edit/delete contacts |

### Utilities
| Function | Method | Auth | Purpose |
|----------|--------|------|---------|
| `test-smtp.js` | POST | Admin | Test Zoho SMTP delivery |

---

## Environment Variables (Netlify dashboard)

```
SUPABASE_URL=                  # https://oyyxbfguzmpsidcsgsyf.supabase.co
SUPABASE_SERVICE_ROLE_KEY=     # secret — all functions use this
ADMIN_PASSWORD=                # Phil's admin panel password
ZOHO_SMTP_USER=                # sousa@sousapest.com
ZOHO_SMTP_PASS=                # Zoho SMTP password
```

---

## Shift Rotation (Dashboard)

- **Anchor**: Group 3 on April 30, 2026 at 07:30 ET
- **Rotation**: 3 → 4 → 1 → 2 → repeat (24hr shifts, no gaps)
- **Calculation**: `const SHIFT_ANCHOR = new Date('2026-04-30T11:30:00Z')` (0730 ET = 1130 UTC)
- `shifts = floor((now - ANCHOR) / 86400000)`, `group = [3,4,1,2][shifts % 4]`
- This logic is in both `get-dashboard.js` (server) and `public/index.html` (client)

---

## Email (SMTP)

- Provider: Zoho Mail via SMTP (`smtp.zoho.com`, port 465, SSL)
- From address: `sousa@sousapest.com`
- Vacation approval emails include a magic link token for one-click officer login
- `submit-vacation.js` emails all captains on the FF's tour + the Chief
- `approve-vacation.js` emails the next approver (Captain → DC → Chief → FF on final approval)

---

## Recall Rotation Rules

| Recall Type | List Change | short_min_count |
|-------------|-------------|-----------------|
| Full shift | Move to bottom | Reset to 0 |
| Refused | Move to bottom | Reset to 0 |
| Short min (count was 0) | Stay in place | Increment to 1 |
| Short min (count was 1) | Move to bottom | Reset to 0 |
| Vacation skip | No change | No change |

FF list and Captain list are separate. DCs and Chiefs do not appear on the recall list.

---

## Sick Tracking Rules

- **Currently sick** = `cleared_date IS NULL` → ineligible for recall
- **Cleared within 96 hours** = `cleared_date NOT NULL` and within 96hrs → still ineligible (96HR badge + countdown)
- **Eligible** = no sick entry or cleared more than 96hrs ago
- Pages auto-refresh every 60 seconds

---

## Important Known Issues / History

- **Officer name mismatch**: Officers table stores names like `"CAPT M. Gwidzz"` but firefighters table has `"M. Gwidzz"`. The `findOfficerInFirefighters()` helper in `_auth.js` handles this with 4-strategy matching. Do NOT use `.eq('name', officer.name)` directly in any new function — always use the shared helper.
- **Netlify accounts**: There are TWO Netlify accounts. `hillside-fd.netlify.app` is under `sousatermite@gmail.com`. The AOL account has other sites (sousa-referral, sousapest.com). Always deploy hillside-fd from the gmail account.
- **Database migrations**: The 4 dashboard tables (`bulletin_posts`, `scheduled_events`, `work_orders`, `contacts`) require running `supabase/migration_dashboard.sql` in the Supabase SQL editor. The service role key CANNOT run DDL — only a database password or Supabase Personal Access Token (sbp_...) can.
- **Magic tokens table**: `supabase/magic_tokens.sql` must also be run in Supabase if not already done.
