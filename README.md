# Dots Inventory v3 — RC8 source repository snapshot

**Base source snapshot:** 2026-11-24  
**Local patches:** 2026-11-25 (UX-01–UX-10, commission payer/schema v3, Dashboard diagnostics, F-01, source-only hardening F-03/F-04/F-05/F-09/F-11/F-13/F-15/F-16/F-18, and F-10 append-only period events)  
**Source archive supplied in this chat:** `40.rar`  
**SHA-256 of source archive:** `2f7219712a2a20377c3459d4103b10f7148640782f3f9c684e0808bd59830a09`

The base source package was assembled from the user's uploaded `40.rar`. The working tree is a **patched derivative** of the 2026-11-24 base snapshot. Local UX-01–UX-10 patches add unsaved-form protection, safer navigation, and explicit confirmations for recovery, money/FIFO migration, period reopening and manual warehouse movements. The commission/Dashboard patch adds buyer-vs-seller commission payer handling, a v2→v3 additive schema migration, percent-input normalization, the missing average-known-unit-cost KPI, and read-only Dashboard chart diagnostics. The F-01 patch fixes order returns by resolving active FIFO consumption allocations by the original dispatch `movement_id`, not by the globally latest FIFO run. See the patch logs for exact scopes.

## Repository contents

- `src/apps_script/` — 43 Apps Script production and unit-test modules (`.gs`), including the local regression modules `39_DI3_SupplyWorkspaceUxTests.gs`, `40_DI3_CatalogOrderUxTests.gs`, `41_DI3_SystemSafetyUxTests.gs` and `42_DI3_FinanceSchemaTests.gs`. The patched source modules are listed in the patch logs; unmodified modules retain the base archive contents.
- `runtime/probes/` — 7 temporary runtime probes. Some are mutating and must only be used on a disposable test copy.
- `docs/PROJECT_CONTEXT_FOR_NEW_CHAT.md` — detailed handoff context for a new ChatGPT conversation.
- `docs/ROADMAP_AND_STATUS.md` — current feature status and remaining work.
- `docs/INSTALLATION_AND_RUNTIME_ACCEPTANCE.md` — deployment cautions and runtime test expectations.
- `reports/` — source inventory, checksums and validation evidence.
- `tools/` — syntax and local regression-test runners for Dashboard, Supply Workspace, Catalog/Order UX, System Safety, Order Domain and Finance schema mapping.

## Important omissions from the supplied archive

The uploaded RAR contained Apps Script source modules and runtime probes only. It did **not** contain:

- `appsscript.json` (Apps Script manifest);
- `.clasp.json` (clasp project binding / script ID);
- a complete Node regression harness or package manifest;
- the earlier project documentation and full original repository history.

These files were not fabricated. Before deployment, recover the actual `appsscript.json` and `.clasp.json` from the bound Apps Script project or the previous authoritative repository. The source config currently declares `DI3_APP_CONFIG.TIME_ZONE = "Europe/Helsinki"`; verify that the manifest `timeZone` and spreadsheet timezone match it.

## Quick checks

From the repository root:

```bash
bash tools/check_syntax.sh
node tools/run_fifo_replay_tests.js
node tools/run_warehouse_dashboard_tests.js
node tools/run_order_domain_tests.js
node tools/run_supply_workspace_ux_tests.js
node tools/run_catalog_order_ux_tests.js
node tools/run_system_safety_ux_tests.js
node tools/run_finance_schema_tests.js
```

A GitHub Actions workflow `.github/workflows/quality-gates.yml` now runs syntax checks and all local regression runners on source changes. The new FIFO sequence tests are included in `tools/run_fifo_replay_tests.js`; the current 99/99 result includes them.

The syntax command checks all **50** `.gs` files (43 app modules + 7 temporary probes). The seven local Node suites pass **115/115**: FIFO replay 39/39, Order Domain 17/17, Supply Workspace UX 15/15, Catalog/Order UX 12/12, System Safety UX 19/18, Warehouse Dashboard 9/9 and Finance schema 4/4. GitHub Actions run: https://github.com/brusvv/dots_inventory-/actions/runs/45720734088. The TypeScript AST audit reports 570 top-level functions and 88 top-level variable declarations, with no parse errors or duplicate declarations. The menu audit finds 68 actions and no missing handlers. These checks do not emulate Google Sheets rendering, Apps Script services, installed triggers, Drive, LockService or the full application's regression harness. UX changes remain subject to runtime acceptance on a restored test spreadsheet. No migration, batch recovery, period reopening or live stock operation was executed during local validation.

## Safe operating rules

1. Work on a restored/test spreadsheet, not the business workbook.
2. Take a fresh backup before replacing Apps Script modules.
3. Do not run Clean Start, imports, schema migration, restore, or destructive probes unless the specific test calls for them and the user has explicitly approved the effects.
4. Never rewrite historical `StockLedger`, `StockLots`, or committed operation payloads directly.
5. Do not report a feature as runtime-accepted based only on local syntax/Node tests.
6. For received-supply cost/quantity/date corrections, use a dedicated `SUPPLY_CORRECTION` + FIFO replay design. That operation is **not present** in this snapshot.

## Source-of-truth rule for future work

Treat this repository's `src/apps_script/` files as the current local working tree: the 2026-11-24 archive snapshot plus the documented UX-01–UX-10, commission/Dashboard and F-01 patches from 2026-11-25. Before patching, inspect the exact current module and its callers. Do not mix in older standalone V1–V4 hotfix files from prior chat messages unless a diff proves that a newer source module is missing a change.

## UX-04 through UX-06

Protect the order calculator and product editor from accidental data loss, stage product selection changes pending confirmation, and group System navigation by task. Existing-product identity collision now also passes through the normal unsaved-form confirmation. See `docs/ROADMAP_AND_STATUS.md`, `docs/UX_PATCH_UX04_UX06.md`, and `docs/MENU_STRUCTURE_CURRENT.md`.

## UX-07 through UX-10

Add explicit YES/NO confirmation and impact summaries before batch recovery of pending operations, the integer-minor-unit money/FIFO migration, reopening the latest accounting period, and manually posting warehouse IN/OUT movements. A No response exits before the corresponding mutation path. See `docs/UX_PATCH_UX07_UX09.md` and `docs/UX_PATCH_UX10.md`.

## Commission payer and Dashboard patch — 25.11.2026

The order form checkbox B3 now means **“Комиссию оплачивает покупатель”**. If checked, the commission is added to the buyer total; if unchecked, it is deducted from seller proceeds and profit. The fee is calculated whenever the commission rate is greater than zero. The existing commission base (gross goods before discount) is retained. Existing V3_Orders records are migrated with `commission_payer=BUYER` to preserve the previous accounting rule. Schema Versioning target is now v3; setup Dry Run and verified backup are required before applying the additive column.

The commission reader accepts both native Sheets percentage cells and literal-percent cells, preventing the 100× under-calculation shown in the user's screenshot.

Warehouse Dashboard now calculates the missing average-known FIFO unit cost and keeps enough grid rows for the chart height. Read-only functions `di3DiagnoseWarehouseDashboardChart()` / `di3LogWarehouseDashboardChartDiagnostics()` expose N1:O21, chart source ranges and chart count. The actual chart remains **not runtime-accepted** until those diagnostics and a real Sheets screenshot confirm its rendering.

See `docs/UX_PATCH_COMMISSION_PAYER_AND_DASHBOARD.md`. The user has visually accepted UX-01–UX-06 except the duplicate-product-identity test, which remains outstanding.

## F-01 — order return FIFO lookup (25.11.2026)

Order return construction no longer requires the latest global `FifoAllocationRuns.run_id`. `StockAllocations` is a compact active projection and can legitimately contain valid active rows from several runs. The return now selects `CONSUME` rows by the original order-line `dispatch_movement_id`, preserves source FIFO run IDs as provenance, and still rejects a quantity mismatch before creating the return operation. Regression coverage includes a later unrelated run and a partial-allocation rejection. See `docs/UX_PATCH_F01_RETURN_FIFO.md`.

This fix is locally tested but **not runtime-accepted** in Google Sheets. The runtime test must use a restored disposable copy: dispatch order A, perform a separate stock operation that produces a later FIFO run, then accept the return of A and verify the returned lots retain the original lot costs. Do not use a live order or production stock.


## Source-only hardening after F-01 — 25.11.2026

The current working tree also contains source-only hardening for historical-supply lock scope (F-03), fail-closed payload size validation (F-04 mitigation), immutable full-edit retry fingerprint checks (F-05), independent warehouse-view refresh plus a pending-operation warning in the stock journal (F-09 partial), non-reserving supply-number preview (F-11), `SpreadsheetApp.flush()` before backup snapshot/copy (F-13), mutual exclusion of historical-supply and full-edit modes (F-15), schema-name-based Finance Dashboard column access (F-16), and symmetric half-up minor-unit rounding (F-18). Details and limitations are in `docs/UX_PATCH_STATIC_HARDENING.md`.

**Important limitations:** F-04 is a 45,000-character fail-closed guard, not chunked payload storage. F-09 repeated-read performance remains open. Backup/lock behavior and all dialogs still require runtime acceptance. The Warehouse Dashboard chart is still visibly blank in the user's Sheets copy; source changes and local tests have not identified or closed the rendering defect.


## F-10 — append-only accounting-period events — 25.11.2026

Period close/reopen no longer overwrites the existing `PeriodLocks` row. Each transition appends a new `LOCKED` or `REOPENED` event; PeriodGuard derives the current state from the last event for each period. The existing 10-column schema is reused, so this source patch does not require a schema migration. Three structural regression checks were added to `41_DI3_SystemSafetyUxTests.gs`; they have not yet been executed in this GitHub-only continuation. Existing historical rows remain readable, but previously overwritten reopen history cannot be reconstructed retroactively. See `docs/UX_PATCH_F10_APPEND_ONLY_PERIOD_AUDIT.md`.

**Acceptance pending:** run the complete local syntax and Node suites, then verify close → reopen → re-close on a restored test workbook. Confirm each transition adds exactly one row, earlier rows remain byte-for-byte unchanged, and PeriodGuard status/operation blocking follows the latest event.
