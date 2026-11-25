# C-01 / F-09 — Performance audit and benchmark plan

Date: 2026-11-26  
Scope: source inspection and benchmark design only. No workbook, Apps Script runtime, schema, ledger, or business data was changed.

## Executive summary

The current FIFO implementation already has an incremental path: normal operations read the append-only StockLedger tail after the persisted cursor. A full ledger/detail/lot read is reserved for full replay or invalid/uninitialized cursor state.

The main scaling risk is not the tail read itself. In the incremental branch, the code performs several tagged lookups for each affected product. Depending on the implementation of the shared row-search helpers, this can repeatedly scan the same sheets. A multi-product operation can therefore cost materially more than a one-product operation even when the new ledger tail is small.

The stock journal is intentionally a full-history view today. Each refresh reads StockLedger, StockMovementDetails, StockLots, active StockAllocations, products and product codes, builds lookup maps, calculates movement cost, and sorts the complete result. This is simple and consistent, but its cost grows with the full history and should not be invoked unnecessarily after unrelated UI actions.

No performance thresholds are declared yet: there are no reliable runtime measurements from the target Apps Script workbook.

## Source observations

### FIFO incremental path

In src/apps_script/24_DI3_IncrementalFifo.gs:

- di3RebuildFifoAllocations_() reads getLastRow() and cursor metadata first.
- When the cursor is valid and affected product IDs are supplied, it calls di3ReadFifoLedgerTail_() and reads only rows appended after the cursor.
- It then loops through each affected product and separately reads that product's StockLots, FifoProductState, StockMovementDetails for tail movement IDs, and StockAllocations for tail movement IDs.
- If the tail plan requires a product replay, it additionally reads that product's full StockLedger history and corresponding movement details.
- Full replay reads all StockLedger, StockMovementDetails and StockLots rows and rebuilds the complete projection.

This means incremental mode avoids downloading the entire ledger in the common case, but the number of sheet-search operations grows with the number of affected products. The exact cost depends on the shared row-search helper implementation and Google Sheets service latency.

### Stock journal

In src/apps_script/19_DI3_WarehouseViews.gs, di3BuildStockJournalRows_():

- Reads all StockLedger, StockMovementDetails and StockLots rows.
- Loads all active allocations, products and product codes.
- Builds in-memory maps for details, lots and movement costs.
- Materializes every movement into a journal row and sorts the complete history by effective and recorded timestamps.

This is an O(N) full-history refresh with additional map construction and O(N log N) sorting. It is appropriate as a correctness baseline, but it is a candidate for lazy refresh, bounded display windows, or a cached projection after measurement. Any bounded view must preserve filters and must not hide pending-operation warnings.

### Safety constraints for optimization

- Do not replace FIFO event ordering: effective_at, then recorded_at, then movement_id.
- Do not weaken historical replay or insufficient-stock fail-closed checks.
- Do not treat StockAllocations as an immutable full-history table; it is the active projection.
- Do not introduce caches that can survive a write without an explicit invalidation/version contract.
- Do not use a journal with pending operations for reconciliation or period close.
- Do not change the meaning of operation idempotency, immutable payloads, or recovery.

## Benchmark matrix

Run only on a disposable restored workbook with synthetic or explicitly disposable data. Record the workbook size and Apps Script execution environment.

| Case | Dataset / operation | Measurements |
|---|---|---|
| B1 | 500 ledger movements, 1 affected product | wall time, read/write calls, rows read/written |
| B2 | 1,000 movements, 1 affected product | same |
| B3 | 2,000 movements, 1 affected product | same |
| B4 | 2,000 movements across 20 affected products | same; isolates per-product lookup overhead |
| B5 | One backdated event requiring product replay | replay rows, time, writes |
| B6 | Full FIFO rebuild at 500 / 1,000 / 2,000 movements | time, rows read/written, allocations rebuilt |
| B7 | Stock journal refresh at 500 / 1,000 / 2,000 movements | time, rows read, sort/materialization time |
| B8 | Warehouse dashboard refresh at the same sizes | time, rows read/written, chart update time |

For each case, run 3–5 rounds after one warm-up and report median and maximum. Capture Apps Script execution logs and the function result. Do not infer performance from local Node tests.

## Instrumentation plan

Use a temporary, opt-in diagnostic wrapper in a disposable copy only. It should record:
- start/end timestamps and elapsed milliseconds;
- getValues, getDisplayValues, setValues, setValue, clearContent and TextFinder.findAll call counts where practical;
- total rows and cells read/written;
- product count, tail movement count, replay movement count and allocation count;
- execution result and error.

Instrumentation must be disabled by default and removed or left inaccessible in production. Avoid logging payloads, customer details or full business rows.

## Optimization candidates — only after baseline

1. Batch per-product reads. For multi-product FIFO operations, load relevant product rows in one pass per sheet and partition in memory, rather than performing repeated sheet searches per product. Keep a threshold/fallback if the batched range would be larger than selective reads.
2. Batch related lookups. Reuse already-read detail, allocation and lot rows inside one rebuild invocation; do not re-read the same sheet/key set in nested helpers.
3. Journal windowing. Separate complete source-of-truth calculation from the visible journal window. Read/filter by date or movement range where safe; retain an explicit full-history mode for audit and reconciliation.
4. Refresh isolation. Refresh only views affected by a mutation. Do not refresh the complete journal/dashboard after operations that do not change their dependencies.
5. Avoid premature caching. Any persistent cache must be keyed by schema/data version and invalidated on every relevant append, edit, replay, restore and migration.

## Exit criteria

C-01 is not complete until the benchmark matrix has real Apps Script measurements and identifies the dominant cost. F-09 performance work should then target the measured bottleneck, with correctness regression tests and before/after comparisons. No speed claim is made by this source audit.
