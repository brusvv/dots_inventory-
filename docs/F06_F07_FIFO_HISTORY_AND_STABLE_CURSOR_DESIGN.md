# F-06 / F-07 — FIFO allocation history and stable cursors: design audit

Дата: 25.11.2026  
Статус: **design only; no application code or workbook data changed**

## Scope

- **F-06 — archive superseded FIFO allocations.** StockAllocations is the active projection. Product replay and full replay replace rows in that projection, so prior allocation snapshots are not retained as first-class history.
- **F-07 — remove physical row numbers from FIFO cursor semantics.** The current incremental engine uses fifo_ledger_cursor as a count of StockLedger data rows, reads the tail by physical row offset, and stores a per-product last ledger row number in FifoProductState.

No migration is proposed for immediate execution. Both changes affect recovery semantics and need a coordinated design before code is written.

## Source observations

### Current active allocation projection

In 24_DI3_IncrementalFifo.gs:

- di3ReplaceFifoProjectionSafely_ snapshots matching active allocation rows, deletes them, appends replacement rows and updates lot remaining caches.
- If a caught write error occurs, it attempts to restore the previous active allocation rows and lot-cache snapshot.
- Product replay replaces rows scoped to one product_id; full replay replaces the entire active allocation projection.
- New allocation rows retain the FIFO run ID and movement/lot/product identity, but replaced rows are not retained in a dedicated history table.

The rollback helper protects against caught write errors, but it cannot make multiple Google Sheets writes atomic against process termination between writes. An archive design must therefore account for interruption and recovery, not only normal completion.

### Current cursor semantics

The same module currently:

- derives the global cursor from the number of data rows in StockLedger;
- reads new events from cursor + 2 through the current last row;
- stores a physical last_row_number in FifoProductState;
- filters a product's new tail by comparing row._di3RowNumber with state[4];
- checks diagnostics by comparing the stored physical row number with the last physical row for that product.

This is efficient while StockLedger remains append-only and rows are never inserted, deleted, sorted or moved. It is not a durable identity for a ledger event. A maintenance action that changes physical row positions can make the cursor skip an event or process an event twice.

## F-06 recommended architecture

### 1. Keep StockAllocations as the active projection

Do not turn the current table into a mixed active/history dataset. Existing readers, return logic and Finance snapshots expect the active projection. Keeping this contract avoids broad query changes and accidental inclusion of superseded rows in cost/stock calculations.

### 2. Add a separate immutable allocation-history event log

Recommended logical fields:

| Field | Purpose |
|---|---|
| archive_event_id | Unique idempotent archive event |
| fifo_run_id | Replay run that superseded the prior projection |
| source_allocation_id | Original active allocation row identity |
| source_fifo_run_id | Run that originally created the allocation |
| movement_id, lot_id, product_id | Stable business references |
| allocation_type, quantity, unit_cost, cost_status, allocated_cost_minor | Exact allocation snapshot |
| effective_at, recorded_at | Original event timestamps |
| archived_at, reason | Archive provenance |

The history must be excluded from every active stock, return, COGS and finance aggregation unless a diagnostic explicitly asks for superseded versions.

### 3. Use a replay-scoped archive protocol

A simple “copy rows, then delete” sequence is insufficient because Google Sheets does not provide a transaction spanning multiple sheet writes.

Recommended protocol:

1. Create a durable replay/run record with a stable replay ID and intended product scope.
2. Append a PREPARED archive event containing the exact source allocation IDs and a deterministic source fingerprint.
3. Replace the active projection using the existing rollback-protected path.
4. Verify the new active projection against the replay plan and lot balances.
5. Append a COMMITTED archive event referencing the prepared event and replacement run.
6. Recovery inspects incomplete archive events: if the active projection still matches the old snapshot, it can safely abandon/retry; if it matches the replacement projection, it can complete the archive commit; if neither matches, quarantine for manual reconciliation.

The archive log itself should be append-only. State is derived from its latest event per replay ID, following the same event-log principle introduced for PeriodLocks. Do not mutate an archive row from PREPARED to COMMITTED.

### 4. Idempotency and retention

- Enforce uniqueness by replay_id + source_allocation_id.
- A retry must not archive the same source allocation twice.
- Never purge allocation history as part of routine FIFO rebuild.
- Retention/compaction, if ever needed, must be a separately approved maintenance operation with verified backup and export.
- Preserve the original source allocation ID, not only its row number.

## F-07 recommended architecture

### 1. Introduce a monotonic ledger sequence

Add a stable ledger_sequence to each newly appended StockLedger event. It must be assigned under the same mutation lock that registers the stock operation and must be immutable after append.

Requirements:

- Unique, strictly increasing positive integer.
- Retries that resolve to an existing event_key reuse the existing movement and sequence; they must not allocate a new sequence.
- Sequence allocation and ledger append must be in one guarded operation path.
- No sequence is derived from current row count after migration.
- Sorting or moving physical rows must not change the sequence.

A migration can backfill existing ledger events in their current physical append order, after first checking that movement IDs are unique and that no pending stock operations exist. This preserves the historical append order; it does not rewrite effective_at or recorded_at.

### 2. Change cursor meaning from row count to sequence watermark

- Global fifo_ledger_cursor becomes the highest committed ledger_sequence, not a physical row count.
- Incremental tail selection becomes ledger_sequence > cursor, regardless of physical row position.
- Per-product state stores last_processed_ledger_sequence (or equivalent watermark), not last_row_number.
- Product state still retains the latest business event tuple used by backdated-event detection: effective_at, recorded_at, movement_id.
- Diagnostics compare sequence watermarks and event identities, never physical row indexes.

The ledger can still be read as a range for performance, but row positions must be treated only as temporary access coordinates, not durable cursors.

### 3. Migration and compatibility

Use a schema migration only after the migration runner, baseline schema and backup/restore path are understood together.

Migration preconditions:

- Verified backup and restore-as-new test.
- No PREPARED/RETRYABLE/QUARANTINED stock operations.
- No active FIFO rebuild.
- Unique, non-empty movement IDs.
- Current FIFO integrity diagnostics have no errors.
- Existing global cursor equals the current ledger data-row count, or a documented bootstrap/full replay is performed.

Migration steps should be idempotent:

1. Add the sequence column without reordering existing columns unexpectedly; prefer append-only schema evolution.
2. Backfill sequence values from current physical append order.
3. Verify one-to-one coverage and strict monotonicity.
4. Rebuild FifoProductState with sequence watermarks.
5. Set the global cursor to the maximum sequence only after all verification succeeds.
6. Mark the new FIFO cursor version READY last.

Until the new version is READY, the old cursor path must not silently mix with the new one. Prefer an explicit version gate that forces a controlled bootstrap or refuses writes.

## Required regression and runtime tests

### F-06 archive tests

- Product replay archives exactly the previous active allocations for the affected product.
- Full replay archives all previous active allocations exactly once.
- Repeated replay/recovery does not duplicate archive records.
- Failure before projection replacement leaves the old active projection valid.
- Failure after replacement but before archive COMMITTED is recoverable from the replay ID and fingerprints.
- Archived allocations never affect stock, returns, COGS or Finance totals.
- Return after a later unrelated FIFO run still resolves the current active allocations for the original dispatch.

### F-07 cursor tests

- Insert or move physical rows in a test ledger while preserving ledger_sequence; tail selection remains correct.
- Sort the ledger physically; no event is skipped or duplicated.
- Retry an existing event key; no new sequence is allocated.
- Two concurrent stock registrations cannot allocate the same sequence.
- Recovery after state upsert but before global cursor update processes no event twice.
- Backdated event still triggers product replay based on business event ordering, independently of ledger sequence.
- Full replay and incremental replay converge to the same allocations, lot balances, movement costs and order snapshots.

## Implementation order

1. Implement F-07 sequence migration and version gate first, because F-06 replay recovery needs stable replay/run identity and deterministic input enumeration.
2. Add F-06 archive event log and recovery protocol.
3. Add property-style comparison: incremental result equals full replay result for generated event sequences.
4. Run source tests, then migration/recovery/concurrency acceptance on a disposable restored spreadsheet.
5. Only then consider any archive retention or ledger maintenance tooling.

## Explicit non-goals

- No change to FIFO business ordering: effective_at, then recorded_at, then movement_id remains authoritative.
- No negative stock allowance.
- No mutation of historical StockLedger events.
- No inclusion of archived allocations in active financial calculations.
- No live workbook migration or historical data rewrite in this design-only phase.

## Preferred path if the workbook is recreated from zero

The project owner confirmed that recreating the spreadsheet from an empty workbook is acceptable because little business data has been entered. This changes the preferred implementation strategy:

- Do not spend effort building a backfill migration for the current physical-row cursor if the production workbook can be recreated before release.
- Put ledger_sequence directly into the initial StockLedger schema and assign it on every new stock event under the stock-operation lock.
- Put the allocation-history event table directly into the baseline schema, so the first FIFO projection replacement is archived using the PREPARED / COMMITTED protocol.
- Initialize the global cursor and per-product state against sequence watermarks from the first event; never create a production workbook that starts with row-number cursor semantics and later upgrades them.
- Keep the existing v3 business tables only where their semantics remain correct. A clean workbook is not a reason to discard tested order, commission, supply or money rules.
- Build the setup/installation path to create the complete baseline schema in one version, then verify backup/restore, setup idempotency and empty-workbook acceptance before importing or entering business data.

Under this path, the F-07 backfill procedure becomes a test-only compatibility case for old workbooks, not a required production rollout step. F-06/F-07 still require the same replay, idempotency, fault-injection and concurrency tests; starting empty removes legacy-data migration risk, not correctness requirements.

Recommended implementation order for a clean workbook:

1. Freeze the target baseline schema and version identifier.
2. Implement stable ledger_sequence allocation and cursor semantics.
3. Implement the append-only allocation archive protocol and recovery.
4. Extend setup and restore-as-new to create/rebind every new table and metadata key.
5. Run empty-workbook setup twice, then synthetic supply → receipt → FIFO → dispatch → return → finance scenarios.
6. Only after acceptance, create the production workbook and enter/import real data.

## Implementation specification

See `docs/F07_STABLE_LEDGER_SEQUENCE_IMPLEMENTATION_SPEC.md` for the source-verified schema changes, the four current ledger writer paths, sequence allocation under ScriptLock, narrow-column tail discovery, recovery requirements, test matrix, and clean-baseline versioning constraints.

An important design refinement: sequence allocation should not depend on a separately incremented metadata counter. The implementation specification proposes deriving the next block from the maximum validated sequence in the narrow ledger_sequence column while holding ScriptLock. This avoids a split-write counter reservation problem and remains independent of physical row order. Tail discovery likewise scans the sequence column and fetches only matching full rows.
