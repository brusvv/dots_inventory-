# PROJECT CONTEXT FOR NEW CHAT — Dots Inventory v3 RC8

**Base context snapshot:** 24 November 2026  
**Local UX patches:** 25 November 2026  
**Base source:** user-uploaded `40.rar`, SHA-256 `2f7219712a2a20377c3459d4103b10f7148640782f3f9c684e0808bd59830a09`  
**Current working tree:** `src/apps_script/` (42 Apps Script modules) + `runtime/probes/` (7 probes), including UX-01–UX-09 patches from 25.11.2026. See `docs/UX_PATCH_UX01_UX03.md`, `docs/UX_PATCH_UX04_UX06.md` and `docs/UX_PATCH_UX07_UX09.md`.

> New-chat instruction: use this repository as the actual current source snapshot. Inspect current files before proposing edits. Do not assume that old patch links or older snippets represent the installed code. Preserve the user's safe workflow: work on a restored test copy, backup first, no destructive operation without explicit approval.

## 1. Project purpose

Dots Inventory v3 is a Google Sheets + Google Apps Script inventory, purchasing, sales, FIFO-costing and finance system. Its business cycle is:

**Product catalogue → purchase supply → receipt into stock → FIFO lots → customer order → dispatch/stock consumption → return → cost/profit reporting.**

The spreadsheet is designed as an application with visible workspaces and hidden/system tables. Apps Script modules own domain rules, repositories, user forms, menus, operation execution, dashboards, backup/restore and schema migrations.

## 2. Current source snapshot — what is actually in this ZIP

The base `40.rar` contained 39 Apps Script source modules. The current patched working tree contains those base modules plus three local regression modules (`39_DI3_SupplyWorkspaceUxTests.gs`, `40_DI3_CatalogOrderUxTests.gs`, `41_DI3_SystemSafetyUxTests.gs`), for 42 Apps Script modules total;
- 7 temporary runtime probes;
- no `appsscript.json`, `.clasp.json`, Node regression harness, `package.json`, or original docs.

Static audit performed while assembling this repository:

- all **49** `.gs` files (42 app modules + 7 temporary probes) parse successfully with Node.js v22.16.0;
- TypeScript AST audit: **548 top-level function declarations**, **87 top-level variable declarations**, no parse errors and no duplicate top-level names;
- menu reference audit: **68 actions**, 0 missing handlers;
- warehouse chart unit tests: **5/5 PASS**;
- Supply Workspace UX tests: **9/9 PASS**;
- Catalog/Order UX tests: **12/12 PASS**;
- System Safety UX tests: **8/8 PASS**.

These are static/local checks. The full Apps Script unit-test functions in the source were not all executed in a real Google Apps Script runtime. No claim is made that all 250+ previous Node tests were rerun against this RAR, because the prior Node harness is not included.

### Actual configuration from source

`00_DI3_AppConfig.gs` currently declares:

```javascript
DI3_APP_CONFIG.TIME_ZONE = "Europe/Helsinki"
```

`33_DI3_SchemaVersioning.gs` declares `DI3_SCHEMA_VERSION = 2`. The schema registry in `00_DI3_SchemaRegistry.gs` contains 24 system tables. The manifest was not part of the RAR, so its `timeZone` cannot be confirmed from this snapshot. Verify manifest and spreadsheet timezone against `Europe/Helsinki` before release or timezone-sensitive operations.

## 3. Core architecture and data model

### Main business and system tables

The schema registry defines 24 system tables, including:

- `Products`, `PackVariants`, `ProductPublicCodes` — product master and pack variants;
- `V3_Supplies`, `V3_SupplyItems` — supplies and their item rows;
- `V3_Orders`, `V3_OrderItems`, `V3_DeliveryMethods` — orders and order lines;
- `StockLedger` — append-only inventory movement ledger;
- `StockMovementDetails` — movement metadata, reason and reversals;
- `StockLots` — FIFO receipt lots;
- `StockAllocations`, `FifoAllocationRuns`, `FifoProductState` — FIFO allocations and projections;
- `ProductCostHistory`, `OrderCostSnapshots` — historical cost records/snapshots;
- `Operations`, `OperationAttempts`, `OperationPayloads` — operation state, retries and immutable payloads;
- `DocumentStatusHistory` — status history;
- `Settings`, `PeriodLocks`, `_AppMeta`, `SchemaMigrations` — settings, period guard, app metadata and schema migrations.

The schema is version 2 in this source snapshot. Do not run Clean Start or imports to apply code-only patches. Schema migrations must follow Dry Run + verified backup rules in the existing code.

### Operation safety

The app uses an `OperationExecutor` with an idempotency key, immutable payload/hash, operation status and retry/recovery path. Current operation registry in `27_DI3_OperationExecutor.gs` includes at least:

- `SUPPLY_RECEIVE` — warehouse receipt;
- `SUPPLY_DOCUMENT_EDIT` — document-only supply edit.

`SUPPLY_CORRECTION` is **not registered/implemented** in this snapshot. Never mutate committed `SUPPLY_RECEIVE` payloads or old `StockLedger` / `StockLots` rows directly.

## 4. Supply Workspace — current behavior

### User statuses

Internal status values and displayed labels:

- internal `Создан` → displayed **Оформлена**;
- `Отправлен` → **Отправлена**;
- `Ожидает получения` → **Ожидает получения**;
- `Доставлен` → **Получена**;
- `Отменен` → **Отменена**.

### Form fields

The `Поставка v3` workspace has:

- B2: selected supply;
- B3: supply number;
- B4: supplier;
- B5/B6: seller and partner discounts;
- B7: shipping cost;
- B8: notes;
- G2: store order date (`supplier_order_date`);
- G3: expected arrival (`expected_received_date`);
- G4: system-created timestamp (`created_at`, read-only);
- G5: sent timestamp;
- G6: awaiting-receipt timestamp;
- G7: received timestamp;
- rows 12–31: up to 20 item rows in the form;
- N2/N3/N4+ hidden context cells: selected `supply_id`, historical mode and full-edit/revision context; exact ranges are declared in `11_DI3_SupplyDomain.gs`.

G2 is the business date used in supply numbering and register sorting. G4 is the timestamp when the record was created in Dots Inventory. These fields must not be confused.

### New and historical supplies

- **Новая поставка** creates a new draft for a purchase still in progress.
- **Внести старую поставку** is a separate path for a supply already physically received but not yet booked into this inventory. It fills historical stage dates and then creates one receipt operation (`SUPPLY_RECEIVE`) on explicit confirmation.
- Historical receipt must only be used if those items have not already been received into this inventory; otherwise a duplicate document could duplicate stock.
- Receipt produces stock ledger movements, FIFO lots and product-cost history. Idempotency protects repeat of the same `supply_id` operation; it does not automatically detect two separately created documents for the same physical shipment.

The user reported that the first historical supply entry and status `Получена` worked. Full inventory/FIFO/financial reconciliation is intentionally postponed until all old supplies and sales are entered.

### Full supply editing — Phase A/B

Current modules: `36_DI3_SupplyFullEdit.gs`, `37_DI3_SupplyFullEditTests.gs`; operation handler registration in `27_DI3_OperationExecutor.gs`.

- Full editing can be enabled for statuses Created / Sent / Awaiting / Received; cancelled supplies are rejected.
- For non-received supplies, document fields, financial inputs, line items and non-received stage dates can be edited. The target status is derived from the present continuous date chain.
- For a supply in **Отправлена**, G5 can be corrected and G6 can be entered. Entering G6 makes the target status **Ожидает получения**; this does not create a stock receipt.
- G7 cannot be set for a not-yet-received supply through `SUPPLY_DOCUMENT_EDIT`. The full editor explicitly rejects this because it does not perform warehouse receipt. Use the normal next-stage/receipt workflow or the historical-supply path for a new already-received-but-not-yet-booked supply.
- A received supply allows only safe metadata-only document edits. Changes to item rows, quantity, pack variant, purchase price, discounts, shipping or G7 are blocked because they alter stock/FIFO/cost history.
- Cancelled supply editing is not available directly; a separate controlled restoration would be required.
- `supply_id` and `created_at` are preserved. Supply number is protected from direct typing; recalculation by G2 is a separate explicit action with collision check.
- Reason for change is required in M9. Preview is `PREVIEW_ONLY`; save uses one `SUPPLY_DOCUMENT_EDIT` operation with revision-scoped idempotency and before/after audit payload.

### Known runtime test already reported by user

Supply `26JY021`:

- user loaded it in the supply form;
- internal/current status remained **Отправлен** / displayed **Отправлена**;
- G2 shown as 02.07.2026; G3 shown as 15.07.2026;
- user changed G5 to **05.07.2026 00:00** (user clarified that 05 July was intentional, not an accidental shift from 04 July);
- the form and supply register showed 05.07.2026;
- status remained **Отправлена**;
- number remained `26JY021`;
- final visual screenshot showed one product line and total 2,100 ₽.

Still unverified from the user's screenshots alone: unchanged `supply_id`, unchanged `created_at`, exactly one `SUPPLY_DOCUMENT_EDIT` operation with `COMMITTED`, payload before/after, and unchanged `StockLedger` / `StockLots` / FIFO allocations. Confirm those by read-only inspection/probes or table counts before declaring full acceptance.

## 5. Supply menu in this snapshot

`22_DI3_MenuAndFilterUtils.gs` groups the `Поставки` menu into four submenus. The 25.11.2026 UX patch also:

1. **Создание** — New supply, Enter historical supply, Save and receive historical supply.
2. **Выбор и просмотр** — Load selected supply, Open supply register, Refresh register.
3. **Редактирование** — Calculate supply, Save supply, Update draft, enable full editing, preview changes, recalculate number by G2, save changes, cancel edit.
4. **Проведение и отмена** — Apply next stage, cancel selected supply, refresh form validation lists.

- protects dirty forms before `Новая поставка` clears data;
- stages a changed B2 selection and restores the old selector until the user confirms via `Загрузить выбранную поставку…`;
- blocks B2 switching during FULL_EDIT;
- separates `Проверить целостность FIFO (без изменений)` from `Перестроить FIFO полностью…`, which now asks for explicit confirmation before lock/backup/rebuild.

These changes pass local structural tests, but real Sheets alert/toast and installable-trigger behavior remain unverified until runtime acceptance on a restored test copy.

## 6. Warehouse Dashboard — current source and issue

Relevant modules:

- `19_DI3_WarehouseViews.gs` — dashboard/table/chart implementation;
- `38_DI3_WarehouseDashboardTests.gs` — pure ranking/filter tests;
- `07_DI3_StockCore.gs` — warehouse valuation/FIFO domain logic.

### Chart logic in this snapshot

The dashboard chart helper:

- filters to positive stock quantity;
- requires fully valued stock (`Оценено` status and all stock known);
- excludes zero-value/empty/unvalued rows;
- sorts by inventory value descending, with stable label/code tie-breakers;
- limits the chart to Top 20;
- creates paired `[product label, inventory value]` rows in a contiguous hidden helper range N:O;
- creates a horizontal bar chart and explicitly includes hidden dimensions using `Charts.ChartHiddenDimensionStrategy.SHOW_BOTH`;
- calls `reverseCategories()` while still on the bar-chart builder, before `addRange()` returns the base builder;
- uses `.setNumHeaders(1)`; the code must not reintroduce unsupported `useFirstRowAsHeaders()` or `useFirstColumnAsDomain()` methods.

The current source contains the chart-builder API correction that supersedes the earlier broken hotfix. It also includes a guard preventing setup from clearing M25 and below, because column M is part of the data table area.

### Screenshot values used as acceptance fixture

User's latest screenshot showed:

- 65 active products;
- 120 units on stock;
- 2,940 ₽ stock valuation;
- 0 unvalued units;
- `KYUU DESIGN Lian, 6 мм` (`PRD-0028`): 80 units, 840 ₽ value, 10.50 ₽ average FIFO;
- `Wallhack Black (Silent), 7 мм` (`PRD-0002`): 40 units, 2,100 ₽ value, 52.50 ₽ average FIFO.

The correct Top order is Wallhack Black (2,100 ₽), then KYUU DESIGN Lian (840 ₽). The old screenshot had mismatched labels/values and displayed empty products. The current source addresses this through paired/sorted chart data and five tests.

### Dashboard acceptance still pending

Local test of `di3RunWarehouseDashboardUnitTests()` passed 5/5 in this source package. Actual `Склад → Обновить Dashboard` rendering in the user's live/test Google Sheets is not yet confirmed from this snapshot. Verify that:

- chart labels are attached to the correct values;
- only positive, fully valued stock appears;
- order is descending, most expensive at top;
- no empty products appear;
- at most 20 rows are charted;
- the helper columns remain hidden but the chart includes them;
- repeated dashboard refresh does not clear M data or duplicate/leave old charts;
- an empty warehouse produces a clean no-data state.

## 7. Other current capabilities (from source names and code)

- Product catalogue and product/pack-variant editing (`10_DI3_ProductCatalog.gs`, `01`–`03` repositories/identity/variants).
- Warehouse stock core, FIFO and manual warehouse management (`07`, `08`, `09`, `19`).
- Purchase/supply domain, receiving, historical entry and full editing (`11`, `12`, `14`, `34`–`37`).
- Order workflow and workspace (`15`–`18`).
- FIFO/history workspace (`20`, `24`).
- PeriodGuard (`23`).
- Event dispatcher (`26`).
- OperationExecutor/recovery (`27`).
- Setup/install preflight (`04`, `28`, `21`).
- Settings repository (`29`).
- Money Core (`30`).
- Finance dashboard (`31`).
- Backup/Restore (`32`).
- Schema Versioning (`33`).

Don't infer runtime acceptance from these modules existing. Inspect each module/test before declaring the feature done.

## 8. Immediate next work (priority order)

1. **Finish verification of `26JY021` full-edit operation**: prove the same `supply_id`, same `created_at`, one committed `SUPPLY_DOCUMENT_EDIT` with reason/payload, and unchanged stock/FIFO rows.
2. **Test G6 on a separate sent test supply**: enter a valid historical awaiting date, preview `PREVIEW_ONLY`, save and verify target status becomes `Ожидает получения`, G5 remains unchanged, no stock receipt/ledger/lots are created, audit history is correct.
3. **Test all full-edit fields on a disposable pre-receipt supply**: supplier, notes, seller discount, partner discount, shipping, price, quantity, add/remove/reorder items, number recalculation with collision protection, preserving IDs where appropriate. No receipt in this test.
4. **Test normal G7 receipt path** on a separate pending supply. For a supply already in the warehouse, do not use `Внести старую поставку` again.
5. **Supply UX/menu runtime acceptance**: validate UX-01–UX-03 on a restored copy; then validate UX-01–UX-09 prompts, selector behavior and menu actions in a restored Google Sheets copy. The local source/menu audit is complete; live runtime acceptance is still pending.
6. **Warehouse Dashboard runtime test** after the current `19_DI3_WarehouseViews.gs` is installed. Confirm chart rendering and top-20 correct labels/values using the screenshot fixture. No stock mutations.
7. **Implement Phase C `SUPPLY_CORRECTION`**: immutable corrective operation for received supplies, compensating movements, FIFO candidate replay, ProductCostHistory and downstream order COGS re-evaluation. Not implemented yet; design and failure/retry coverage required.
8. After all historical purchases and sales have been entered, run full historical stock/FIFO/financial reconciliation. The user has intentionally postponed final acceptance of historical supply entries until then.

## 9. Remaining project roadmap

### Warehouse / FIFO / sales

- C-01: real Apps Script performance benchmark at 500/1,000/2,000 movements (Node/mock scenarios exist in prior work; real GAS timing/quota evidence remains open).
- C-02: runtime tests for historical profit, PeriodGuard, snapshots, close/reopen periods.
- C-03: partial returns are not implemented; agree business policy and implement precise stock/cost restoration.
- C-04/C-05: execute real GAS fault/recovery acceptance for operation types, lost acknowledgements, retries, and persisted evidence.
- C-06: test ScriptLock using two independent GAS executions/sessions, including concurrent receipt/cancel/dispatch and retry.
- C-07: verify unified onEdit triggers and routing in the installed project.
- C-08: run read-only TextFinder/runtime probe with `sample_keys: 5` and `30`, 3–5 rounds; compare exact rows, fallback coverage and median latency.
- C-09: runtime/UX check next FIFO unit cost, including multiple lots and UNKNOWN/FREE.
- C-10: real Money Core V8 probe; backup; migration/rebuild on non-empty copy; reconcile lot totals, allocated cost, FIFO COGS and orders.
- C-11: verify installation preflight `BLOCKED` behavior without mutations.
- C-12: runtime acceptance for SettingsRepository, margin migration and timezone switch.
- C-13: check tab order in real Sheets.
- C-14: test delivery-method creation/selection/order flow.
- C-15: reconcile buyer-paid commission vs seller revenue/profit on a real order.
- C-16: runtime/visual Finance Dashboard acceptance using control orders, discounts, commissions, FIFO snapshots, UNKNOWN COGS, filters/charts and period boundaries.
- C-17 phase 2: charts, conditional formatting, filters, tab order and permission/protection review (do not auto-enable protections without a role model).

### Backup / Restore and schema

- BM-01: real restore-as-new runtime acceptance, manifest, bound script, folder rebind, trigger repair and data/FIFO reconciliation.
- BM-02: scalable backup catalog (pagination, fast list, no hash recalculation on open).
- BM-03: scheduled daily/weekly backups, timezone-aware, idempotent triggers, lock and logs.
- BM-04: retention policy with Dry Run, protect last valid/full backup, audit deletions.
- BM-05: periodic isolated restore test, default monthly proposal, PASS/FAIL evidence.
- BM-06: release acceptance and backup runbooks.
- Selective document/ledger export/import: separate future feature with referential-integrity validation.
- Schema versioning: real baseline and v1→v2 runtime acceptance on empty/non-empty copies; define v3+ migration path. Reverse migrations are not implemented; rollback via verified backup/restore.

### RC9 release gate

RC9 should wait for critical real-runtime evidence: supply → receipt → FIFO → sale/dispatch → return → financial reporting, plus backup/restore, schema migration, recovery, concurrency and documentation/rollback. Local tests alone are not sufficient.

## 10. User working preferences and safety constraints

- Work in Russian.
- Explain steps clearly and sequentially; avoid making the user run unnecessary diagnostics.
- Always use the latest uploaded repository as source of truth.
- Work only against a restored/test copy for patches and acceptance unless the user explicitly authorizes otherwise.
- Create a backup before code replacement or risky setup/migration.
- Do not run Clean Start, bulk imports, schema migration, restore, historical receipt, cancellation, FIFO rebuild or mutating fault probes without explicit context/approval.
- No destructive operation without explicit separate confirmation.
- Preserve existing data and IDs; use immutable operations/audits and idempotent recovery.
- When providing a patch, provide exact files to replace/add, ordered steps, expected results, and what evidence to send back.
- Be honest about local vs Google Apps Script runtime validation.

## 11. Temporary runtime probes in this snapshot

There are seven probes under `runtime/probes/`:

| Probe | Safety class | Purpose |
|---|---|---|
| `DI3_C04_ALL_TYPES_FAULT_INJECTION_PROBE.gs` | **MUTATING** | Fault injection and recovery for real business operations; only isolated disposable copy with recent backup and explicit parameters. |
| `DI3_C06_LOCK_CONTENTION_PROBE.gs` | Special test | Two independent executions to hold/test ScriptLock; no business table writes, but deliberately holds a lock. |
| `DI3_C08_READ_RUNTIME_PROBE.gs` | Read-only | TextFinder/read-cost probe; `sample_keys: 5` and `30`. |
| `DI3_C10_MONEY_RANGE_RUNTIME_PROBE.gs` | Read-only/in-memory | Money Core V8 numeric edge-case probe; no sheet read/write. |
| `DI3_SUPPLY_CANCEL_FAULT_INJECTION_PROBE.gs` | **MUTATING** | Cancels two specified unreceived test supplies permanently in a test copy. |
| `DI3_SUPPLY_CATALOG_RUNTIME_PROBE.gs` | Read-only | Supply/catalog runtime integrity snapshot. |
| `DI3_SUPPLY_EDIT_CANCEL_RUNTIME_PROBE.gs` | Read-only | Supply edit/cancel runtime integrity snapshot. |

Never install all probes into the production app as normal modules. Use them temporarily on an isolated copy, save the output, then remove them.

## 12. First prompt for the new chat

"Прочитай `PROJECT_CONTEXT_FOR_NEW_CHAT.md` и `README.md` в приложенном репозитории. Считай исходники `src/apps_script/` текущей версией проекта. Сначала кратко подтверди фактическое состояние кода и ближайшие задачи. Продолжим приёмку полного редактирования: проверить `26JY021` — `supply_id`, `created_at`, `SUPPLY_DOCUMENT_EDIT`, неизменность StockLedger/StockLots/FIFO; затем проверим G6 на отдельной отправленной тестовой поставке. Не меняй файлы и не запускай операции до согласования следующего шага."
