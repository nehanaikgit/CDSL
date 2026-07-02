-- ============================================================
-- CDSL CURRENT-STATE VERIFICATION
-- Read-only. Run in BigQuery with processing location asia-south1.
-- ============================================================

-- 1. process_master must use the typed TIME column.
SELECT
  column_name,
  data_type,
  is_nullable
FROM `gepl-operations.CDSL_CONFIG.INFORMATION_SCHEMA.COLUMNS`
WHERE table_name = 'process_master'
  AND column_name IN ('planned_time', 'planned_time_value')
ORDER BY ordinal_position;

-- Expected:
-- planned_time_value | TIME
-- No planned_time row.

-- 2. trading_calendar must use trade_date DATE.
SELECT
  column_name,
  data_type,
  is_nullable
FROM `gepl-operations.CDSL_CONFIG.INFORMATION_SCHEMA.COLUMNS`
WHERE table_name = 'trading_calendar'
ORDER BY ordinal_position;

-- Expected:
-- trade_date DATE
-- day_name STRING
-- expiry flag columns
-- source_updated_at TIMESTAMP
-- synced_at TIMESTAMP
-- No dd_mm_yyyy_slash row.

-- 3. Calendar quality.
SELECT
  COUNT(*) AS total_rows,
  COUNT(DISTINCT trade_date) AS distinct_dates,
  COUNTIF(trade_date IS NULL) AS null_dates,
  MIN(trade_date) AS earliest_date,
  MAX(trade_date) AS latest_date,
  COUNTIF(trade_date = DATE '2026-02-01') AS special_sunday_rows
FROM `gepl-operations.CDSL_CONFIG.trading_calendar`;

-- Expected at migration completion:
-- 6755 total_rows
-- 6755 distinct_dates
-- 0 null_dates
-- 1 special_sunday_rows

-- 4. Working-day functions.
SELECT
  test_date,
  `gepl-operations.CDSL_CONFIG.fx_is_working_day`(test_date)
    AS fx_result,
  `gepl-operations.CDSL_CONFIG.is_working_day`(test_date)
    AS wrapper_result
FROM UNNEST([
  DATE '2024-03-31',
  DATE '2024-04-01',
  DATE '2026-02-01'
]) AS test_date
ORDER BY test_date;

-- Expected:
-- 2024-03-31 false false
-- 2024-04-01 true  true
-- 2026-02-01 true  true

-- 5. No routine/view should still reference legacy calendar strings.
WITH routines AS (
  SELECT
    'CDSL_CONFIG' AS dataset_name,
    'ROUTINE' AS object_type,
    routine_name AS object_name,
    routine_definition AS object_definition
  FROM `gepl-operations.CDSL_CONFIG.INFORMATION_SCHEMA.ROUTINES`

  UNION ALL

  SELECT
    'CDSL_RUNTIME',
    'ROUTINE',
    routine_name,
    routine_definition
  FROM `gepl-operations.CDSL_RUNTIME.INFORMATION_SCHEMA.ROUTINES`

  UNION ALL

  SELECT
    'CDSL_ARCHIVE',
    'ROUTINE',
    routine_name,
    routine_definition
  FROM `gepl-operations.CDSL_ARCHIVE.INFORMATION_SCHEMA.ROUTINES`
),
views AS (
  SELECT
    'CDSL_CONFIG' AS dataset_name,
    'VIEW' AS object_type,
    table_name AS object_name,
    view_definition AS object_definition
  FROM `gepl-operations.CDSL_CONFIG.INFORMATION_SCHEMA.VIEWS`

  UNION ALL

  SELECT
    'CDSL_RUNTIME',
    'VIEW',
    table_name,
    view_definition
  FROM `gepl-operations.CDSL_RUNTIME.INFORMATION_SCHEMA.VIEWS`

  UNION ALL

  SELECT
    'CDSL_REPORTING',
    'VIEW',
    table_name,
    view_definition
  FROM `gepl-operations.CDSL_REPORTING.INFORMATION_SCHEMA.VIEWS`
)
SELECT
  dataset_name,
  object_type,
  object_name
FROM (
  SELECT * FROM routines
  UNION ALL
  SELECT * FROM views
)
WHERE REGEXP_CONTAINS(
  LOWER(IFNULL(object_definition, '')),
  r'dd_mm_yyyy_slash|process_master\.planned_time\b'
)
ORDER BY dataset_name, object_type, object_name;

-- Expected: no rows.
