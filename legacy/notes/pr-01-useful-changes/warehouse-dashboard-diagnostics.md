# Warehouse Dashboard chart diagnostics — archive note

PR #1 добавил в меню склада read-only команду:
- Label: `Диагностика диаграммы Dashboard (без изменений)`
- Handler: `di3LogWarehouseDashboardChartDiagnostics`
- Output: Apps Script execution log
- Intent: inspect Dashboard chart configuration/data without mutating workbook state.

The target branch already contains exploratory chart probes under `legacy/tests/warehouse-dashboard/`, including area-axis, combo, detail, chart-options, ordering, runtime and dashboard-order diagnostics. This note records the additional menu entry and handler integration from PR #1; it is not an executable replacement for those probes.

Source CI recorded for PR #1: [run 45885839074](https://github.com/brusvv/dots_inventory-/actions/runs/45885839074), with Warehouse Dashboard 9/9 and 154/154 total regression tests. Google Sheets runtime acceptance remains separate.
