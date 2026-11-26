# F-19 — FIFO replay and recovery regression coverage

Дата: 25.11.2026  
Статус: **source CI executed; 42/42 PASS; Apps Script runtime acceptance pending**

## Purpose

F-19 strengthens deterministic, pure-domain regression coverage for the FIFO replay engine. The tests use in-memory ledger, movement-detail and lot fixtures. They do not call SpreadsheetApp, write sheets, create operations, alter the live workbook or run a FIFO rebuild.

## Added scenarios

The existing Stock Core suite in src/apps_script/09_DI3_StockCoreTests.gs now includes:

1. **Incremental/full replay equivalence.** A committed historical prefix is represented by FifoProductState and remaining-lot cache; a new inbound plus outbound tail is evaluated incrementally. Its allocation lots, quantities, minor-unit costs, movement cost and final lot balances are compared with a full replay of the complete event history.
2. **Backdated event.** A newly recorded receipt whose effective timestamp precedes the product state must return PRODUCT_REPLAY_REQUIRED / BACKDATED_EVENT. Full replay must recalculate the original outbound allocation against the newly oldest lot.
3. **Partial-application recovery.** A tail OUT movement that already has an allocation row must request product replay rather than append duplicate incremental allocations.
4. **UNKNOWN and FREE cost semantics.** UNKNOWN allocations keep null cost and contribute to unknown quantity; FREE allocations retain zero unit cost and zero minor-unit allocated cost. A mixed outbound remains PARTIAL rather than being silently valued as zero.
5. **Same-timestamp deterministic ordering.** When effective_at and recorded_at are equal, movement_id is the final ordering key. An inbound that sorts before an outbound is available; the reverse ordering is rejected for insufficient stock.

Existing tests also continue to cover historical stock insufficiency, backdated receipts, FIFO splitting, remaining quantities, valuation coverage and money rounding.

## Test runner

Added tools/run_fifo_replay_tests.js. It loads the pure schema, product identity, repository, Money Core, Stock Core, Incremental FIFO and Stock Core test modules in a Node VM, then executes di3RunStockCoreUnitTests().

Run locally from the repository root:

```bash
node tools/run_fifo_replay_tests.js
```

The runner exits non-zero if any test fails.

## Boundaries and remaining acceptance

- **Executed by GitHub Actions:** run [45864704114](https://github.com/brusvv/dots_inventory-/actions/runs/45864704114), head `0257f3c9faef202bd8224e208e2adc1b5f83de9a`, reports FIFO replay **42 passed / 0 failed**. The same CI run passed syntax checks for all 50 `.gs` files and all six other regression suites (147/147 total).
- The pure suite does not simulate Google Sheets write interruption, OperationExecutor persistence, LockService contention, or recovery after a process terminates between sheet writes.
- No Apps Script, schema, workbook, StockLedger, StockLots, StockAllocations, FifoProductState or cursor values were changed.
- No full FIFO rebuild or stock operation was executed.

## Next validation

1. Keep the passing CI runner as the source-level regression gate; rerun it after any FIFO change.
2. Add/execute a disposable-workbook fault-injection suite for interruption points in `di3RebuildFifoAllocations_` and OperationExecutor recovery. This must not run against the live workbook.
3. On a restored copy, compare incremental and full replay outputs and run F-01 return acceptance after a newer unrelated FIFO run.
4. Separately design and test an owner-controlled resolution path for a quarantined FIFO replay. The existing OperationExecutor quarantine release is not a substitute for resolving a `FifoReplayEvents` quarantine.
