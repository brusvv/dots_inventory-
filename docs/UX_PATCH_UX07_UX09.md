# UX patch UX-07–UX-09 — confirmation for consequential System actions

**Date:** 25.11.2026  
**Base:** full RC8 working tree after UX-01–UX-06.

## UX-07 — batch recovery confirmation

`di3RecoverAllPendingOperations()` previously entered the shared mutation lock and attempted all registered recovery classes immediately from the System menu. It now first obtains the read-only `di3GetOperationRecoveryReport_()` summary and asks for YES/NO. The dialog presents eligible, waiting, unsupported and quarantined counts, plus the operation types eligible to resume. Only YES enters the recovery lock; the recovery routine then re-reads the live operation state under lock. Quarantined operations and operations without handlers are explicitly excluded.

## UX-08 — Money Core migration confirmation

`di3RunMoneyMinorUnitsMigration()` now asks for YES before Dry Run, verified workbook backup, schema update and complete FIFO allocation rebuild. The dialog explains the scope, that `StockLedger` is not rewritten, and that a failure does not automatically roll back the migration; recovery to the prior workbook state requires the verified backup. No migration or backup was executed during this patch.

## UX-09 — accounting-period reopen confirmation

`di3PromptReopenAccountingPeriod()` now requires the user to enter a reason and separately confirm YES. The dialog names the latest locked period and explains that reopening removes PeriodGuard's backdated-operation block for that period. Choosing NO returns `CANCELLED_BY_USER` before calling `di3ReopenAccountingPeriod()`.

## Files changed

- Modified: `12_DI3_SupplyReceiving.gs`, `23_DI3_PeriodGuard.gs`, `30_DI3_MoneyCore.gs`.
- Added Apps Script tests: `41_DI3_SystemSafetyUxTests.gs`.
- Added local test runner: `tools/run_system_safety_ux_tests.js`.
- Documentation and validation reports updated.

## Validation

- JavaScript syntax: 49/49 `.gs` files PASS.
- Supply Workspace UX: 9/9 PASS.
- Catalog/Order UX: 12/12 PASS.
- System Safety UX: 8/8 PASS.
- Warehouse Dashboard: 5/5 PASS.
- TypeScript AST: 548 top-level functions, 87 top-level variables, no parse errors or duplicate declarations.
- Menu audit: 68 menu actions, 0 missing handlers.

These are local syntax/source tests only. The actual dialog No/Yes paths must still be accepted on a restored Google Sheets test copy. No spreadsheet, business operation, recovery, migration, period close/reopen or FIFO rebuild was run.
