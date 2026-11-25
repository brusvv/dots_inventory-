# F-10 — append-only accounting-period audit

Date: 25 November 2026

## Defect

The previous PeriodGuard implementation updated the existing `PeriodLocks` row when reopening a period. That erased the original close/reopen state transition from the table. Re-closing a previously reopened period also reused the same row. The result was a mutable snapshot, not an audit history.

## Source change

- `di3CloseAccountingPeriod()` appends a new `LOCKED` event.
- `di3ReopenAccountingPeriod()` appends a new `REOPENED` event with the actor, reason and original lock metadata.
- `di3GetLatestPeriodEvents_()` selects the last physical row for each period.
- `di3GetLatestLockedPeriod_()` evaluates only each period's latest event. A latest `REOPENED` event therefore removes that period from the active lock set.
- Re-closing a reopened period appends another `LOCKED` event.
- `di3GetPeriodGuardStatus()` exposes one current snapshot per period, including lock/reopen actor and reason.

The existing 10-column `PeriodLocks` schema is reused. No schema migration is required.

## Compatibility and limitations

Existing rows are interpreted as the first event for their period, so existing workbooks remain readable. However, if an earlier version already overwrote a close row during reopening, the lost historical event cannot be reconstructed. The append-only guarantee applies to transitions performed after this patch is installed.

## Regression coverage

Three structural checks were added to `41_DI3_SystemSafetyUxTests.gs`:

1. Close and reopen both append rows and do not call `setValues()` on existing rows.
2. The active lock state is derived from the latest event for each period.
3. The status report returns one latest event per period with actor and reason fields.

These tests were added through GitHub source editing and have **not yet been executed** in the current continuation. Run the complete syntax check and all six local Node suites before treating local validation as passed.

## Runtime acceptance

On a restored disposable workbook:

1. Close a fully completed month; confirm exactly one new `LOCKED` row.
2. Reopen that month with a reason; confirm exactly one new `REOPENED` row and that the original `LOCKED` row is unchanged.
3. Confirm PeriodGuard allows a backdated operation in the reopened period.
4. Re-close the same month; confirm one more `LOCKED` row is appended.
5. Confirm PeriodGuard blocks operations through that month again.
6. Inspect the full `PeriodLocks` history and verify every prior row remains unchanged.

Do not run this test on the production workbook. No workbook was modified by this source patch.
