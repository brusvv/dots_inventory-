# Legacy scripts and tests

This directory preserves standalone scripts and diagnostics from earlier development branches.

## Structure

- `scripts/` — archived utility or staging scripts that are not part of the active Apps Script deployment.
- `tests/` — archived test functions and manual runtime probes.

## Historical supply batch import

The historical batch import module is a read-only staging implementation. It validates a source register and deliberately does not write to Supplies, Operations, StockLedger, StockLots, or FIFO. Its batch commit remains fail-closed. The associated test function is preserved separately under `tests/`.

The module is archived and is not wired into the active spreadsheet menu.

## Warehouse dashboard probes

The dashboard probes are manual diagnostics for chart layout, axis behavior, options, ordering, and runtime state. They are retained for reference and are not part of the production Apps Script source.

Production changes from the old dashboard-probe branch were not copied wholesale: that branch diverged substantially from the FIFO branch and its `19_DI3_WarehouseViews.gs` contains unrelated older code differences. Only the standalone diagnostic probes are archived here.
