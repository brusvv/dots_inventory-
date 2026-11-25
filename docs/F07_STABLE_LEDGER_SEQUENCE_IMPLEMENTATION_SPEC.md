# F-07 — stable StockLedger sequence: implementation specification

Date: 2026-11-26  
Status: source implementation pass; CI verified; Apps Script runtime acceptance and workbook changes remain pending.

## Decision

For the clean release workbook, StockLedger events receive an immutable positive integer `ledger_sequence`. This is an ingestion/cursor identity only. FIFO business ordering remains:

1. `effective_at`
2. `recorded_at`
3. `movement_id`

The sequence must never replace that ordering or be used to decide which lot is consumed first.

## Source implementation progress — 26.11.2026

The first source implementation pass is now present on `main`:

- `DI3_TABLE_SCHEMAS.StockLedger` appends `ledger_sequence` as column 13.
- `FifoProductState` keeps the existing fifth field position but renames it to `last_processed_ledger_sequence`.
- `DI3_FIFO_STATE_VERSION` is now `"4"`.
- `di3ReadLedgerSequenceIndex_()` scans the movement ID, product ID and sequence columns, rejects missing/invalid/non-positive/duplicate sequences, and returns the maximum sequence plus physical row locations for targeted reads.
- `di3AllocateLedgerSequenceBlock_()` requires the current execution to own the nested ScriptLock and allocates max+1…max+N. Gaps are accepted; duplicates and invalid populated rows fail closed.
- `di3AssignLedgerSequencesToLines_()` stores assigned values in immutable operation payload lines. The manual stock payload stores a single sequence directly.
- The four stock-operation writers now append the persisted sequence as the final StockLedger field. Their row builders reject absent or invalid sequence values before writing.
- The incremental tail reader scans the sequence index, fetches full-width data only for rows above the committed cursor, groups physically adjacent reads, orders the returned tail by sequence, and revalidates movement ID / product ID / sequence against the index to fail closed if a physical sort occurs during the read.
- Global metadata now uses `fifo_ledger_sequence_cursor`; the old row-count cursor is no longer read or written by the FIFO module.
- Product state records the maximum processed sequence separately from the business event tuple. Full replay and incremental replay both preserve the existing business comparator.
- Integrity diagnostics validate sequence uniqueness and compare product/global watermarks to maximum sequence values, not physical row counts.
- Added unit coverage for reordered physical rows, sequence gaps, duplicate/missing sequence values, lock-required allocation, and business-date ordering independent of ingestion sequence. Existing actor-attribution fixtures now provide the required sequence.
- Added a GitHub Actions quality-gates workflow and included the sequence helper in the System Safety test runner.

**Source verification:** Latest GitHub Actions run `45712426217` completed successfully. JavaScript syntax check passed for all 50 `.gs` files. All seven local suites passed: FIFO 34/34, Order Domain 17/17, Supply Workspace UX 15/15, Catalog/Order UX 12/12, System Safety UX 18/18, Warehouse Dashboard 9/9, Finance Schema 4/4 — **109/109 tests, 0 failures**. Run: https://github.com/brusvv/dots_inventory-/actions/runs/45712426217. Apps Script runtime acceptance has not been performed.

This implementation pass is not a release-ready F-07 sign-off. It still requires source review, execution of all local runners and syntax checks, and runtime acceptance on a disposable empty workbook. It is not compatible with the old 12-column StockLedger layout; do not deploy it to the existing workbook. The clean-baseline adoption and legacy-workbook isolation remain prerequisites before production installation.

## Initial pre-implementation source state (audit baseline)

- `DI3_TABLE_SCHEMAS.StockLedger` currently has 12 columns and no stable event sequence.
- `DI3_FIFO_STATE_VERSION` is currently `3`.
- `FifoProductState[4]` is named `last_ledger_row_number`.
- `fifo_ledger_cursor` is currently a count of physical StockLedger data rows.
- `di3ReadFifoLedgerTail_` reads rows at physical offset `cursor + 2`.
- `di3RebuildFifoAllocations_` uses `row._di3RowNumber` to decide which product-tail events have already been processed.
- Integrity diagnostics compare the global cursor with ledger row count and the product state with physical row positions.

These are correct only while the physical ledger order is preserved.

## Proposed clean-baseline schema

### StockLedger

Append one field at the end of the existing logical schema:

- `ledger_sequence`: positive integer, immutable, unique across all StockLedger events.

Appending at the end minimizes disruption to the existing positional readers. The clean-install schema must create the 13-column table from the start.

### FifoProductState

Keep the existing field position (index 4), but rename the field to:

- `last_processed_ledger_sequence`

The field is the highest ledger sequence included in that product's current FIFO state. It is not the sequence of the latest business-dated event; that remains represented by the separate `last_effective_at`, `last_recorded_at`, and `last_movement_id` tuple.

### App metadata

Replace the ambiguous row-count key `fifo_ledger_cursor` with:

- `fifo_ledger_sequence_cursor`: highest sequence included in the committed FIFO projection.

Bump `DI3_FIFO_STATE_VERSION` from `3` to `4`. A missing or mismatched v4 cursor must block incremental processing and require a controlled full replay/bootstrap. It must never silently reinterpret an old row count as a sequence.

## Sequence allocation — important implementation choice

Do not keep a separately incremented `next_sequence` counter in _AppMeta. Updating a counter and appending a ledger row are separate Google Sheets writes; a process interruption between them can create an ambiguous reservation.

Instead, allocate under the existing ScriptLock:

1. Read only the `movement_id`, `product_id` and `ledger_sequence` columns from StockLedger.
2. Validate that every populated sequence is a positive integer and that there are no duplicates.
3. Find the maximum existing sequence.
4. Assign the next contiguous block `max + 1 ... max + N` to the new operation's lines.
5. Store these values in the immutable operation payload before the operation is registered.

This is an O(N) read of three narrow columns, not a full-width ledger read. It is robust to physical sorting or moving of ledger rows. For the expected small-to-medium inventory ledger, correctness is preferred over a fragile counter optimization. Benchmark this column-only scan in C-01 before considering a more elaborate index.

A rejected operation may leave a sequence gap only if its sequence was persisted in a rejected immutable payload but no ledger event was appended. Gaps are valid; uniqueness and monotonic allocation among newly created operations matter more than contiguity. A pending operation blocks other stock mutations, so a lower sequence from a still-recoverable operation cannot be appended after the global cursor has advanced past it.

## All current StockLedger writer paths to update

The source audit identified these domain builders/writers:

1. Manual warehouse movement: `07_DI3_StockCore.gs`
   - The public entry point already runs inside `di3WithLock_`.
   - After the idempotency check and before `di3RegisterPreparedOperation_`, add `ledger_sequence` to the immutable stored payload.
   - `di3ApplyManualStockOperation_` must place it in the appended ledger row.
   - Recovery reuses the stored sequence; it must never allocate a new one.

2. Supply receipt: `12_DI3_SupplyReceiving.gs`
   - `di3ReceiveSupply_` is reached from the lock-wrapped public receive function.
   - Allocate a sequence block for all payload lines before operation registration.
   - `di3BuildSupplyReceiptRows_` appends the sequence as the final StockLedger cell.
   - Recovery uses the persisted sequence block.

3. Order dispatch: `16_DI3_OrderWorkflow.gs`
   - `di3AdvanceOrderStatus` is lock-wrapped.
   - The dispatch payload builder assigns one sequence per line.
   - Preflight and execution rows carry the same sequence.
   - Recovery uses the immutable payload.

4. Order return: `16_DI3_OrderWorkflow.gs`
   - Same lock/idempotency pattern as dispatch.
   - Every return movement line receives a sequence.
   - Recovery uses the persisted sequence.

No sequence may be assigned inside a recovery handler or at the time of retry.

## Tail discovery without physical row semantics

A stable sequence must also work if StockLedger rows are sorted or moved. Therefore, do not read `cursor + 1` as a physical row offset.

Implement a narrow-column tail reader:

1. Read the movement ID, product ID and sequence columns with their sheet row positions; validate that every populated event has all three values.
2. Select rows whose sequence is greater than the global cursor.
3. Fetch full StockLedger rows for only those row positions, grouped into contiguous ranges to reduce service calls.
4. Attach sequence values to the returned row arrays using the schema index.
5. Sort or group as needed in memory; never infer sequence from row position.

This is O(N) over one numeric column and O(K) full-width reads for K tail rows. It remains correct after physical sorting. The number of service calls should be measured; adjacent tail rows should be grouped into a single range read.

## FIFO state and recovery changes

- `di3BuildFifoProductStateRows_`: store the maximum `ledger_sequence` for each product, not a row number.
- `di3BuildIncrementalFifoProductStateRow_`: update the product watermark with the maximum sequence in the processed tail.
- `di3BuildFifoTailPlanForProduct_`: filter unprocessed tail rows using `ledger_sequence > last_processed_ledger_sequence`.
- `di3RebuildFifoAllocations_`: set the global cursor to the maximum sequence represented in the successfully committed projection, not the ledger row count.
- `di3EnsureIncrementalFifoReady_`: validate cursor against the maximum sequence, not `getLastRow() - 1`.
- Integrity diagnostics: validate unique positive sequences, global cursor coverage, per-product sequence watermarks, and absence of unprocessed ledger sequences.
- Full replay: calculate sequence watermarks from all ledger rows while retaining the existing effective/recorded/movement event comparator.
- Recovery after state upsert but before global cursor update must remain idempotent: product watermarks suppress already-applied events, and the global sequence cursor advances only after the projection is committed.

## Regression tests required before runtime acceptance

1. New stock events receive unique positive sequences.
2. A multi-line operation receives a unique ordered block.
3. Repeated idempotency key returns the stored payload and does not allocate another sequence.
4. Recovery after ledger append reuses the exact sequence values.
5. Physical row sort/reorder does not skip or duplicate tail events.
6. A gap in sequence values is accepted and does not stall the cursor.
7. Duplicate, blank or nonnumeric populated sequences fail closed.
8. Backdated business event triggers product replay even when its ledger sequence is newer.
9. Incremental replay and full replay converge to identical allocations, lot balances, movement costs and order snapshots.
10. Recovery between product-state upsert and global cursor update remains idempotent.
11. Concurrent stock operations cannot allocate duplicate sequences because allocation occurs inside `di3WithLock_`.
12. Full replay diagnostics do not compare sequence values with physical row counts.

## Clean-install and legacy compatibility

- The production workbook should be created only from the final baseline schema containing the 13-column StockLedger and sequence-based FifoProductState from the first event.
- Do not silently migrate an existing v3 workbook by interpreting `fifo_ledger_cursor` as a sequence.
- If old RC8 workbooks remain supported, provide a separately reviewed one-way migration with backup, pending-operation gate, uniqueness checks and full replay. That migration is not required for the new clean production workbook.
- The schema-versioning code currently assumes baseline v1 plus sequential migrations through v3. A clean final baseline cannot simply set `DI3_SCHEMA_VERSION` higher while retaining that initialization path. Before release, versioning must distinguish (a) adoption of a complete clean baseline and (b) explicit legacy upgrade paths. Do not mark the new baseline ready until all required schema headers and FIFO metadata are verified.

## Performance notes

The proposed algorithm deliberately trades a three-column narrow scan for independence from physical row positions. It avoids downloading the full width of the ledger for normal tail discovery. C-01 must measure this at 500, 1,000, 2,000 and larger synthetic movement counts. If the one-column scan becomes dominant, consider a separately designed immutable sequence index; do not revert to row-number cursor semantics.
