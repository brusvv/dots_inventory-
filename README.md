# Dots Inventory v3 — RC8 source snapshot

**Snapshot date:** 2026-11-24  
**Source archive:** user-supplied `DI3_RC8_Repository_2026-11-24(1).zip`  
**Source tree:** `src/apps_script/` (39 Apps Script modules) and `runtime/probes/` (7 probes).

## Contents

- `src/apps_script/` — current RC8 source modules and Apps Script tests.
- `runtime/probes/` — temporary runtime probes. Review each probe's safety classification before use; some are mutating.
- `docs/` — project context, roadmap, runtime acceptance, module index, probe notes and supply menu notes.
- `reports/` — source provenance, checksums, inventory and validation record.
- `tools/` — JavaScript syntax and Warehouse Dashboard unit-test helpers.

## Reproduce local checks

```bash
bash tools/check_syntax.sh
node tools/run_warehouse_dashboard_tests.js
```

These checks do not emulate Google Sheets rendering or a complete Apps Script runtime.

## Important omissions

The supplied snapshot does not include `appsscript.json`, `.clasp.json`, the previous full Node regression harness, or the original repository history. No manifest, script ID, secrets or deployment binding has been fabricated. Recover the actual manifest and local clasp binding from the bound Apps Script project before deployment; do not commit `.clasp.json`.

## Safety

Use a restored/test spreadsheet. Back up before code replacement or risky setup. Never rewrite committed StockLedger, StockLots or operation payloads directly. Received-supply cost/quantity corrections require a separately designed `SUPPLY_CORRECTION` operation, which is not implemented in this snapshot.

## Source of truth

Treat `src/apps_script/` in this commit as the supplied RC8 source snapshot dated 2026-11-24. Runtime acceptance remains separate from static/local tests.
