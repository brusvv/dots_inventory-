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

Do not run Clean Start, imports, schema migration, restore, or any stock mutation just because code was replaced. The current schema source declares version 3. The new v2→v3 migration appends `commission_payer` to `V3_Orders`; use Dry Run and a verified backup before setup applies it. Existing orders are defaulted to `BUYER` to preserve previous settlement semantics.

## Apps Script unit-test entry points in this source

- `di3RunCoreFoundationUnitTests()`
- `di3RunStockCoreUnitTests()`
- `di3RunCatalogAndSupplyUnitTests()`
- `di3RunSupplyReceivingUnitTests()`
- `di3RunOrderDomainUnitTests()`
- `di3RunHistoricalSupplyUnitTests()`
- `di3RunSupplyFullEditUnitTests()`
- `di3RunWarehouseDashboardUnitTests()`

These are Apps Script code functions and some depend on the Sheets runtime / project mocks. The local Node helpers execute only the explicitly listed suites: Warehouse Dashboard (7 tests), Order Domain (16 tests), Supply Workspace UX (9 tests), Catalog/Order UX (12 tests) and System Safety UX (11 tests). Do not infer that all Apps Script unit-test entry points were executed locally.

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


## Local UX patch UX-10 (25.11.2026)

Replace these files on a restored/test copy after a fresh backup:

- `08_DI3_WarehouseManager.gs`
- `41_DI3_SystemSafetyUxTests.gs`

The local runner `tools/run_system_safety_ux_tests.js` also changed to load the warehouse manager module. No schema migration is required.

Runtime acceptance (restored test copy only):

1. Fill the Warehouse Manager form with a test inbound or outbound movement, open `Склад → Провести приход / расход`, and choose **No**. Confirm the form values remain, no operation appears in `Operations`, `StockLedger`, `StockMovementDetails` or `StockLots`, and FIFO projections are unchanged.
2. Review the dialog's direction, product, reason, date, quantity and cost/price fields. For inbound movements confirm the text describes creation of a FIFO lot; for outbound movements confirm it describes FIFO expense allocation. For `OFFLINE_SALE`, confirm unit sale price and total revenue are shown.
3. Do not choose **Yes** solely for UX acceptance. A confirmed movement has real stock effects and must be a separately approved test operation on a disposable copy.

Local check: `node tools/run_system_safety_ux_tests.js` (11/11 PASS). This does not emulate Apps Script UI or prove the No path in a real workbook.

## Commission payer / schema v3 patch (25.11.2026)

Changed modules:
- `00_DI3_SchemaRegistry.gs`
- `07_DI3_StockCore.gs`
- `15_DI3_OrderDomain.gs`
- `16_DI3_OrderWorkflow.gs`
- `17_DI3_OrderWorkspace.gs`
- `18_DI3_OrderTests.gs`
- `19_DI3_WarehouseViews.gs`
- `28_DI3_InstallationPreflight.gs`
- `31_DI3_FinanceDashboard.gs`
- `33_DI3_SchemaVersioning.gs`
- add local runner `tools/run_order_domain_tests.js`

Before replacing modules:
1. Use a restored test workbook and take a fresh verified backup.
2. Run the existing installation Dry Run. It should report the additive `commission_payer` column in `V3_Orders` when the workbook is at schema v2.
3. Run the normal setup/migration only after reviewing the Dry Run and backup. The migration appends `commission_payer` at column AC and backfills existing orders as `BUYER`; it must not alter their existing quote/settlement amounts.
4. Confirm `_AppMeta.schema_version` advances from 2 to 3 and `SchemaMigrations` records `RC8_ORDER_COMMISSION_PAYER_V3` as COMPLETED.
5. Verify the calculator checkbox B3: checked = buyer pays the platform fee; unchecked = seller pays it. Commission rate is calculated on gross goods before seller discount, as before.

Expected 300 ₽ / 10% / 105 ₽ FIFO-cost preview:
- B3 checked: fee 30 ₽, buyer pays 330 ₽, seller revenue 300 ₽, estimated profit 195 ₽.
- B3 unchecked: fee 30 ₽, buyer pays 300 ₽, seller revenue 270 ₽, estimated profit 165 ₽.

Test both native Sheets percentage formatting (e.g. stored value 0.1 with `0.00%`) and literal-percent formatting (e.g. stored value 10 with `0.00"%"`). The parser supports both. Do not create or dispatch an order solely for this preview test.

## Warehouse Dashboard follow-up

`di3LogWarehouseDashboardChartDiagnostics()` is a read-only runtime function. Run it from the Apps Script editor on the restored test copy and provide its Execution log. It reports helper range N1:O21 values, hidden columns, chart count, source ranges, chart type and anchor. It does not mutate business tables. Also verify H11 average-known FIFO cost; 2,940 ₽ / 120 known units should display 24.50 ₽.

The chart itself remains unaccepted until the actual Google Sheets rendering is visible. Local chart-data tests are not a substitute.

## F-01 — order return after a later FIFO run

The local fix in `16_DI3_OrderWorkflow.gs` now selects active `CONSUME` allocations by the original order-line `dispatch_movement_id`. It does not require the allocation row's `allocation_run_id` to equal the globally latest committed FIFO run. The source run IDs are retained in the return operation payload as provenance only. The exact allocated quantity is still validated per order line before the return operation is registered.

Runtime acceptance (restored disposable copy only):

1. Dispatch a disposable order A and record its original `dispatch_movement_id` values and matching `StockAllocations` rows.
2. Perform a separate stock operation that creates a newer committed FIFO run, preferably for a different product. Confirm A's active allocation rows still carry their older `allocation_run_id`.
3. Move A through `Возвращается` and accept its return.
4. Verify the return operation is `COMMITTED`, returned quantities exactly match the source dispatch allocations, and new return lots preserve source-lot pack variant and exact cost. Reconcile stock quantity and FIFO valuation for the affected product.
5. On a separate disposable test, simulate an allocation quantity mismatch and confirm the return is rejected before any return ledger movement or lot is appended.

Do not use a live order or production stock. The Node test proves that payload construction selects the old-run allocation and preserves the quantity guard, but does not emulate the full Apps Script operation executor or workbook writes. F-01 is therefore code-fixed / locally tested, but not runtime-accepted until this scenario passes in Google Sheets.


## Consolidated source-only hardening after F-01 (25.11.2026)

The current full source tree is cumulative. For a restored/test copy with the previous UX-01–UX-10 and commission-payer patch already installed, replace these changed modules and add the new test module as part of the later consolidated deployment—not as a live partial deployment:

- Replace: `19_DI3_WarehouseViews.gs`, `27_DI3_OperationExecutor.gs`, `30_DI3_MoneyCore.gs`, `31_DI3_FinanceDashboard.gs`, `32_DI3_BackupRestore.gs`, `34_DI3_HistoricalSupply.gs`, `36_DI3_SupplyFullEdit.gs`, `38_DI3_WarehouseDashboardTests.gs`, `39_DI3_SupplyWorkspaceUxTests.gs`.
- Add: `42_DI3_FinanceSchemaTests.gs`.
- Repository-only tooling: `tools/run_finance_schema_tests.js`; updated `tools/run_supply_workspace_ux_tests.js`.

No new schema migration is introduced by this source-only hardening batch. The existing v2→v3 `commission_payer` migration remains separate and must still use Dry Run + verified backup before execution.

### Consolidated runtime acceptance scenarios

Keep these tests for the single later acceptance session on a restored disposable copy:

1. **F-03 historical receipt / lock:** start historical supply receipt and inspect the confirmation. Use a second independent Apps Script execution to change the tested supply/form state before confirmation; after YES the revalidation must detect the changed fingerprint/state and stop before writes. Also verify the dialog is not displayed while the global ScriptLock is held. Use separate disposable test documents and do not run actual receipt on the business workbook.
2. **F-04 payload ceiling:** test a payload below the 45,000-character limit and a payload above it. The oversized payload must fail before any `OperationPayloads` or `Operations` row is written. Multi-part payload storage is not implemented.
3. **F-05 full-edit retry:** prepare a disposable full-edit operation, then alter an editable field before retry. A matching fingerprint may resume; a changed form or legacy prepared payload without fingerprint must fail closed for manual inspection.
4. **F-09 view refresh / stock journal:** inject a failure into one view refresh and verify remaining views still refresh. Create a pending operation in a disposable copy and verify the stock journal displays already-recorded movements with a prominent warning; do not use that journal for reconciliation while pending operations exist.
5. **F-11 supply number:** preview the next number repeatedly and verify the counter does not advance; save a disposable draft and verify reservation occurs only in the save path.
6. **F-13 backup:** create a test backup and verify `flush()` precedes sheet snapshot and Drive copy; compare key tables between source and backup. Record runtime, quota and lock duration.
7. **F-15 modes:** verify historical-supply mode blocks FULL_EDIT activation and FULL_EDIT blocks historical-supply mode activation. No form context may be silently overwritten.
8. **F-16 Finance schema:** on the migrated schema-v3 test copy, compare Finance Dashboard totals to source orders/items/snapshots/supplies; confirm that column positions do not affect the result.
9. **F-18 rounding:** test values including 10.075, 1.005, 1234.565 and negative half values through calculator, order save/settlement and finance reporting. Expected minor units follow symmetric half-up rounding.
10. **F-01 return:** dispatch order A, perform another stock operation creating a newer FIFO run, then accept A's return; verify source movement, quantities, lots and exact costs.
11. **Warehouse Dashboard:** run `di3LogWarehouseDashboardChartDiagnostics()` and capture N1:O21, hidden states, actual chart source ranges/type/count/anchor, plus screenshot. The chart is still visually blank and remains unaccepted.

### Current source-only test commands and evidence

```bash
bash tools/check_syntax.sh
node tools/run_order_domain_tests.js
node tools/run_supply_workspace_ux_tests.js
node tools/run_system_safety_ux_tests.js
node tools/run_catalog_order_ux_tests.js
node tools/run_warehouse_dashboard_tests.js
node tools/run_finance_schema_tests.js
```

Latest local results: syntax 50/50; Order Domain 17/17; Supply UX 15/15; System Safety UX 13/13; Catalog/Order UX 12/12; Warehouse Dashboard 9/9; Finance schema 4/4 (70/70 Node checks). TypeScript AST: 570 functions / 88 top-level variables, no parse errors or duplicate declarations. Menu reference audit: 68 actions / 0 missing handlers. These are local-only results and do not replace any scenario above.
