# CDSL Operations Dashboard

Production-oriented operations dashboard for GEPL Capital's CDSL processes.

## Current architecture

- Frontend: React + Vite on port `5173`
- Backend: Node.js + Express on port `5001`
- Redis: fresh/stale cache plus asynchronous status-update queue
- Database: BigQuery
- GCP project: `gepl-operations`
- CDSL datasets: `asia-south1`
- Shared source tables such as BuddySystem: `US`
- Cross-region rule: read the US source in a separate query, then write a local `asia-south1` mirror. Never join US and `asia-south1` tables in one query.

## BigQuery datasets

| Dataset | Region | Purpose |
|---|---|---|
| `CDSL_CONFIG` | asia-south1 | Process, step, calendar, status, and buddy configuration |
| `CDSL_RUNTIME` | asia-south1 | Live `process_tracker` state and stored procedures |
| `CDSL_LOGS_NEW` | asia-south1 | Append-only step audit log |
| `CDSL_ARCHIVE` | asia-south1 | End-of-day process snapshots |
| `CDSL_REPORTING` | asia-south1 | Reporting views |
| `universal-table-store.BuddySystem` | US | Read-only buddy and attendance source |

## Important typed-schema changes

The deployed BigQuery environment uses:

- `CDSL_CONFIG.process_master.planned_time_value TIME`
- `CDSL_CONFIG.trading_calendar.trade_date DATE`
- `CDSL_CONFIG.fx_is_working_day(DATE)`
- No application dependency on the removed legacy fields:
  - `process_master.planned_time`
  - `trading_calendar.dd_mm_yyyy_slash`

A read-only verification script is included at `sql/verify_current_state.sql`.

## Working features

- Process list and live process-step APIs
- Redis fresh/stale caching
- Buddy assignment: SELF -> BUDDY -> REPORTING -> ADMIN
- Asynchronous step-status queue backed by Redis Streams
- Atomic BigQuery commit through `sp_mark_step_status`
- Audit logging
- Process initialization and archive endpoints
- Scheduler endpoints protected with `X-Scheduler-Secret`
- Typed trading-calendar working-day check
- Non-blocking frontend notifications
- Optimistic status updates
- Separate frontend read/write timeouts
- Lint-clean React dashboard
- Fixed Vite port with `strictPort: true`

## Daily scheduler endpoints

| Time IST | Endpoint | Job |
|---|---|---|
| 7:00 AM | `POST /scheduler/sync-buddy` | US BuddySystem -> local `buddy_master` |
| 8:00 AM | `POST /scheduler/init-all` | Initialize all active processes |
| 6:00 PM | `POST /scheduler/archive-all` | Archive the previous process date |

All scheduler calls require:

```text
X-Scheduler-Secret: <SCHEDULER_SECRET>
```

## Local setup

### Frontend

```powershell
Copy-Item .env.example .env
npm install
npm run lint
npm run build
npm run dev
```

Frontend URL:

```text
http://localhost:5173
```

Vite uses `strictPort: true`; if port 5173 is occupied, startup fails instead of silently switching to another port.

### Backend

```powershell
cd backend
Copy-Item .env.example .env
npm install
npm run check
npm run dev
```

Backend URL:

```text
http://localhost:5001
```

Health check:

```text
GET http://localhost:5001/health
```

## Main API routes

| Method | Route | Purpose |
|---|---|---|
| GET | `/api/process` | List active processes |
| GET | `/api/process/:processCode` | Get today's process steps |
| GET | `/api/process/:processCode/steps/:stepId` | Get one fresh step |
| PATCH | `/api/process/:processCode/steps/:stepId/status` | Queue a step update; normally returns `202 Accepted` |
| GET | `/api/process/status-updates/:jobId` | Read queued update status |
| POST | `/api/process/:processCode/init` | Initialize one process |
| POST | `/api/process/:processCode/archive` | Archive one process date |
| GET | `/api/process/:processCode/audit` | Process audit log |
| POST | `/scheduler/sync-buddy` | Buddy mirror sync |
| POST | `/scheduler/init-all` | Initialize all processes |
| POST | `/scheduler/archive-all` | Archive all processes |

## Status-update performance

The browser no longer waits for the BigQuery script to finish. The normal flow is:

```text
PATCH status -> Redis Stream -> 202 Accepted -> worker -> BigQuery commit -> UI polling confirmation
```

The PATCH response should normally return in milliseconds. The UI shows `Saving…` until the Redis job reports `COMPLETED`. `sp_mark_step_status` remains the authoritative validation and write layer and still performs the tracker update plus audit insert atomically.

The backend logs both queue and BigQuery timings:

```text
[status-queue] completed job=<id> <process>/<step> attempt=1 duration=<ms>
[process] status-update <process>/<step> bigquery=<ms> total=<ms>
```

When Redis is unavailable, the API deliberately falls back to the original synchronous BigQuery update so functionality is preserved, although that fallback can take several seconds.

Queue configuration is documented in `docs/ASYNC_STATUS_QUEUE.md`.

## Files not included in Git or ZIP

These must be supplied locally:

- `.env`
- `backend/.env`
- `node_modules`
- `dist`
- service-account files

Use the included `.env.example` files as templates.

## Remaining phases

- Google OAuth and `@geplcapital.com` token validation
- Dependency locking engine
- Google Chat notifications
- Cloud Run + Memorystore
- Cloud Scheduler job creation
- Production domain deployment
- Remaining FMS process onboarding
