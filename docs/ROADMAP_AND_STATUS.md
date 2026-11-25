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
| Меню Supply Workspace | В `22_DI3_MenuAndFilterUtils.gs` четыре подменю: Создание, Выбор и просмотр, Редактирование, Проведение и отмена | Runtime UX audit, confirm mode switching, correct commands by status |

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
