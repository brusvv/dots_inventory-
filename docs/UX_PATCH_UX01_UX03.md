# UX patch — UX-01 through UX-03

**Date:** 2026-11-25  
**Base:** user-provided `40.rar` / repository snapshot dated 2026-11-24  
**Scope:** source patch only; no Google Sheets workbook, stock data, deployment, trigger, or FIFO operation was changed or executed.

## UX-01 — protect `Новая поставка`

Added a SHA-256 fingerprint over editable form fields: B3:B8, G2:G7, A12:D31 and M9. Derived calculation output and selector B2 are excluded. The fingerprint is held in hidden N8. The baseline is refreshed after a new-form reset, document load, successful draft save and successful stage transition. If a non-empty form has no baseline (older workbook), it is treated conservatively as potentially dirty. `Новая поставка` prompts before clearing; the internal historical-entry path bypasses the second prompt only after its own explicit confirmation.

## UX-02 — protect B2 switching

A normal installable onEdit trigger cannot safely pause for a modal confirmation. Therefore, when the form is dirty and B2 changes, the handler stores the requested number in hidden N9, remembers the previous selector in N10, restores B2 and displays a toast explaining the explicit confirmation path. The user then runs `Поставки → Выбор и просмотр → Загрузить выбранную поставку…`. That menu action prompts before replacing form contents; No retains the old document and form, Yes loads the requested target and resets the baseline. FULL_EDIT blocks selector changes and restores B2.

The state hash is refreshed after persistence so successfully saved draft/stage edits do not produce false dirty warnings. A cancellation that occurs while the matching form has unsaved edits or FULL_EDIT active leaves the form intact instead of clearing it inside the operation lock.

## UX-03 — read-only FIFO check vs full rebuild

The old `Полная сверка FIFO` label was misleading: its handler performed a full FIFO rebuild. It is replaced with two menu commands:

- `Проверить целостность FIFO (без изменений)` calls only `di3GetFifoIntegrityDiagnostics_()`, presents a summary and logs the complete report.
- `Перестроить FIFO полностью…` explicitly describes the mutating operation and requires YES before lock acquisition, backup creation and FIFO rebuild. A No response returns `CANCELLED_BY_USER`.

## Changed files

Modified: `11_DI3_SupplyDomain.gs`, `12_DI3_SupplyReceiving.gs`, `22_DI3_MenuAndFilterUtils.gs`, `24_DI3_IncrementalFifo.gs`, `34_DI3_HistoricalSupply.gs`, `36_DI3_SupplyFullEdit.gs`.  
Added: `39_DI3_SupplyWorkspaceUxTests.gs`, `tools/run_supply_workspace_ux_tests.js`.  
Documentation/reports updated: README, project context, roadmap, installation/runtime acceptance, source index, menu snapshot, checksum/inventory and static validation.

## Validation

- `.gs` syntax: **47 files PASS**.
- `di3RunSupplyWorkspaceUxUnitTests()`: **9 passed / 0 failed** (local Node VM, exact source functions).
- `di3RunWarehouseDashboardUnitTests()`: **5 passed / 0 failed**.
- TypeScript AST: **532 top-level functions**, **86 top-level variable declarations**, no parse errors, no duplicate top-level names.

These are local checks, not Google Apps Script acceptance. The installable trigger, real prompts/toasts, and no-write FIFO diagnostic still require verification on a restored test spreadsheet. The blank warehouse Dashboard chart remains an open issue and was not modified by this patch.
