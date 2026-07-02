# Asynchronous Status Update Queue

## Purpose

BigQuery stored procedures are reliable and atomic, but each script statement is a separate BigQuery child job. A status update can therefore take 5–20 seconds even when only a few kilobytes are processed.

The queue keeps BigQuery as the source of truth while removing that wait from the browser.

## Flow

1. `PATCH /api/process/:processCode/steps/:stepId/status`
2. Backend atomically creates a Redis job and step lock.
3. API returns `202 Accepted` with `job_id`.
4. Frontend shows `Saving…` and polls:
   `GET /api/process/status-updates/:jobId`
5. Redis Stream worker calls `sp_mark_step_status`.
6. BigQuery updates `process_tracker` and inserts `step_audit_log` in one transaction.
7. Worker marks the Redis job `COMPLETED` and clears the step cache.
8. Frontend fetches the fresh step and shows the committed result.

## Reliability

- Redis Stream consumer group supports multiple backend instances.
- A per-step Redis lock prevents duplicate clicks from creating overlapping writes.
- Failed jobs retry up to `STATUS_QUEUE_MAX_ATTEMPTS`.
- Abandoned pending Stream messages are reclaimed with `XAUTOCLAIM`.
- Job records are retained for `STATUS_QUEUE_JOB_TTL_SECONDS`.
- When Redis is unavailable, the API uses a synchronous BigQuery fallback.

## Environment variables

```env
STATUS_QUEUE_ENABLED=true
STATUS_QUEUE_JOB_TTL_SECONDS=86400
STATUS_QUEUE_LOCK_TTL_SECONDS=600
STATUS_QUEUE_MAX_ATTEMPTS=3
STATUS_QUEUE_CLAIM_IDLE_MS=120000
STATUS_QUEUE_BLOCK_MS=2000
```

## Expected API response

```json
{
  "success": true,
  "data": {
    "mode": "ASYNC",
    "accepted": true,
    "duplicate": false,
    "job_id": "uuid",
    "status": "QUEUED",
    "process_code": "ST_BOD_FMS",
    "step_id": "CDSL-ST08"
  }
}
```

## Job statuses

- `QUEUED`
- `RUNNING`
- `RETRYING`
- `COMPLETED`
- `FAILED`

## Local verification

1. Start Redis.
2. Start backend and confirm `/health` shows `status_queue.worker_started: true`.
3. Submit one pending step update.
4. Confirm PATCH returns `202` quickly.
5. Poll the returned `job_id`.
6. Confirm the job reaches `COMPLETED` and the step is committed in BigQuery.

A PowerShell smoke test is included:

```powershell
.\scripts\test-status-queue.ps1 -StepId CDSL-ST08
```

Use only a genuinely pending step ID.
