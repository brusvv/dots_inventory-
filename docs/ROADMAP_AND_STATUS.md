# Roadmap and status — Dots Inventory v3 RC8

Дата актуализации: 26.11.2026. Старые блоки UX ниже сохраняют исторические результаты на момент соответствующего патча; актуальные суммарные результаты приведены в последнем разделе. Статусы ниже отражают фактическое содержимое предоставленного `40.rar` и runtime-сведения пользователя в текущем чате.

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
- **F-01:** return FIFO lookup is fixed in source and locally regression-tested; runtime scenario (dispatch A → later unrelated FIFO run → return A) remains pending on a restored copy.
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
- C-11: source hardening now inventories workbook tabs and blocks populated unknown tabs; verify read-only Dry Run behavior on a new empty workbook and a workbook with an unrelated populated tab.
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
- **F-02:** source audit and v3→v4 design documented in `docs/F02_HISTORICAL_SALES_DESIGN.md`; implementation is not started. Exact dispatch date/time is now confirmed. UI decision: use separate adjacent calendar-date and mandatory 24-hour `HH:mm` controls so selecting a date cannot reset the time; completion uses the same pair, business date is date-only. Remaining F-02 implementation/design review is open.
- **F-04:** payload-size guard only; chunking/compaction remains a future design task.
- **F-06/F-07:** FIFO allocation archival and stable cursors remain open; require a migration/replay design.
- **F-09:** per-view isolation and journal warning are added, but O(N) read cost and scoped refresh remain open.
- **F-10:** PeriodLocks now appends `LOCKED` / `REOPENED` events; current state is derived from the latest event per period. Structural tests were added, but local execution and close → reopen → re-close runtime acceptance remain pending. Previously overwritten legacy history cannot be recovered.
- **F-14:** true multi-session ScriptLock contention/recovery is not proven by local tests.
- **F-17:** delivery-method catalogue needs the user's actual options; none are invented.
- **F-20:** source implementation includes centralized active-user capture, immutable operation-initiator attribution in order/supply/manual-stock audit rows, executor identity in attempt diagnostics, and checks for remaining administrative writers. The current System Safety runner exercises identity capture, initiator-vs-recovery attribution, and administrative writer paths; these assertions passed in GitHub Actions run 45728640689 (32/32 System Safety tests). Restored-workbook recovery acceptance remains pending. See docs/F20_OPERATION_IDENTITY_AUDIT.md.
- The Warehouse Dashboard chart remains blank in the user's Sheets copy. The next step is to run the existing read-only chart diagnostics on the restored test copy and inspect N1:O21 plus the chart's actual source range.



## F-19 — FIFO replay and recovery regression coverage — 25.11.2026

- Extended the pure Stock Core suite with incremental-vs-full replay equivalence, backdated-event replay selection, partially-applied OUT recovery routing, UNKNOWN/FREE cost semantics and same-timestamp deterministic ordering.
- Added tools/run_fifo_replay_tests.js to execute the Stock Core suite with the Incremental FIFO module loaded in a Node VM.
- Added docs/F19_FIFO_REPLAY_RECOVERY_TESTS.md with coverage, execution command and acceptance boundaries.
- **Tests added, not executed here:** the GitHub repository could not be checked out in this environment, so neither the new runner nor the repository syntax script was run. Run both locally before treating F-19 as source-verified.
- These are pure in-memory tests only. Google Sheets write interruption, OperationExecutor recovery, LockService concurrency and restored-workbook acceptance remain open.
- No Apps Script behavior, workbook data, stock ledger, FIFO projection or cursor was changed.


## F-06 / F-07 FIFO history and stable-cursor design — 25.11.2026

- Audited the current FIFO replacement and cursor paths in 24_DI3_IncrementalFifo.gs.
- Confirmed that StockAllocations is the active projection: product replay and full replay replace rows, while the current rollback helper only restores on caught write errors and cannot make multi-sheet writes atomic against process termination.
- Confirmed that fifo_ledger_cursor is currently a physical data-row count; incremental tail reads use cursor + 2, and FifoProductState stores/compares a physical last ledger row number.
- Documented a separate append-only allocation-history event log with replay-scoped PREPARED/COMMITTED events and deterministic recovery, keeping StockAllocations active-only.
- Documented migration to immutable ledger_sequence watermarks for global and per-product cursors, preserving FIFO business ordering by effective_at → recorded_at → movement_id.
- Added regression, recovery, migration and concurrency acceptance criteria.
- **Design only:** no Apps Script behavior, schema, workbook data, ledger, allocation projection or FIFO cursor was changed. Implementation is deferred until the sequence migration and archive recovery protocol can be tested together on a restored disposable copy.
- Design: docs/F06_F07_FIFO_HISTORY_AND_STABLE_CURSOR_DESIGN.md.


## F-10 source patch — append-only period audit (25.11.2026)

- `di3CloseAccountingPeriod()` and `di3ReopenAccountingPeriod()` now append events to `PeriodLocks`; neither updates an existing event row.
- `di3GetLatestPeriodEvents_()` folds the event log by physical row order. `di3GetLatestLockedPeriod_()` considers only the latest event for each period, so a later `REOPENED` event actually removes that period from the active lock set.
- Re-closing a reopened period appends a new `LOCKED` event. Period status returns one current snapshot per period, including the actor and reason fields.
- The existing 10-column schema is reused; no schema migration or workbook write was performed.
- Added three structural regression checks to `41_DI3_SystemSafetyUxTests.gs`.
- **Not yet verified:** the tests were added through GitHub source editing and have not been executed here. Run syntax + all six local Node suites before relying on the patch. Then use a restored test workbook to verify close → reopen → re-close, one appended row per transition, immutable prior rows and correct PeriodGuard blocking.
- **Legacy limitation:** historical rows that were overwritten by earlier versions cannot be recovered; the append-only guarantee applies from this patch onward.


## F-02 source audit and v4 design — 25.11.2026

- Audited the current order creation/dispatch/completion flow, v3 order schema, OperationExecutor, PeriodGuard and FIFO replay.
- Confirmed the existing FIFO engine orders stock events by `effective_at`, then `recorded_at`, and can trigger product replay for a backdated movement. Its replay rejects insufficient historical stock.
- Identified that the current order-draft validator uses today's available quantity and the dispatch validator requires `dispatched_at >= created_at`; both require a controlled historical-mode path.
- Proposed append-only `business_date` in `V3_Orders` (schema v3→v4), preserving `created_at` as actual record-entry time, with dispatch and completion timestamps remaining separate.
- Proposed retry-safe orchestration using the existing `ORDER_CREATE` and `ORDER_DISPATCH` operations plus the existing completion settlement transition; no second FIFO engine or new operation type unless tests prove the existing lifecycle cannot safely resume.
- **Not implemented:** no source behavior, schema, menu, tests or workbook data changed for F-02. The design is documented in `docs/F02_HISTORICAL_SALES_DESIGN.md`.
- **Decision confirmed 26.11.2026:** exact dispatch date/time is mandatory. Use separate date-picker and time controls (same form row), date `ДД.ММ.ГГГГ`, time `ЧЧ:ММ` in 24-hour format; do not rely on date-cell number formatting to preserve a time value. Completion uses the same pair; business date remains date-only. Missing time must block submission.


## F-20 — operation identity and actor attribution audit — 25.11.2026

- Audited operation registration, immutable payloads, attempt/recovery journal, manual quarantine release, domain actor fields and the unified edit trigger.
- Confirmed the intended distinction already exists in the schema: `Operations.actor` captures the registration actor; `OperationAttempts.actor` captures the actor for each execution attempt.
- Found inconsistent actor acquisition paths (shared helper/fallback, direct `Session.getActiveUser()`, and settings-specific helper). Some domain audit rows acquire actor inside the handler, so recovery can attribute the event to the recovery executor rather than the original initiator.
- Found that `di3GetOperationAttemptStats_` omits the persisted actor field from its returned attempt diagnostics.
- Documented identity limitations: active-user identity may be unavailable; effective-user identity must not be substituted as the initiating person; trigger context currently does not persist actor source or execution context.
- Proposed a normalized actor context with separate initiator, executor and domain-event semantics, plus pure tests and restored-workbook acceptance scenarios.
- **Design only:** no Apps Script behavior, schema, manifest, triggers, workbook data, operation payloads or business records changed. No tests were run for this audit.
- Design: `docs/F20_OPERATION_IDENTITY_AUDIT.md`.


## F-20 — diagnostic actor visibility — 25.11.2026

- `di3GetOperationAttemptStats_` now exposes the persisted `OperationAttempts.actor` on every attempt diagnostic object, including `last_attempt` and `manual_reviews`.
- The active retry-epoch projection now carries the actor through its internal row adapter instead of replacing the actor column with an empty string.
- Added a regression test with three distinct identities: original executor, manual reviewer and recovery executor. It checks that the active retry epoch reports the recovery executor while the manual review retains its own actor.
- No schema, spreadsheet, operation payload, business record, stock event, or runtime behavior was changed.
- **Test execution pending:** the existing `tools/run_system_safety_ux_tests.js` runner loads both the executor and the updated test module, but it was not executed in this environment. Run the runner and full syntax check before deployment.
- Remaining F-20 work: centralize actor-context capture, distinguish initiator from executor, and propagate the persisted initiator into domain audit writes without substituting the trigger/recovery executor.


## F-20 — centralized actor identity capture — 25.11.2026

- Added `di3CaptureActorContext_()` as the single source for active-user identity, with explicit `IDENTIFIED` / `UNAVAILABLE` status and `ACTIVE_USER` / `NONE` source.
- Preserved `di3GetActorEmail_()` as the backwards-compatible string API and routed the duplicated actor reads in supply, order, period, schema migration, operation executor and settings paths through it.
- Removed the direct Session fallback from operation registration/execution. No effective-user fallback is introduced.
- Added regression checks in `di3RunSystemSafetyUxUnitTests()` for identified, empty-email and unavailable Session contexts, as well as the absence of effective-user fallback.
- **Not verified:** test suite and syntax checks have not been run. No deployment or workbook changes were made.
- **Still open:** propagate the persisted initiating actor from `Operations.actor` into domain audit events during recovery; preserve the actual executor in `OperationAttempts.actor`; add identity-status persistence only after schema and runtime semantics are reviewed.


## F-20 — operation initiator attribution — 25.11.2026

- Added `di3GetOperationInitiatorActor_(operationId)`, which resolves the initiator from immutable `Operations.actor`. A blank/missing operation actor remains blank; it is not replaced by the recovery executor.
- Order creation/status history and order dispatch/return movement details now use the original initiator. Supply receipt status history uses the same rule.
- `OperationAttempts.actor` remains the actual executor for each attempt.
- Added regression coverage for initiator A vs recovery executor B, blank/missing actor cases, and the relevant order/supply audit writers.
- **Not verified:** source tests and syntax checks have not been run; restored-workbook recovery acceptance is pending. No workbook or deployment changes.

- Supply receipt `StockMovementDetails.actor` is now populated from the same immutable initiator record; its regression assertion was added.
- Manual warehouse stock movement details now also record the original operation initiator in `StockMovementDetails.actor`; regression coverage was extended.
- Extended `tools/run_system_safety_ux_tests.js` to load the actor helper, settings accessor, and manual-stock source modules referenced by the expanded suite. Runner execution remains pending.


## F-20 — remaining manual and administrative audit paths — 26.11.2026

- Confirmed supply draft history and settings/manual review use the centralized active-user accessor.
- Confirmed full supply-document edits persist `edited_by` in the immutable operation payload and reuse it for status history during recovery.
- Confirmed period close/reopen and schema migration records use the centralized accessor; period events remain append-only.
- Simplified redundant actor lookup wrappers.
- Extended the system-safety runner to load the supply-domain, schema-versioning and full-edit modules; added structural assertions for these paths.
- **Source verification passed:** GitHub Actions PR integration run `45728149345` (run #93) passed syntax checks for all 50 `.gs` files and the System Safety UX suite (31/31); all seven suites passed 129/129. This executes the F-20 actor-attribution and administrative-path structural assertions in the Node harness.
- Runtime acceptance remains open: restored-workbook checks are still required to verify Apps Script Sessions behavior, actual editor/recovery identities, and persisted audit rows in Google Sheets.

## C-01 / F-09 — performance audit plan — 26.11.2026

- Source inspection confirms that the common FIFO path reads only the appended StockLedger tail when its cursor is valid. The remaining scaling risk is repeated tagged lookups per affected product; a backdated event can trigger a full product replay.
- The stock journal currently reads full StockLedger, StockMovementDetails, StockLots, active allocations, products and product codes, then materializes and sorts the complete history.
- Added docs/C01_F09_PERFORMANCE_AUDIT_AND_BENCHMARK_PLAN.md with a disposable-workbook benchmark matrix for 500 / 1,000 / 2,000 movements, one vs. many affected products, product replay, full rebuild, journal and dashboard refresh.
- This is a source audit and measurement plan only. No performance claim, code optimization, Apps Script execution, or workbook change is made. Batch reads, journal windowing and selective view refresh should be implemented only after runtime measurements identify the bottleneck.
- C-01 remains open until real Apps Script timing and read/write counts are recorded. F-09 remains partially mitigated; per-view error isolation is in place, but full-history read cost and scoped refresh remain open.

## Clean-workbook architecture decision — 26.11.2026

- The owner confirmed that recreating the spreadsheet from zero is acceptable because little business data has been entered.
- Preferred release strategy: implement the final baseline schema before creating the production workbook, rather than carrying avoidable legacy schema/cursor migrations into the new workbook.
- F-06/F-07 design now records the clean-install path: ledger_sequence and append-only FIFO allocation history exist from the first stock movement; legacy backfill is retained only as a compatibility/test case.
- This does not authorize live workbook deletion or recreation. The production workbook should be created only after baseline schema, setup idempotency, backup/restore and end-to-end acceptance pass on a disposable empty workbook.

## F-07 — stable ledger sequence implementation specification — 26.11.2026

- Follow-up F-07 call-site audit checked the other supply/order/history/backup/schema modules: no additional direct StockLedger append path was found. Historical supply uses the existing supply-receipt operation path; full supply-document edit is explicitly document-only. The four writer paths in the F-07 spec remain the complete identified set.

- Verified current schema and cursor implementation: StockLedger has 12 columns without ledger_sequence; FIFO state v3 stores physical last_ledger_row_number; fifo_ledger_cursor is a physical data-row count; tail reading uses cursor + 2.
- Identified four domain writer paths to update: manual warehouse movement (07), supply receipt (12), order dispatch and return (16). These public paths are lock-wrapped; recovery must reuse sequence values persisted in immutable operation payloads.
- Added docs/F07_STABLE_LEDGER_SEQUENCE_IMPLEMENTATION_SPEC.md. The proposed design appends ledger_sequence to the clean baseline, changes global and per-product cursors to sequence watermarks, discovers tail rows by scanning the narrow sequence column (not physical row offsets), and preserves effective_at / recorded_at / movement_id as FIFO business ordering.
- Important schema-versioning finding: current versioning assumes baseline v1 plus sequential migrations through v3. A clean final baseline requires explicit clean-baseline adoption distinct from legacy upgrade paths; merely increasing DI3_SCHEMA_VERSION would break the existing initialization assumptions.
- No application code or workbook changed in this step. F-07 remains open pending implementation, source tests, and runtime acceptance on a disposable empty workbook.


## F-07 — source implementation pass — 26.11.2026

- Implemented the first source pass: 13-column StockLedger baseline with immutable ledger_sequence, FIFO state version 4, renamed product watermark, and sequence-based global cursor metadata.
- Added ScriptLock-only max+1 block allocation from a validated narrow-column scan. Movement ID, product ID and sequence columns are scanned; missing, invalid, non-positive and duplicate populated sequences fail closed. Gaps are accepted.
- Persisted assigned sequence values in immutable payloads for manual stock movement, supply receipt, order dispatch and order return. Each corresponding ledger row builder writes the sequence as the final field and validates it before append.
- Replaced physical-row tail offsets with sequence-based tail discovery and grouped full-row reads for only rows whose sequence exceeds the cursor. Physical row reorder no longer determines whether an event is skipped.
- Product watermarks store max processed sequence; business event watermark remains effective_at / recorded_at / movement_id. FIFO integrity diagnostics now compare sequence watermarks, not row counts.
- Added regression cases for reordered rows, sequence gaps, duplicate/missing values, ScriptLock enforcement and independent business/ingestion ordering. Updated the System Safety runner to load the sequence helper and added a GitHub Actions quality-gates workflow for syntax and all local test suites.
- **Source verification passed:** Latest GitHub Actions run `45721449653` completed successfully. Syntax passed for 50 `.gs` files; all seven local suites passed 118/118 (FIFO 41, Order Domain 17, Supply Workspace UX 15, Catalog/Order UX 12, System Safety UX 20, Warehouse Dashboard 9, Finance Schema 4). Added a fail-closed consistency check so a physical row sort between narrow-index scan and full-row fetch aborts tail processing rather than applying a mismatched event. No Apps Script runtime acceptance was performed.
- **Deployment warning:** the new StockLedger schema is 13 columns and is intentionally incompatible with the existing 12-column workbook. Do not deploy to the current workbook. Production remains blocked on clean-baseline adoption, complete review, executed test suites, backup/restore validation and disposable-workbook runtime acceptance.
- F-07 remains open; this is an implementation pass, not a release sign-off.

## Clean-baseline versioning audit — 26.11.2026

- Added docs/CLEAN_BASELINE_SCHEMA_VERSIONING_DESIGN.md. It defines separate clean-final-baseline adoption and explicit legacy-upgrade paths; it does not assign a final schema version number until F-02 and F-06 contracts are frozen.
- Source inspection found the current installer creates/initializes the schema before calling schema versioning, while the versioning code assumes baseline v1 and migrations v2/v3. A clean final workbook therefore needs its own idempotent adoption record, not a fabricated historical migration chain.
- Source inspection also found di3DryRunInstallation() checks known system sheets/workspaces but does not inventory and block every unknown populated tab. The clean-install preflight must close this gap.
- No source runtime or workbook changes were made. Clean-baseline versioning remains a design task before implementation.

## F-06 — FIFO allocation archive and crash-recovery specification — 26.11.2026


- Audited the active allocation replacement path, FIFO run lifecycle, allocation ID generation, and all four stock-operation call sites.
- Confirmed that the current rollback helper only handles caught write errors; abrupt Apps Script termination between sheet writes can leave a partially replaced projection. A subsequent retry currently creates a new FIFO run ID, so it cannot reliably identify the interrupted replay.
- Confirmed that allocation rows currently receive random UUIDs on every rebuild. F-06 therefore requires deterministic allocation IDs for a stable replay identity and target fingerprint.
- Added `docs/F06_FIFO_ALLOCATION_ARCHIVE_IMPLEMENTATION_SPEC.md`. It defines separate append-only allocation and lot-cache archives, an append-only replay lifecycle event log, operation-linked replay identity, PREPARED/COMMITTED recovery, fail-closed quarantine, and 20 fault-injection/regression cases.
- F-06 depends on F-07 sequence-based input identity. The spec is for the clean baseline; no production backfill or legacy migration is planned for the recreated workbook.
- No Apps Script source, spreadsheet schema, workbook data, or deployment was changed. Tests and runtime fault injection were not run. F-06 remains open pending implementation and acceptance.

## F-06 — source implementation groundwork — 26.11.2026

- Added clean-baseline schemas for allocation snapshots, lot-cache snapshots and append-only replay events; expanded FIFO run metadata with operation ID, parent replay ID, scope and input fingerprint.
- Linked all four stock-operation handlers to the FIFO run using their immutable operation ID. Added SHA-256 run input fingerprinting and prioritized the new archive tables in backup ordering.
- Updated F-06 identity design after reviewing the live control flow: one stock operation may process multiple products, and only some may require a full product replay. Therefore each replaced product receives its own stable child replay identity; incremental-only products do not create archive events.
- Implemented append-only allocation/lot snapshots, deterministic replay allocation IDs, PREPARED/COMMITTED/QUARANTINED lifecycle events, per-product replay identity, pending run reuse, source restoration, recovery before tail processing, and a gate blocking new stock events while runs are unresolved.
- GitHub Actions run `45710935351` passed syntax checks for 50 `.gs` files and all seven source suites (99/99). Runtime fault-injection and backup/restore acceptance remain open. F-06 remains open.
## N-03 — clean final baseline implementation — 26.11.2026

- Implemented a separate `CLEAN_FINAL_BASELINE_ADOPTION` path in `33_DI3_SchemaVersioning.gs`: a new workbook with the exact final target headers records one 0 → current-version baseline instead of fabricating RC8 baseline-v1 and v1→v2→v3 migration history.
- Kept the explicit RC8/legacy migration path separate. An unversioned workbook without recognized legacy migration identity is blocked rather than auto-adopted.
- Added fail-closed checks for duplicate/mismatched clean-baseline journal records, legacy or partial headers, out-of-schema populated columns, and missing system tables after baseline adoption.
- A `STARTED` baseline may resume only after revalidating the target headers; an adopted baseline remains recognizable after normal business rows have been created.
- Added 12 focused System Safety UX regression cases and updated `docs/CLEAN_BASELINE_SCHEMA_VERSIONING_DESIGN.md`.
- Branch: `feature/clean-final-baseline`; draft PR: https://github.com/brusvv/dots_inventory-/pull/1.
- GitHub Actions code run `45728096949` and PR integration run `45728149345` (run #93, merge commit `a17111e`) passed syntax for 50 `.gs` files and 129/129 Node tests: FIFO 41, Order Domain 17, Supply UX 15, Catalog/Order UX 12, System Safety 31, Warehouse Dashboard 9, Finance 4. The idempotency test verifies recovery after schema_version has been written but before the baseline journal row is completed. This remains source-level validation, not Google Sheets runtime acceptance.
- Added a regression case proving that a fully cleared header row after baseline adoption is BLOCKED; CI rerun for this final guard is pending.
- **Still not runtime-accepted:** actual Google Sheets Dry Run, empty-workbook setup, setup rerun, interruption injection at both journal boundaries, backup/restore-as-new, and end-to-end supply/dispatch/return/finance flows. Existing RC8 remains untouched.


## Verification update — 26.11.2026 (supersedes earlier pending-CI notes)

- Latest PR quality-gates run: GitHub Actions run 45728640689, completed successfully against PR merge commit 903b546 (head a20dfba).
- Apps Script syntax: **50/50 .gs files PASS**.
- Regression suites: **130/130 PASS** — FIFO replay 41/41; Order Domain 17/17; Supply Workspace UX 15/15; Catalog/Order UX 12/12; System Safety UX 32/32; Warehouse Dashboard 9/9; Finance Schema 4/4.
- This run includes the final clean-baseline guard rejecting a fully cleared core-table header after adoption. It also executes the current F-20 identity/initiator regression assertions through the System Safety runner.
- These results are source/Node CI only. They do not establish Google Apps Script runtime behavior, Google Sheets chart rendering, multi-user LockService behavior, backup/restore consistency, or live business-cycle correctness.
- N-03 source-CI gate is now passed. Remaining N-03 acceptance is Google Sheets Dry Run/setup/rerun/interruption recovery on a disposable empty workbook, plus backup/restore-as-new. PR #1 remains Draft and unmerged; main and the existing RC8 workbook remain unchanged.


## Date/time UX scope expanded — 26.11.2026

The confirmed separate date-picker + mandatory `HH:mm` time-input pattern applies consistently to **orders, supplies and manual warehouse movements**, not only F-02 historical sales. New design contract: `docs/OPERATION_DATE_TIME_UX_DESIGN.md`.

- Orders: ordinary lifecycle transitions use separate date/time controls. F-02 historical sales add a manually entered date-only customer-order `business_date` and separately capture actual historical dispatch and completion date/time. Historical dispatch may precede `created_at` only in the explicit historical-sale path; FIFO still uses actual dispatch `effective_at`.
- Supplies: normal next-stage input becomes a date/time pair; historical supply actual events sent/awaiting/received (G5:G7) each use a date/time pair. Store order date and expected arrival date remain date-only.
- Warehouse: manual IN/OUT operation date and time become adjacent required inputs.
- Canonical event timestamps remain single timestamps; `recorded_at`/`created_at` remain system times. No supply/StockLedger schema migration is introduced solely for UI separation.
- Shared parser must combine the pair in the configured spreadsheet timezone, reject missing/invalid time, preserve time across date-picker changes, normalize seconds to `00`, and feed the same canonical timestamp into confirmation, idempotency hash and operation payload.
- This is a design freeze only. Source implementation and regression tests remain pending; PR #1 remains Draft/unmerged and no workbook/runtime changes are authorized by this documentation update.


## F-02 — customer-order date and historical lifecycle clarification — 26.11.2026

- The customer-order `business_date` is distinct from the actual workbook `created_at`. Example: customer order 25 November 23:00, entered 26 November 08:00 → business_date = 25 November; created_at = 26 November 08:00.
- A historical sale still requires its actual dispatch date/time and completion date/time. These are independent lifecycle event timestamps; `business_date` is never used as StockLedger `effective_at`.
- Historical mode must bypass current-stock availability rejection during draft creation and rely on scoped FIFO preflight/replay at the actual dispatch timestamp. It may bypass the ordinary dispatch-not-before-created_at guard only inside the explicit historical-sale workflow; all other FIFO, pending-operation, PeriodGuard and returned-order checks remain.
- Completion chronology is checked against the actual dispatch timestamp. Finance Dashboard continues recognizing sales on `completed_at`; `business_date` does not move recognized revenue/COGS into another financial period.
- The v3→v4 schema appends only `V3_Orders.business_date` (AD); existing 29 columns remain in place. The proposed dispatch precision/window/uncertainty fields remain removed.
- Source audit found implementation blockers: current order draft rejects quantities above today's stock; current `di3DispatchOrder_` rejects dispatch before `created_at`; the ordinary order form has no business-date or historical lifecycle controls; and the order register currently shows only `created_at`. These must be addressed in one coordinated F-02 source patch, with tests for historical vs ordinary behavior and idempotent recovery.
- No source code, schema registry, workbook or runtime data changed in this documentation update. PR #1 remains Draft/unmerged; existing RC8 workbook remains untouched.
