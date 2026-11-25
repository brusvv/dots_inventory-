# Source-only hardening after F-01 — 25.11.2026

This cumulative patch closes or partially mitigates audit findings that can be addressed without a live workbook, schema migration or business operation. The source is locally tested only.

## Changes

### F-03 — historical supply confirmation outside ScriptLock

The historical receipt flow now performs a short locked preflight, releases the global lock before showing YES/NO confirmation, then reacquires the lock and rechecks the selected supply ID, current document state, prepared receipt operation identity/hash and a fingerprint of the current form. A changed state/form stops before the document/stock writes. The lock is not held while the user reads the modal. Actual two-session LockService behavior remains for runtime acceptance.

### F-04 — payload-size fail-closed guard (partial)

Operation payload serialization is validated before any `OperationPayloads`/`Operations` write. Payloads above 45,000 characters are rejected with a clear error. **This is not chunked storage**: large payloads must be redesigned/compacted separately; they are not silently truncated.

### F-05 — immutable full-edit retry fingerprint

Full supply edit payloads now include a request fingerprint over the current editable document fields and line items. A retry compares the current form against the verified immutable payload. Changed forms fail closed; old prepared operations without a fingerprint require manual inspection instead of replaying a possibly stale command.

### F-09 — independent warehouse view refresh and journal warning (partial)

Warehouse view refresh catches errors per view so one failed projection does not prevent the others from refreshing. When Operations contains pending work, the stock journal can display already-recorded movements with a prominent warning that the journal may be incomplete/inconsistent. The normal builder remains fail-closed by default. Do not use the journal for reconciliation or period close while pending operations exist. Repeated full-table reads/performance remain open.

### F-11 — supply-number preview does not reserve

Supply number generation is split into a read-only peek and a reserving function. Preview paths use the peek; the counter is advanced only in the save path.

### F-13 — flush before backup snapshot

`SpreadsheetApp.flush()` is called before the backup snapshot is read and before the Drive copy is created. This improves write ordering but does not prove Drive consistency, quota headroom or acceptable lock duration.

### F-15 — historical supply / FULL_EDIT mutual exclusion

Both activation paths now reject entry while the other mode's marker is active. Runtime acceptance must still check hidden context markers and trigger/UI transitions.

### F-16 — Finance Dashboard schema-name column mapping

Finance source readers now resolve columns from `DI3_TABLE_SCHEMAS` by field name rather than assuming numeric positions. Added `42_DI3_FinanceSchemaTests.gs` and `tools/run_finance_schema_tests.js` with four regression checks. Runtime totals still need comparison against a migrated schema-v3 workbook.

### F-18 — deterministic minor-unit rounding

Money conversion normalizes floating-point representation and applies symmetric half-up rounding, with safe-integer validation. Tests include 10.075→1008 minor units, 1.005→101, 1234.565→123457 and negative half values. Locale and actual Sheet input behavior remain runtime acceptance.

## Files changed

Source modules: `19_DI3_WarehouseViews.gs`, `27_DI3_OperationExecutor.gs`, `30_DI3_MoneyCore.gs`, `31_DI3_FinanceDashboard.gs`, `32_DI3_BackupRestore.gs`, `34_DI3_HistoricalSupply.gs`, `36_DI3_SupplyFullEdit.gs`, `38_DI3_WarehouseDashboardTests.gs`, `39_DI3_SupplyWorkspaceUxTests.gs`. Added `42_DI3_FinanceSchemaTests.gs`. Updated local runner `tools/run_supply_workspace_ux_tests.js`; added `tools/run_finance_schema_tests.js`. Documentation and reports updated in the full repository archive.

## Local verification

- Syntax: 50 `.gs` files PASS.
- Order Domain: 17/17.
- Supply UX: 15/15.
- System Safety UX: 13/13.
- Catalog/Order UX: 12/12.
- Warehouse Dashboard: 9/9.
- Finance schema: 4/4.
- Total local Node checks: 70/70.
- TypeScript AST: 570 top-level functions, 88 top-level variable declarations, zero parse errors and duplicate declarations.
- Menu audit: 68 actions, zero missing handler references.

## Not included / still open

No live Sheets action, LockService test, backup/restore, migration, receipt, order, dispatch, return, stock movement or FIFO rebuild was performed. F-02 historical sales, F-06 allocation archive, F-07 stable FIFO cursors, F-10 append-only period audit, F-14 true concurrency, F-17 delivery options and F-20 actor identity remain open. F-04 is only a fail-closed guard. F-09 still has performance work. The Warehouse Dashboard chart remains visibly blank and its actual rendering cause is unresolved.
