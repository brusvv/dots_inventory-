# UX patch UX-10 — confirmation for manual warehouse movements

**Date:** 25.11.2026  
**Base:** RC8 working tree after UX-01–UX-09.

## Finding

`di3SubmitWarehouseManagerForm()` previously validated the warehouse form and called `di3PostManualStockMovement()` immediately after the menu action. A single misclick could create a manual stock movement, append StockLedger/StockMovementDetails rows, create a FIFO lot for inbound movements or trigger FIFO expense allocations for outbound movements.

## Change

The handler now creates a normalized, read-only command preview using `di3BuildManualMovementCommand_()` before posting. It opens a YES/NO confirmation that displays direction, product, reason, effective date, quantity, inbound cost status/unit cost or offline-sale unit price/revenue, comment, and the actual inventory/FIFO effect. Only YES calls `di3PostManualStockMovement()`. NO returns `CANCELLED_BY_USER` before the stock operation is registered. The posting function repeats validation under its existing lock; the form request token/idempotency behavior is preserved.

## Files changed

- Modified: `08_DI3_WarehouseManager.gs`.
- Extended regression tests: `41_DI3_SystemSafetyUxTests.gs`.
- Extended local test runner: `tools/run_system_safety_ux_tests.js`.
- Updated menu/runtime documentation and validation reports.

## Validation

- Syntax: 49/49 `.gs` files PASS.
- Supply Workspace UX: 9/9 PASS.
- Catalog/Order UX: 12/12 PASS.
- System Safety UX: 11/11 PASS.
- Warehouse Dashboard: 5/5 PASS.
- TypeScript AST: 549 top-level functions, 87 top-level variables, no parse errors or duplicate declarations.
- Menu audit: 68 actions, 0 missing handlers.

These are local source tests. The real YES/NO dialog and its No path must still be accepted on a restored Google Sheets test copy. No manual stock movement or business operation was executed.
