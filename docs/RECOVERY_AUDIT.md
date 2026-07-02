# Recovery Audit — 30 June 2026

This repository was checked against the changes completed during the CDSL backend, BigQuery, cache, and UI work.

## Confirmed present

- `process_master.planned_time_value` used by backend reads
- No backend reference to `process_master.planned_time`
- `initProcessDay()` uses `fx_is_working_day(DATE)`
- No backend reference to `dd_mm_yyyy_slash`
- Redis fresh/stale step caching
- Buddy assignment fields joined into process-step reads
- Frontend read timeout: 15 seconds
- Frontend write timeout: 90 seconds
- No blocking `alert()` calls in `ProcessDashboard.jsx`
- Non-blocking app notifications
- Optimistic row status updates
- Slow-write single-step verification
- Stable `EMPTY_STEPS` fallback for React Compiler lint
- No Google Fonts network import
- Vite fixed to port 5173 with strict port handling

## Fixed during this audit

- Removed duplicate BigQuery status-validation query before `sp_mark_step_status`
- Added write timing logs and `write_time_ms`
- Replaced non-atomic buddy delete/streaming-insert flow with:
  - explicit US source query
  - source quality validation
  - atomic `asia-south1` transaction
  - full destination-column mapping
  - destination verification
  - Redis buddy and step-cache invalidation
- Added Redis pattern cache invalidation
- Set default fresh step-cache TTL to 30 seconds
- Removed React `StrictMode` to prevent duplicate development effects
- Made scheduler-secret protection mandatory
- Made scheduler dataset references environment-driven
- Corrected IST previous-day calculation
- Expanded backend syntax checks
- Corrected CI backend package-manager usage
- Added frontend and backend `.env.example`
- Updated README regions and current implementation status
- Added read-only BigQuery verification SQL

## Not stored inside this ZIP

BigQuery tables, procedures, functions, and views are deployed cloud resources. The ZIP contains application code and a read-only verification query, but it is not a full BigQuery export.

Keep the following BigQuery backup tables until UAT is complete:

- `CDSL_CONFIG.process_master_backup_before_time_migration`
- `CDSL_CONFIG.trading_calendar_backup_before_typed_migration`

## Required local checks after extraction

```powershell
# Frontend
npm install
npm run lint
npm run build

# Backend
cd backend
npm install
npm run check
```

Then copy local secret files from the previous project folder:

```text
.env
backend/.env
```


## Validation performed on the repaired copy

- Frontend `npm run lint`: passed with 0 errors and 0 warnings
- Frontend `npm run build`: passed
- Backend `npm run check`: passed for all backend JavaScript files

The BigQuery source and destination queries were not executed from the offline repair environment. Run the existing local API and scheduler smoke tests after copying `.env` files.
