# Installation and runtime acceptance notes

## Important

This repository snapshot is a source export, not a fully bound clasp project. The original RAR did not include `appsscript.json` or `.clasp.json`. Do not invent a Script ID or deploy target.

## Deploying source modules to an existing test project

1. Create/verify a restored test copy of the Google Sheets workbook.
2. Create a fresh backup of that test workbook.
3. Open the Apps Script project bound to that copy.
4. Replace/create `.gs` files using the exact names under `src/apps_script/`.
5. Do not delete a module merely because the numbering has a gap (`06` is not present in this source snapshot).
6. Preserve the actual project `appsscript.json`; confirm its `timeZone` equals `Europe/Helsinki`, matching `00_DI3_AppConfig.gs`.
7. Save and reload the spreadsheet.
8. Run the applicable Apps Script unit test functions listed in README / context.
9. Run runtime acceptance only on the test copy and record the complete Execution log JSON.

Do not run Clean Start, imports, schema migration, restore, or any stock mutation just because code was replaced. The schema source declares version 2; use its existing Dry Run/backup requirements if a migration is actually indicated.

## Apps Script unit-test entry points in this source

- `di3RunCoreFoundationUnitTests()`
- `di3RunStockCoreUnitTests()`
- `di3RunCatalogAndSupplyUnitTests()`
- `di3RunSupplyReceivingUnitTests()`
- `di3RunOrderDomainUnitTests()`
- `di3RunHistoricalSupplyUnitTests()`
- `di3RunSupplyFullEditUnitTests()`
- `di3RunWarehouseDashboardUnitTests()`

These are Apps Script code functions and some depend on the Sheets runtime / project mocks. The local helper in this repository only executes the five pure warehouse chart tests. Do not infer that all unit-test entry points were executed locally.

## Probe safety

See `docs/RUNTIME_PROBES.md`. Two probes are explicitly mutating and one holds ScriptLock for a controlled contention test. Never run them against the business workbook.
