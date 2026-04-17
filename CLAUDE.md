# Hillside Fire Department — Project Brain

## Project Purpose
Web app for Hillside Fire Department to track firefighter sick status and manage the recall list (who gets called in for overtime shifts). Phil Sousa is the DC and the admin.

Two main tools:
- `/sick` — Mark firefighters sick, clear them RTD, see who's in the 96-hour hold window
- `/recall` — View and record recalls for each group, tracks rotation fairness
- `/admin` — Password-protected admin panel for managing firefighters, positions, and viewing logs

---

## Tech Stack

- **Frontend**: Vanilla HTML/JS, Tailwind CSS via CDN, no build step
- **Backend**: Netlify Functions (Node.js CommonJS)
- **Database**: Supabase (PostgreSQL)
- **Hosting**: Netlify (git push to main = auto deploy)
- **PWA**: Service worker + manifest for mobile install

---

## Database Tables

### `firefighters`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid pk | auto |
| name | text | |
| rank | text | CHECK IN ('FF', 'Captain', 'DC') |
| group_number | int | 1–4 |
| active | bool | default true |
| created_at | timestamptz | |

### `sick_log`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid pk | |
| firefighter_id | uuid FK | → firefighters |
| marked_sick_date | timestamptz | default now() |
| marked_sick_by | text | officer name |
| cleared_date | timestamptz | NULL = still sick |
| cleared_by | text | nullable |
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
| recorded_by | text | officer name |
| created_at | timestamptz | |

---

## Netlify Functions

All in `/netlify/functions/`. All CommonJS. All include CORS headers on every response.

| Function | Method | Auth | Purpose |
|----------|--------|------|---------|
| `_cors.js` | — | — | Shared CORS helper |
| `get-firefighters.js` | GET | None | Returns all active FFs sorted by name |
| `get-sick.js` | GET | None | Returns currently sick + recently cleared (96hr) |
| `mark-sick.js` | POST | None | Marks a FF sick, 409 if already sick |
| `clear-sick.js` | POST | None | Clears sick status (RTD) |
| `get-recall-list.js` | GET | None | Returns recall list for a group with sick status annotated |
| `record-recall.js` | POST | None | Records a recall event and rotates the list |
| `admin-login.js` | POST | x-admin-password header | Validates admin password |
| `admin-firefighters.js` | GET/POST/PUT/DELETE | x-admin-password | Full CRUD for firefighters + recall_list entries |
| `admin-positions.js` | GET/POST | x-admin-password | View/update recall list positions |
| `get-logs.js` | GET | x-admin-password | Returns sick or recall log entries |

---

## Environment Variables

Set these in the Netlify dashboard under Site Settings > Environment Variables:

```
SUPABASE_URL=               # e.g. https://xxxxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=  # From Supabase project settings > API (secret key)
ADMIN_PASSWORD=             # Whatever password you want for the /admin panel
```

Never hardcode these values anywhere.

---

## How to Set Up Supabase (Fresh Project)

1. Go to https://supabase.com and create a new project
2. Wait for project to initialize
3. Go to SQL Editor
4. Paste and run `SUPABASE_SCHEMA.sql` (creates all 4 tables, disables RLS)
5. Paste and run `seed-data.sql` (inserts Group 4 firefighters + recall positions)
6. Go to Project Settings > API and copy:
   - `URL` → set as `SUPABASE_URL` in Netlify
   - `service_role` key → set as `SUPABASE_SERVICE_ROLE_KEY` in Netlify

---

## How to Deploy to Netlify

1. Push to GitHub: `git push origin main`
2. In Netlify dashboard: New site > Import from Git > connect repo
3. Build settings (auto-detected from netlify.toml):
   - Build command: `npm install`
   - Publish directory: `public`
   - Functions directory: `netlify/functions`
4. Set environment variables (see above)
5. Deploy

Or manually trigger: Netlify dashboard > Deploys > Trigger deploy.

---

## Recall Rotation Rules

When a recall is recorded, the list position updates as follows:

| Recall Type | List Change | short_min_count |
|-------------|-------------|-----------------|
| Full shift | Move to bottom | Reset to 0 |
| Refused | Move to bottom | Reset to 0 |
| Short min (1st time, count was 0) | Stay in place | Increment to 1 |
| Short min (2nd time, count was 1) | Move to bottom | Reset to 0 |
| Vacation skip | No change | No change |

"Move to bottom" = all others shift up one position, this person goes to last.

FF list and Captain list are managed separately — FFs and Captains never share the same rotation.

DCs (District Chiefs like Sousa) are in the firefighters table but do NOT appear on the recall list.

---

## Sick Tracking Rules

- **Currently sick** = sick_log entry with cleared_date IS NULL → ineligible for recall, shown with red SICK badge
- **Cleared within 96 hours** = cleared_date IS NOT NULL and cleared within last 96hrs → still ineligible, shown with grey 96HR badge and countdown to eligibility
- **Eligible** = no sick entry, or last sick entry cleared more than 96hrs ago → green in recall list
- Countdown updates every 60 seconds on the page
- Pages auto-refresh data every 60 seconds

---

## Admin Password

The admin password is the `ADMIN_PASSWORD` environment variable set in Netlify. There is no Supabase auth for the admin panel — just a simple password check on every request via the `x-admin-password` HTTP header.

The password is stored in `sessionStorage` in the browser so you don't have to re-enter it every page load. It clears when you close the tab or click Log Out.

---

## PWA / Mobile Install

The app is a Progressive Web App. On iPhone/Android:
1. Open `/sick` or `/recall` in Safari/Chrome
2. Tap Share → "Add to Home Screen"
3. Opens in full-screen standalone mode, no browser chrome

The service worker caches the shell pages for offline fallback. API calls still require internet.

---

## Seed Data (Group 4)

FF recall order: Azevedo(1), Lukko(2), Sills(3), Ramirez(4), Pereira(5), Cinbos(6)
Captain recall order: David(1), Costa(2)
DC: Sousa (no recall list entry)

To add other groups: use the Admin panel > Firefighters tab to add members. They'll automatically get added to the recall list at the bottom of the appropriate rank category.

---

## Phil's Workflow

1. Someone calls out sick → open `/sick` → select name → select officer marking sick → tap Mark Sick
2. Person comes back → tap Clear RTD → select officer who cleared them
3. Need to recall someone → open `/recall` → select their group → choose person + type → tap Record Recall
4. Manage roster → `/admin` → Firefighters tab
5. Adjust recall order manually → `/admin` → Recall Positions tab → use Up/Down arrows → Save Order
