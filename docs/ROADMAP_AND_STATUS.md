# Roadmap and status — Dots Inventory v3 RC8

Дата снимка: 24.11.2026. Статусы ниже отражают фактическое содержимое предоставленного `40.rar` и runtime-сведения пользователя в текущем чате.

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
- Local validation after UX-07–UX-09: syntax **49 `.gs` PASS**, Supply UX **9/9**, Catalog/Order UX **12/12**, System Safety UX **8/8**, Warehouse Dashboard **5/5**, TypeScript AST **548 functions / 87 top-level vars / no duplicates or parse errors**, menu reference audit **68 actions / 0 missing handlers**.

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

`38_DI3_WarehouseDashboardTests.gs`: five pure tests passed locally on this snapshot.

**Open:** actual rendering/refresh in Google Sheets. Confirm that labels match values, empty/unvalued products are excluded, order is descending, chart does not duplicate/vanish after repeated refresh, and M data remains intact.

## Cross-project remaining work

### FIFO / stock / sales
- C-01: benchmark in real GAS at 500/1,000/2,000 movements; measure runtime, Sheets reads/writes, TextFinder, quotas.
- C-02: runtime acceptance for PeriodGuard, historical profit and `OrderCostSnapshots`.
- C-03: implement partial returns; agree policy first.
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
- Schema Versioning: runtime acceptance for baseline and v1→v2 on empty/non-empty copies; design v3+ migration path. Reverse migrations absent; rollback through verified backup/restore.

## RC9 readiness gate

Do not call RC9 ready until the real Google Sheets end-to-end cycle is verified: supply → receipt → FIFO → order → dispatch → return → finance, with backup/restore, idempotent recovery and concurrency acceptance. Local Node tests are not a substitute for Google Apps Script runtime evidence.
