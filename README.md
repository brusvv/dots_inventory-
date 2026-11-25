# Dots Inventory v3 — RC8 source repository snapshot

**Snapshot date:** 2026-11-24  
**Source archive supplied in this chat:** `40.rar`  
**SHA-256 of source archive:** `2f7219712a2a20377c3459d4103b10f7148640782f3f9c684e0808bd59830a09`

This repository was assembled from the user's uploaded `40.rar`. The original Apps Script source files are preserved under `src/apps_script/`; the seven temporary diagnostic/runtime probes are preserved under `runtime/probes/`. Project context, status, installation notes, inventory and static validation reports were added around those source files.

## Repository contents

- `src/apps_script/` — 39 production and Apps Script unit-test modules (`.gs`). Filenames and contents are preserved from `40.rar`.
- `runtime/probes/` — 7 temporary runtime probes. Some are mutating and must only be used on a disposable test copy.
- `docs/PROJECT_CONTEXT_FOR_NEW_CHAT.md` — detailed handoff context for a new ChatGPT conversation.
- `docs/ROADMAP_AND_STATUS.md` — current feature status and remaining work.
- `docs/INSTALLATION_AND_RUNTIME_ACCEPTANCE.md` — deployment cautions and runtime test expectations.
- `reports/` — source inventory, checksums and validation evidence.
- `tools/` — simple syntax and warehouse-dashboard test helpers.

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
```

The first command runs Node's syntax parser over all `.gs` files. The second runs the five pure warehouse-chart tests by loading the exact production chart helper and its test module. These checks do not emulate Google Sheets rendering, Apps Script services, triggers, Drive, LockService, or the full application's regression harness.

## Safe operating rules

1. Work on a restored/test spreadsheet, not the business workbook.
2. Take a fresh backup before replacing Apps Script modules.
3. Do not run Clean Start, imports, schema migration, restore, or destructive probes unless the specific test calls for them and the user has explicitly approved the effects.
4. Never rewrite historical `StockLedger`, `StockLots`, or committed operation payloads directly.
5. Do not report a feature as runtime-accepted based only on local syntax/Node tests.
6. For received-supply cost/quantity/date corrections, use a dedicated `SUPPLY_CORRECTION` + FIFO replay design. That operation is **not present** in this snapshot.

## Source-of-truth rule for future work

Treat this repository's `src/apps_script/` files as the latest code snapshot supplied on 2026-11-24. Before patching, inspect the exact current module and its callers. Do not mix in older standalone V1–V4 hotfix files from prior chat messages unless a diff proves that a newer source module is missing a change.
