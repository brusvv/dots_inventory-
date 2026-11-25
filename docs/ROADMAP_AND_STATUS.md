# Roadmap and status — Dots Inventory v3 RC8

Дата актуализации: 25.11.2026. Старые блоки UX ниже сохраняют исторические результаты на момент соответствующего патча; актуальные суммарные результаты приведены в последнем разделе. Статусы ниже отражают фактическое содержимое предоставленного `40.rar` и runtime-сведения пользователя в текущем чате.

## Статусы Supply Workspace

| Направление | Состояние | Следующий критерий приёмки |
|---|---|---|
| Новая поставка / черновик | Код есть; ранняя acceptance ранее выполнялась | Пройти новый цикл после финального накопительного комплекта |
| Внести старую поставку | Код в `34_DI3_HistoricalSupply.gs`; пользователь сообщил, что одна поставка внесена и статус стал «Получена» | После ввода всех исторических поставок и продаж выполнить полную stock/FIFO/finance сверку |
| Полное редактирование Phase A/B | Код в `36_DI3_SupplyFullEdit.gs`, операция `SUPPLY_DOCUMENT_EDIT` в OperationExecutor | Подтвердить id/created_at, operation COMMITTED, before/after payload, отсутствие stock writes |
| Исправление G5 на `26JY021` | Визуально сохранено пользователем как 05.07.2026; статус остался «Отправлена» | Проверить backend evidence и unchanged stock/FIFO |
| Изменение G6 на отправленной поставке | Поддерживается кодом как изменение даты ожидания; целевой статус должен стать «Ожидает получения» | Runtime-тест на отдельной тестовой поставке, без G7 |
| G7 у ещё не полученной поставки | Не проводится через `SUPPLY_DOCUMENT_EDIT`; требуется обычный next-stage/receipt workflow | Отдельный runtime тест фактической приёмки |
| Полная корректировка полученной поставки | Не реализована; `SUPPLY_CORRECTION` отсутствует в operation registry | Phase C: immutable correction + candidate FIFO replay + COGS/history rebuild |
| Меню Supply Workspace | UX-01–UX-03 implemented in local patch: dirty-form fingerprint/confirm, safe B2 switch, separate read-only FIFO check and confirmed rebuild | Runtime UX acceptance in restored test copy; do not treat local tests as Sheets evidence |

## UX patch status — 25.11.2026

- **UX-01:** `Новая поставка` checks a SHA-256 fingerprint of editable form inputs and prompts before clearing a dirty form.
- **UX-02:** B2 switching is guarded. Dirty form state is retained; the attempted selector is staged in hidden N9 and restored to the previous value in B2. The user confirms via `Поставки → Выбор и просмотр → Загрузить выбранную поставку…`. FULL_EDIT blocks B2 switching.
- **UX-03:** `Проверить целостность FIFO (без изменений)` is a read-only menu path. `Перестроить FIFO полностью…` is a separate mutating command with an explicit confirmation before lock/backup/rebuild.
- Local checks: all 47 `.gs` syntax checks PASS; Supply Workspace UX tests 9/9 PASS; warehouse dashboard tests 5/5 PASS; TypeScript AST audit 532 top-level functions, 86 top-level variable declarations, no parse errors or duplicate names.
- Not runtime-accepted: dialogs, installable onEdit behavior, Apps Script hashing/Spreadsheet APIs and actual FIFO read-only behavior must be verified on a restored test spreadsheet. The blank Warehouse Dashboard chart remains an open issue.

## UX patch — product/order workspaces and navigation

- **UX-04:** protect `Новый заказ` with a dirty-form fingerprint and confirmation; successful order creation resets the form without a duplicate prompt.
- **UX-05:** protect the product card from clearing/replacing unsaved fields; selector changes are staged and require an explicit menu confirmation before loading another product.
- **UX-06:** group System commands into settings, diagnostics, accounting period, operations/FIFO and backups; order transition labels show allowed source/target states.
- Local tests are source/Node checks only. Real trigger prompts and menu behavior still require a restored Google Sheets test copy.

## UX patch — product/order workspaces and navigation (25.11.2026)

- **UX-04:** `Новый заказ` fingerprints B3:B8 and A12:C31 (excluding derived G4:G11) and prompts before clearing unsaved parameters/lines. After successful order creation, the form is reset without asking again.
- **UX-05:** `Новый товар` prompts before clearing B6:B15. When a different product is selected while dirty, the attempted option is staged in DocumentProperties and the previous selector restored. The explicit menu action asks before loading the new record. The duplicate-identity path also uses this confirmation and must not silently replace entered fields.
- **UX-06:** System navigation is grouped by task; order transition labels name expected source/target states. Menu labels are descriptive only—the domain functions remain the actual status guards.
- Local validation: syntax **48 `.gs` PASS**, Supply UX **9/9**, Catalog/Order UX **12/12**, Warehouse Dashboard **5/5**, TypeScript AST **546 functions / 87 top-level vars / no duplicates or parse errors**, menu reference audit **68 actions / 0 missing handlers**.
- These checks are source/Node-only. Real onEdit trigger behavior, toasts, confirmation dialogs and menus must be accepted in a restored Google Sheets copy before deployment.
- **UX-07:** batch recovery of pending operations now shows a read-only preflight summary and requires YES before entering the mutation lock; it distinguishes eligible, waiting, unsupported and quarantined operations.
- **UX-08:** Money minor-unit/FIFO migration now requires YES before Dry Run, backup and rebuild; the dialog states that rollback is by verified backup, not automatic.
- **UX-09:** reopening the latest accounting period now requires a second YES after the user enters a reason; the dialog explains that PeriodGuard will stop blocking backdated operations for that period.
- **UX-10:** manual warehouse IN/OUT now displays a command summary (product, reason, date, quantity, cost/price and FIFO effect) and requires YES before `di3PostManualStockMovement()` registers an operation.
- Local validation after UX-07–UX-10: syntax **49 `.gs` PASS**, Supply UX **9/9**, Catalog/Order UX **12/12**, System Safety UX **11/11**, Warehouse Dashboard **5/5**, TypeScript AST **549 functions / 87 top-level vars / no duplicates or parse errors**, menu reference audit **68 actions / 0 missing handlers**.

## Warehouse Dashboard

В текущем источнике `19_DI3_WarehouseViews.gs` уже содержит:
- paired chart source N:O (product label and value together);
- filter to positive fully-valued stock;
- descending inventory-value sort;
- Top 20 cap;
- hidden source dimensions explicitly included using `SHOW_BOTH`;
- bar-builder `reverseCategories()` called before `addRange()`;
- `setNumHeaders(1)` (not the unsupported `useFirstRowAsHeaders()` method);
- protection against clearing M25+ dashboard table cells during setup.

`38_DI3_WarehouseDashboardTests.gs`: seven pure tests passed locally on the current patched snapshot.

**Open:** actual rendering/refresh in Google Sheets. The user confirmed the chart remains blank in the live test copy. The latest local patch adds:
- `average_known_unit_cost` (known inventory value / known units), fixing the missing H11 KPI value;
- chart grid-row retention based on computed chart height (addresses D-1 clipping risk);
- read-only `di3DiagnoseWarehouseDashboardChart()` / `di3LogWarehouseDashboardChartDiagnostics()` to inspect N1:O21, hidden state, chart ranges/count/type/anchor.

The actual empty-chart cause is still unknown. Run the read-only diagnostics on a restored copy and inspect N1:O21 before changing the chart API code again. At the initial Dashboard patch stage the suite was 7/7; after adding view-refresh and journal-warning tests it is now 9/9. Neither result tests actual Sheets rendering.

## Cross-project remaining work

### FIFO / stock / sales
- C-01: benchmark in real GAS at 500/1,000/2,000 movements; measure runtime, Sheets reads/writes, TextFinder, quotas.
- C-02: runtime acceptance for PeriodGuard, historical profit and `OrderCostSnapshots`.
- **F-01:** return FIFO lookup is fixed in source and locally regression-tested; runtime scenario (dispatch A → later unrelated FIFO run → return A) remains pending on a restored copy.\n- **F-10:** source now appends `LOCKED` / `REOPENED` events instead of overwriting `PeriodLocks`; current state is folded from the latest event per period. Three structural regression checks were added but not yet executed. Runtime close → reopen → re-close acceptance remains pending.
- C-03: implement partial returns; agree policy first. This is separate from the full-return F-01 defect.
- C-04/C-05: real Apps Script fault/recovery acceptance for OperationExecutor flows.
- C-06: test LockService with two independent execution sessions, including receipt/cancel/dispatch races.
- C-07: verify installed unified onEdit triggers and routing.
- C-08: read-only TextFinder probe (`sample_keys: 5` and `30`, 3–5 rounds), exact row-set and median latency.
- C-09: runtime/UX validation of next FIFO unit cost including multiple lots and UNKNOWN/FREE.

### Finance
- C-10: Apps Script V8 probe, backup, Money Core migration/rebuild on non-empty test copy, per-lot/per-order reconciliation.
- C-15: reconcile buyer-paid platform fee, seller revenue, discounts and profit on real test orders.
- C-16: Finance Dashboard runtime/visual acceptance with real control orders, FIFO snapshots, UNKNOWN COGS, filters/charts and period boundaries.

### Setup / UX
- C-11: verify Dry Run blocked preflight without mutations.
- C-12: SettingsRepository runtime acceptance and timezone switch.
- C-13: verify sheet tab order.
- C-14: delivery-method add/select/order flow.
- C-17 phase 2: charts, conditional formatting, filters, tab order, permission/protection review.

### Backup / schema
- BM-01: restore-as-new runtime acceptance with manifest, bound script, folder rebind, trigger repair and data reconciliation.
- BM-02: scalable backup catalog.
- BM-03: scheduled daily/weekly backup.
- BM-04: retention with Dry Run and protection of last valid backup.
- BM-05: periodic isolated restore test.
- BM-06: release acceptance and documentation.
- Selective export/import for documents and ledger is a separate future feature.
- Schema Versioning: runtime acceptance for baseline and v1→v2 on empty/non-empty copies, plus the new v2→v3 `commission_payer` migration on restored empty/non-empty copies. Reverse migrations absent; rollback through verified backup/restore.

## RC9 readiness gate

Do not call RC9 ready until the real Google Sheets end-to-end cycle is verified: supply → receipt → FIFO → order → dispatch → return → finance, with backup/restore, idempotent recovery and concurrency acceptance. Local Node tests are not a substitute for Google Apps Script runtime evidence.

## Latest local patch — commission payer and Dashboard diagnostics (25.11.2026)

- Fixed percent-rate parsing for both native percentage cells and literal-percent cells. The user's screenshot showed 300 ₽ goods × displayed 10% producing only 0.30 ₽; the old `/100` reader could double-divide a native percent value stored as 0.1.
- Reinterpreted order calculator B3 as **Комиссию оплачивает покупатель**. Checked: fee is added to buyer payment. Unchecked: fee is deducted from seller revenue and profit. The commission base remains gross goods before seller discount.
- Added `commission_payer` to `V3_Orders` and schema v3 migration `RC8_ORDER_COMMISSION_PAYER_V3` (v2→v3). Existing orders are backfilled to `BUYER`.
- Settlement and Finance Dashboard use the stored payer; commission remains separately reported.
- Added 13 Order Domain tests for commission payer/percentage handling, including 300 ₽ / 10% / 105 ₽ FIFO examples for both payer modes.
- Dashboard totals now calculate average known FIFO unit cost. Chart row retention is aligned to chart height. Added read-only chart diagnostics.
- Local validation after the commission/Dashboard patch: syntax 49/49; Order Domain 13/13; Supply UX 9/9; Catalog/Order UX 12/12; System Safety 11/11; Dashboard 7/7.
- User visually accepted UX-01–UX-06 except duplicate-product-identity test, which remains untested.
- No live schema migration, order creation, dispatch, stock mutation or chart runtime test was performed.


## Latest local patch — F-01 order return FIFO lookup (25.11.2026)

- Fixed `di3BuildOrderReturnPayload_()`: the active `StockAllocations` projection can contain valid active rows from several FIFO runs, so return lookup must not filter by the globally latest `FifoAllocationRuns.run_id`.
- Return allocations are now selected by the original order-line `dispatch_movement_id` and `allocation_type=CONSUME`. Per-line allocated-quantity equality remains fail-closed and is checked before registering the return operation.
- FIFO run IDs remain provenance only (`source_fifo_run_ids`; `source_fifo_run_id` is set only when one source run is present). Source lot IDs, pack variants and exact allocated cost are retained for new return lots.
- Added a full return-payload regression fixture: dispatch A's allocations carry `RUN-OLD-A`; an unrelated movement exists in `RUN-LATEST`; the return payload must still build from A's original lots. Added a partial-allocation rejection test.
- Local validation: syntax 49/49; Order Domain 16/16; Supply UX 9/9; Catalog/Order UX 12/12; System Safety UX 11/11; Dashboard 7/7; TypeScript AST 556 functions / 87 top-level vars / no parse errors or duplicate declarations.
- **Runtime acceptance pending:** on a disposable restored copy, dispatch order A, create a later FIFO run through a separate stock operation, then return A and reconcile return lots, costs and stock valuation. No live order or stock movement was used for this patch.


## Source-only hardening after F-01 — 25.11.2026

The following issues have source changes and local regression coverage. They are **code-hardened, not runtime-accepted** until the consolidated Google Sheets acceptance on a restored test copy.

| Audit ID | Source change | Remaining limitation / acceptance |
|---|---|---|
| **F-03** | Historical-supply confirmation dialogs moved outside the global ScriptLock. A short preflight lock builds a state snapshot; after YES, the code reacquires the lock and rechecks supply ID/status, prepared-operation identity/hash, and a fingerprint of the current form before writes. | Real dialog/LockService interleaving still needs two-session runtime acceptance. |
| **F-04** | Operation payload serialization now fails closed above 45,000 characters before `OperationPayloads`/`Operations` writes. | This prevents oversized-cell writes but does not implement chunked payload storage or compact audit retention. |
| **F-05** | Full-supply-edit prepared-operation retries compare the current editable-form fingerprint with the verified immutable payload fingerprint. Legacy prepared operations without a fingerprint fail closed for manual inspection. | Runtime retry/recovery and legacy-operation behavior still require a disposable copy. |
| **F-09** | Warehouse-view refresh isolates failures per view. Stock journal can display already-recorded movements while showing a visible warning when operations are pending. | Repeated full-table reads/performance and reconciliation-safe semantics remain open; never use a journal with pending operations for reconciliation/period close. |
| **F-11** | Supply-number preview uses a read-only peek; sequence reservation remains in the save path. | Confirm preview does not consume a number in a real Apps Script execution. |
| **F-13** | Backup code calls `SpreadsheetApp.flush()` before reading the snapshot and before `makeCopy()`. | Actual Drive consistency, time/quota and lock duration remain unverified. |
| **F-15** | Historical-supply mode and full-edit mode now reject enabling the other mode while one is active. | Verify hidden markers and both UI entry paths at runtime. |
| **F-16** | Finance Dashboard resolves table columns by schema field names from `DI3_TABLE_SCHEMAS`, not numeric indexes. Added four schema-mapping regression tests. | Run against the installed schema v3 workbook and verify finance totals. |
| **F-18** | Minor-unit conversion normalizes floating-point representation and applies symmetric half-up rounding, with safe-integer validation. | Real Sheets locale/currency inputs remain part of Money Core runtime acceptance. |

### Latest local verification

- Syntax: **50/50 `.gs` files PASS** (43 app modules + 7 runtime probes).
- Local Node regression suites: **70/70 PASS** — Order Domain 17/17; Supply UX 15/15; Catalog/Order UX 12/12; System Safety UX 13/13; Warehouse Dashboard 9/9; Finance schema 4/4.
- TypeScript AST: **570 functions / 88 top-level variables**, zero parse errors and duplicate declarations.
- Menu audit: **68 actions / 0 missing handlers**.
- No Google Sheets workbook, live stock, order, receipt, dispatch, return, backup, restore, schema migration or FIFO rebuild was executed.

### Still open or only partially mitigated

- **F-01:** code-fixed and locally tested; end-to-end return after a newer unrelated FIFO run still needs runtime acceptance.
- **F-02:** historical sales/business date not implemented; needs policy and a future schema migration.
- **F-04:** payload-size guard only; chunking/compaction remains a future design task.
- **F-06/F-07:** FIFO allocation archival and stable cursors remain open; require a migration/replay design.
- **F-09:** per-view isolation and journal warning are added, but O(N) read cost and scoped refresh remain open.
- **F-10:** append-only reopen/close audit is still needed.
- **F-14:** true multi-session ScriptLock contention/recovery is not proven by local tests.
- **F-17:** delivery-method catalogue needs the user's actual options; none are invented.
- **F-20:** reliable actor attribution still needs an approved identity model.
- The Warehouse Dashboard chart remains blank in the user's Sheets copy. The next step is to run the existing read-only chart diagnostics on the restored test copy and inspect N1:O21 plus the chart's actual source range.



## F-10 source patch — append-only period audit (25.11.2026)

- `di3CloseAccountingPeriod()` and `di3ReopenAccountingPeriod()` now append events to `PeriodLocks`; neither updates an existing event row.
- `di3GetLatestPeriodEvents_()` folds the event log by physical row order. `di3GetLatestLockedPeriod_()` considers only the latest event for each period, so a later `REOPENED` event actually removes that period from the active lock set.
- Re-closing a reopened period appends a new `LOCKED` event. Period status returns one current snapshot per period, including the actor and reason fields.
- The existing 10-column schema is reused; no schema migration or workbook write was performed.
- Added three structural regression checks to `41_DI3_SystemSafetyUxTests.gs`.
- **Not yet verified:** the tests were added through GitHub source editing and have not been executed here. Run syntax + all six local Node suites before relying on the patch. Then use a restored test workbook to verify close → reopen → re-close, one appended row per transition, immutable prior rows and correct PeriodGuard blocking.
- **Legacy limitation:** historical rows that were overwritten by earlier versions cannot be recovered; the append-only guarantee applies from this patch onward.
