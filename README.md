# Dots Inventory v3 — RC8 source repository snapshot

**Base source snapshot:** 2026-11-24  
**Local UX patches:** 2026-11-25 (UX-01–UX-10)  
**Source archive supplied in this chat:** `40.rar`  
**SHA-256 of source archive:** `2f7219712a2a20377c3459d4103b10f7148640782f3f9c684e0808bd59830a09`

The base source package was assembled from the user's uploaded `40.rar`. The working tree is a **patched derivative** of the 2026-11-24 base snapshot. Local UX-01–UX-10 patches add unsaved-form protection, safer navigation, and explicit confirmations for recovery, money/FIFO migration, period reopening and manual warehouse movements. See `docs/UX_PATCH_UX01_UX03.md`, `docs/UX_PATCH_UX04_UX06.md` and `docs/UX_PATCH_UX07_UX09.md` and `docs/UX_PATCH_UX10.md` for exact scopes.

## Repository contents

- `src/apps_script/` — 42 Apps Script production and unit-test modules (`.gs`), including `39_DI3_SupplyWorkspaceUxTests.gs`, `40_DI3_CatalogOrderUxTests.gs` and `41_DI3_SystemSafetyUxTests.gs`. The patched source modules are listed in the patch logs; unmodified modules retain the base archive contents.
- `runtime/probes/` — 7 temporary runtime probes. Some are mutating and must only be used on a disposable test copy.
- `docs/PROJECT_CONTEXT_FOR_NEW_CHAT.md` — detailed handoff context for a new ChatGPT conversation.
- `docs/ROADMAP_AND_STATUS.md` — current feature status and remaining work.
- `docs/INSTALLATION_AND_RUNTIME_ACCEPTANCE.md` — deployment cautions and runtime test expectations.
- `reports/` — source inventory, checksums and validation evidence.
- `tools/` — syntax and local regression-test runners for dashboard, Supply Workspace, Catalog/Order UX and System Safety UX, including the manual warehouse movement confirmation.

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
node tools/run_warehouse_dashboard_tests.js
node tools/run_supply_workspace_ux_tests.js
node tools/run_catalog_order_ux_tests.js
node tools/run_system_safety_ux_tests.js
```

The syntax command checks all `.gs` files. The dashboard runner executes five pure chart tests. The Supply UX runner executes nine pure/structural tests for dirty-form protection, B2 switching and FIFO menu safety. The Catalog/Order runner executes twelve source-level regression tests for dirty product/order form protection and menu discoverability. The System Safety runner executes eight source-level tests for confirmed batch recovery, money/FIFO migration and accounting-period reopening. These checks do not emulate Google Sheets rendering, Apps Script services, triggers, Drive, LockService, or the full application's regression harness. UX changes remain subject to runtime acceptance on a restored test spreadsheet. No migration, batch recovery, period reopening or stock operation was executed during local validation.

## Safe operating rules

1. Work on a restored/test spreadsheet, not the business workbook.
2. Take a fresh backup before replacing Apps Script modules.
3. Do not run Clean Start, imports, schema migration, restore, or destructive probes unless the specific test calls for them and the user has explicitly approved the effects.
4. Never rewrite historical `StockLedger`, `StockLots`, or committed operation payloads directly.
5. Do not report a feature as runtime-accepted based only on local syntax/Node tests.
6. For received-supply cost/quantity/date corrections, use a dedicated `SUPPLY_CORRECTION` + FIFO replay design. That operation is **not present** in this snapshot.

## Source-of-truth rule for future work

Treat this repository's `src/apps_script/` files as the current local working tree: the 2026-11-24 archive snapshot plus the documented UX-01–UX-10 patches from 2026-11-25. Before patching, inspect the exact current module and its callers. Do not mix in older standalone V1–V4 hotfix files from prior chat messages unless a diff proves that a newer source module is missing a change.

## UX-04 through UX-06

Protect the order calculator and product editor from accidental data loss, stage product selection changes pending confirmation, and group System navigation by task. Existing-product identity collision now also passes through the normal unsaved-form confirmation. See `docs/ROADMAP_AND_STATUS.md`, `docs/UX_PATCH_UX04_UX06.md`, and `docs/MENU_STRUCTURE_CURRENT.md`.

## UX-07 through UX-10

Add explicit YES/NO confirmation and impact summaries before batch recovery of pending operations, the integer-minor-unit money/FIFO migration, reopening the latest accounting period, and manually posting warehouse IN/OUT movements. A No response exits before the corresponding mutation path. See `docs/UX_PATCH_UX07_UX09.md` and `docs/UX_PATCH_UX10.md`.
