# F-01 patch — order return FIFO lookup (25.11.2026)

## Defect

`di3BuildOrderReturnPayload_()` previously selected dispatch allocations from `StockAllocations` only when `allocation_run_id` equalled the globally latest committed `FifoAllocationRuns.run_id`.

This is invalid for the current data model. `StockAllocations` is a compact active projection, not a snapshot belonging to one global run. Incremental FIFO runs append allocations for the products they touch; product replays replace active allocation rows only for the affected product. Valid rows for different products can therefore retain different `allocation_run_id` values. A later unrelated stock movement can advance the global latest run without invalidating an earlier order's dispatch allocations.

The old filter therefore produced an empty allocation set for an earlier dispatch and rejected the return with a quantity mismatch. It failed closed (no return stock movement was created), but blocked a valid return.

## Change

- Added `di3SelectOrderDispatchConsumeAllocations_()`: selects only `CONSUME` allocations whose `movement_id` matches one of the order's original `dispatch_movement_id` values.
- Added `di3GetOrderItemReturnAllocations_()`: scopes those rows to one order line and retains the exact quantity check. Missing dispatch movement IDs and partial/mismatched quantities still stop the return before operation registration.
- Removed the dependency on `di3GetLatestFifoAllocationRun_()` from `di3BuildOrderReturnPayload_()`.
- Kept FIFO run metadata as provenance: `source_fifo_run_ids` lists the distinct run IDs present on the selected active allocation rows; `source_fifo_run_id` remains populated only when there is exactly one source run.
- Return lots continue to use the original source lot ID, pack variant and exact allocated cost. The return still creates new inbound lots on the return date and does not rewrite the original dispatch movement or source lots.

## Regression tests

`18_DI3_OrderTests.gs` now covers:

1. Selection of the original dispatch `CONSUME` allocations tagged with an older run while an unrelated movement exists in a later run.
2. Continued rejection when the selected allocation quantity does not equal the order-line quantity.
3. Full return-payload construction using original source lots and costs while a stubbed latest global run is newer; the payload builder must not query the latest global run.

Local result: `node tools/run_order_domain_tests.js` — **16 passed / 0 failed**. All 49 `.gs` files pass the syntax check. Other local regression runners also pass: Dashboard 7/7, Supply UX 9/9, Catalog/Order UX 12/12 and System Safety UX 11/11.

## Runtime acceptance — still required

Use only a restored disposable Google Sheets copy with a fresh verified backup.

1. Create or choose a disposable order A with one or more stock-backed lines and record its `dispatch_movement_id` values.
2. Dispatch A and verify its `StockAllocations` rows contain `CONSUME` allocations linked to those movement IDs.
3. Perform a separate stock operation that creates a later committed FIFO run. Prefer a different product so the active allocation rows for A remain tagged with the older run.
4. Mark A as returning and accept its return.
5. Verify that exactly the source quantities return, return lots reference the original source lot/cost values, the return operation is COMMITTED, and FIFO/valuation remain consistent.
6. Separately test that a deliberately inconsistent/partial allocation is rejected before the return operation creates any stock movement.

Do not test with a production order or production stock. Local tests do not emulate Apps Script services or prove the full return operation in a real workbook.

## Scope and rollback

Modified: `16_DI3_OrderWorkflow.gs`, `18_DI3_OrderTests.gs`, `tools/run_order_domain_tests.js`, and project documentation/reports. No schema change is required. Roll back by restoring the previous source version from Git/ZIP; no workbook migration or historical data rewrite is part of this patch.