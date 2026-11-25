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


## Local UX patch UX-01–UX-03 (25.11.2026)

Replace these Apps Script modules on a restored/test copy after taking a fresh spreadsheet backup:

- `11_DI3_SupplyDomain.gs`
- `12_DI3_SupplyReceiving.gs`
- `22_DI3_MenuAndFilterUtils.gs`
- `24_DI3_IncrementalFifo.gs`
- `34_DI3_HistoricalSupply.gs`
- `36_DI3_SupplyFullEdit.gs`
- add `39_DI3_SupplyWorkspaceUxTests.gs`

No schema migration is required. The Supply form already has hidden column N; N8:N10 are used for a form-state hash and pending B2 selector context. Do not manually edit these cells. After replacing modules, reload the spreadsheet so menus refresh. The unified edit trigger should already route `di3SupplyFormOnEdit`; verify that its installed handler is `di3UnifiedOnEdit` before testing B2 behavior.

Runtime acceptance (on restored copy only):

1. Enter a supplier, note, discount or item in a new supply form, run `Новая поставка`, and choose **No**. Confirm every input remains unchanged. Choose **Yes** in a separate clean test and confirm reset occurs.
2. Load a draft, alter a business field or item, select another supply in B2. Confirm B2 reverts to the previous number, entered data remains, and a toast directs the user to `Загрузить выбранную поставку…`. Run that command, choose **No**, and verify no values are replaced. Repeat and choose **Yes**; verify the target number and its item rows load.
3. Repeat B2 switching while FULL_EDIT is active. Confirm it is blocked and the selector remains aligned with the loaded `supply_id`.
4. Run `Проверить целостность FIFO (без изменений)` and compare StockLedger, StockLots, StockAllocations, FifoProductState, app metadata and operation tables before/after. All must remain unchanged.
5. Run `Перестроить FIFO полностью…` and choose **No**. Confirm no backup/rebuild run is started. Do not choose **Yes** during UX acceptance; the mutating rebuild is outside the current test scope.

Local validation commands: `bash tools/check_syntax.sh`, `node tools/run_warehouse_dashboard_tests.js`, and `node tools/run_supply_workspace_ux_tests.js`. They do not prove Google Apps Script runtime behavior or Dashboard rendering. The warehouse Dashboard's blank chart remains open and must still be accepted separately.


## Local UX patch UX-04–UX-06 (25.11.2026)

Replace these modules on a restored/test copy after taking a fresh backup:

- `10_DI3_ProductCatalog.gs`
- `17_DI3_OrderWorkspace.gs`
- `22_DI3_MenuAndFilterUtils.gs`
- add `40_DI3_CatalogOrderUxTests.gs` for in-project regression tests (the Node runner stays in the repository tools folder and is not an Apps Script module).

No schema migration is part of this patch. The unified edit dispatcher already routes `di3ProductCatalogOnEdit`; retain the existing unified installable trigger and verify its handler is `di3UnifiedOnEdit`. Reload the spreadsheet after replacing modules to rebuild custom menus.

Runtime acceptance (restored test copy only):

1. Enter values in the product card, run `Новый товар`, select **No**, and verify B4 and B6:B15 remain unchanged. On a separate clean form choose **Yes** and verify the form clears.
2. Load a product, edit B6:B15, change B4 to another product. Confirm the previous B4 is restored and the form values remain. Run `Продукты → Загрузить выбранный товар…`; **No** must retain the current record and edits, **Yes** must load the requested product.
3. Enter a new product whose identity already exists. Confirm the duplicate-identity path asks before loading the existing product; **No** must not replace entered data. Do not save the product as part of this UX prompt test.
4. Enter parameters/items in the order calculator and run `Новый заказ`. **No** must retain all inputs; **Yes** must clear them. Do not call `Создать заказ` solely to test UX unless a disposable test order is explicitly authorized.
5. Check System submenu grouping and order transition labels. Invalid order states must still be rejected by their domain handlers; static menu text is not a state guard.

Local checks: `bash tools/check_syntax.sh`, `node tools/run_catalog_order_ux_tests.js`, `node tools/run_supply_workspace_ux_tests.js`, and `node tools/run_warehouse_dashboard_tests.js`. They do not emulate Apps Script dialogs, Spreadsheet services or live menu behavior.


### Order-transition confirmation UX

The current order workspace asks for confirmation before **each** selected-order status transition. The dialog names the order and target status, states whether the transition writes stock movements (dispatch / accepted return) or only changes the order status (complete / returning / cancel), and shows the effective date from column P or the current timestamp fallback. On **No**, the domain transition is not called. Validate the dialog's No path on a restored copy. Do not choose Yes for dispatch or accepted return unless you have a disposable order and explicitly authorized stock effects.


## Local UX patch UX-07–UX-09 (25.11.2026)

Replace these modules on a restored/test copy after a fresh backup:

- `12_DI3_SupplyReceiving.gs`
- `23_DI3_PeriodGuard.gs`
- `30_DI3_MoneyCore.gs`
- add `41_DI3_SystemSafetyUxTests.gs`

The Node runner `tools/run_system_safety_ux_tests.js` is repository tooling, not an Apps Script module. No schema migration is part of installing this UI-only patch. Reload the spreadsheet so its menus are refreshed.

Runtime acceptance (restored test copy only):

1. Open `Система → Операции и FIFO → Восстановить незавершённые операции…`. Inspect the read-only summary and choose **No**. Confirm no recovery attempt was started and no operation, stock movement, supply or order changed. Do not choose **Yes** if the copy contains pending business operations unless that recovery is separately intended and approved.
2. Open `Пересчитать FIFO в копейках…` and choose **No**. Confirm the command exits before creating its migration backup, changing money migration metadata/schema, or rebuilding FIFO. Do not choose **Yes** solely for a UX test.
3. On a restored copy that has a deliberately closed test period, run `Открыть последний закрытый месяц…`, enter a reason, then choose **No** in the second confirmation. Confirm the `PeriodLocks` row remains `LOCKED` and PeriodGuard still blocks dates within that closed period. Do not choose **Yes** solely for a UX test.
4. For order transitions, keep the prior UX-04–UX-06 procedure: test the **No** path for each status action. Do not confirm dispatch or accepted return unless stock effects are explicitly intended.

Local validation: `bash tools/check_syntax.sh`, `node tools/run_system_safety_ux_tests.js`, and the three existing regression runners. These checks inspect code and pure logic only; they do not prove that real Apps Script dialogs, triggers or workbook data behave as expected.
