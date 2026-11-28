# SUPPLY_CORRECTION implementation specification

Status: SC-01 read-only source mapping audit is implemented and CI-covered. The correction operation, event schema, FIFO replay integration and runtime execution remain disabled.
Branch: `feature/supply-correction-fifo-replay`
Date: 2026-11-28

## 1. Purpose

Allow a received supply document to be corrected without deleting or rewriting the original receipt operation, StockLedger movements, FIFO lots, historical cost snapshots, or prior allocation archives.

The correction replaces the effective stock contribution of the original receipt lines and replays FIFO from the original business timestamp. It is not a same-day stock write-off and re-receipt.

## 2. Invariants

1. The original `SUPPLY_RECEIVE` operation and its immutable payload remain unchanged.
2. Original StockLedger, StockMovementDetails, StockLots and ProductCostHistory rows remain unchanged.
3. A correction is a new immutable `SUPPLY_CORRECTION` operation with a unique correction ID and a reason.
4. The original receipt is verified as COMMITTED and its payload hash is verified before a correction candidate can be built.
5. Every source receipt line must map to exactly one original ledger movement, one detail row and one lot. Ambiguous or incomplete source mapping blocks correction.
6. Replacement receipt events retain the original receipt `received_at` as `effective_at` and the original receipt `recorded_at` as the FIFO tie-break timestamp. A new `ledger_sequence` is assigned when the replacement row is appended. The correction's actual recording time is stored in `SupplyCorrectionEvents.created_at` and the correction operation; it must not silently reorder same-effective-time sales.
7. Corrected quantities are derived only from `packs × units_per_pack`; the corrected pack variant must belong to the same product and have exactly the requested pack size.
8. Discounts and shipping are recalculated using the existing `di3BuildSupplyFinancialPlan_` largest-remainder allocator. Unit costs retain full precision; display rounding must not be fed back into FIFO.
9. A correction never changes order dispatch/return events. It changes FIFO allocations and downstream cost snapshots through replay.
10. The active StockAllocations and StockLots.remaining_quantity remain projections. Replaced allocation rows and lot-cache values are preserved by the existing F-06 archive protocol.
11. The effective FIFO stream must exclude superseded original receipt movements and include their replacement movements. A simple compensating OUT movement at the current date is incorrect.
12. Retry/recovery must be idempotent at every persistence boundary. Ambiguous source/target states go to quarantine, never automatic overwrite.

## 3. Immutable correction payload

The operation payload should contain only the information required to reproduce and recover the correction; do not embed an unbounded copy of all allocations or the entire product ledger.

Required shape (illustrative):

- `schema_version`
- `correction_id`
- `supply_id`, `supply_number`, `reason`
- `source_receipt_operation_id`, `source_receipt_payload_hash`
- `source_supply_fingerprint`, `source_receipt_fingerprint`
- `source_movement_ids[]` and `source_lot_ids[]` (exactly mapped from original receipt lines)
- `before_supply_row[]`, `before_item_rows[]`
- `after_supply_row[]`, `after_item_rows[]`
- `replacement_lines[]` with new supply item IDs where needed, new movement IDs, new lot IDs, event keys, ledger sequence, pack variant identity, quantities, unit costs, full line amounts, effective and recorded timestamps
- `affected_product_ids[]`
- `candidate_fifo_input_fingerprint`
- `created_at`

Payload size must remain within the existing OperationPayloads cell limit. Allocation archives stay in the dedicated F-06 archive tables.

## 4. Correction event relation

Use a dedicated append-only `SupplyCorrectionEvents` log rather than mutating the original ledger or overloading the FIFO archive with business-document semantics.

Proposed columns:

- `event_id`
- `correction_id`
- `operation_id`
- `supply_id`
- `event_type` (`PREPARED`, `COMMITTED`, `QUARANTINED`, `ABORTED`) — relation lifecycle
- `relation_type` (`REPLACE`, `REMOVE`, `ADD`) — business relation
- `source_movement_id` (required for `REPLACE`/`REMOVE`; blank for `ADD`)
- `replacement_movement_id` (required for `REPLACE`/`ADD`; blank for `REMOVE`)
- `source_product_id` (required for `REPLACE`/`REMOVE`)
- `replacement_product_id` (required for `REPLACE`/`ADD`)
- `source_supply_item_id`
- `replacement_supply_item_id`
- `effective_at`
- `created_at`
- `details_json`

A PREPARED relation is usable only by the correction operation currently building its candidate replay. A relation becomes effective for ordinary replay only when both its latest relation event is COMMITTED and its linked Operations row is COMMITTED. QUARANTINED blocks automated continuation until reconciliation; ABORTED records a rejected/abandoned correction and is never effective. Events are appended; they are never updated or deleted.

Relation semantics are explicit: REPLACE has one source and one replacement movement and requires the same product ID; REMOVE has only a source movement; ADD has only a replacement movement. A product-identity change is represented as REMOVE on the old product plus ADD on the new product, never as a cross-product REPLACE. This also makes deleted and newly added lines representable without ambiguous blank-field rules.

The table is a new additive system sheet. Its creation must be included in the schema registry and setup/preflight path; no live schema mutation is performed by this specification.

## 5. Canonical FIFO event stream

Introduce a canonical replay input builder between StockLedger reads and `di3GetFifoEventsForProduct_`.

Inputs:
- immutable StockLedger rows and StockMovementDetails;
- StockLots;
- committed correction relations;
- the current correction relation when replay is running for its operation ID.

Algorithm:
1. Validate each relation according to its relation_type: REPLACE has exactly one source and replacement with matching product IDs; REMOVE has only a source; ADD has only a replacement. Verify that source/replacement IDs belong to the same supply and correction, no source movement has two active supersessions, and no correction chain contains a cycle.
2. Build a source-movement supersession set.
3. Exclude superseded source movements from the effective FIFO event stream.
4. Keep replacement movements as ordinary IN events with the original receipt effective timestamp and original receipt recorded timestamp; retain a newly assigned ledger_sequence for append identity. The correction recorded timestamp belongs in the correction relation/operation audit, not in the FIFO tie-break field.
5. Keep every unrelated event unchanged.
6. Sort using the established FIFO event comparator. Do not substitute physical sheet row order for business event ordering.
7. Include correction relations and replacement ledger rows in the replay input fingerprint.

Corrections may be chained. A later correction must supersede the currently effective replacement movements, not resurrect the original source receipt. A removed line is represented by REMOVE; a newly added line by ADD; a product change by REMOVE + ADD. Detect cycles and multiple active replacements and fail closed.

## 6. Operation execution phases

### SC-01 — source audit and candidate

- Verify supply status RECEIVED.
- Verify the original receipt operation is COMMITTED and its immutable payload hash is valid.
- Verify the current V3_Supplies receipt date/number and every V3_SupplyItems row against the immutable receipt payload.
- Verify exact source movement/detail/lot mapping for every original receipt line.
- Capture source supply/document fingerprint and product-scoped stock/FIFO fingerprints.
- Build corrected document rows and corrected receipt lines using the existing financial planner.
- Return a read-only preview; do not register an operation or write any sheet.

### SC-02 — immutable operation and source relation

- Under ScriptLock, recheck all source fingerprints.
- Register `SUPPLY_CORRECTION` with idempotency key `SUPPLY_CORRECTION:<supply_id>:<correction_id>`.
- Persist immutable payload before the PREPARED operation row, using the shared OperationExecutor.
- Append PREPARED correction relation rows and replacement receipt events with stable IDs.
- Do not activate the correction for ordinary FIFO reads yet.

### SC-03 — candidate replay and validation

- Build a candidate FIFO stream with the pending correction included and original source movements excluded.
- Replay all affected products from the earliest impacted effective event.
- Verify no negative stock, all allocations resolve to active lots, lot remaining quantities reconcile, and total allocated cost equals the replay plan.
- Identify affected dispatched/returned orders and append new order-cost snapshot versions after successful projection.
- Verify product cost history and document totals reconcile to the correction plan.

### SC-04 — commit and recovery

- Archive the source allocation projection and source lot-cache values through the F-06 journal protocol.
- Apply replacement ledger/details/lots, document projection, cost-history versions and candidate FIFO projection using idempotent writes.
- Append COMMITTED correction relation events only after the target projection is verified.
- Commit the operation last.
- On recovery, compare source and target fingerprints at every boundary. Resume only from a known state; otherwise quarantine.

## 7. Scope and financial impact

The replay scope includes:
- every product appearing in the original receipt;
- every product appearing in the replacement receipt;
- all ledger events for those products from the earliest affected effective timestamp onward;
- every order whose dispatch/return allocation changes;
- all lines of each affected order when recalculating order-level COGS/profit totals.

Do not limit the scope to products still present in the corrected document: removed original products may have sales or remaining stock that must be reallocated to other lots.

## 8. Acceptance matrix

Minimum source/runtime acceptance:
- correction before any sale;
- correction after full sale of original lot;
- partial consumption across several lots;
- removed product line with other supplies for the same product;
- replacement line with a new pack variant (including 40-unit pack);
- discount/shipping redistribution and fractional unit cost;
- return linked to an affected dispatch;
- closed financial period;
- duplicate request and lost acknowledgement;
- interruption after every write boundary;
- concurrent correction attempt;
- correction of an already corrected supply (chain);
- correction event corruption, duplicate source mapping, missing lot/detail;
- replay quarantine and manual reconciliation.

## 9. Explicitly out of scope for first implementation

- Editing the original SUPPLY_RECEIVE operation or payload.
- Deleting original StockLedger, StockMovementDetails, StockLots or ProductCostHistory rows.
- Physical deletion of original FIFO archive history.
- Same-day negative stock compensation.
- Automatic correction of unrelated supplies or orders.
- Enabling stock-affecting received-supply edits before runtime acceptance.


## 10. SC-01 source audit implementation status

Implemented on `feature/supply-correction-fifo-replay`:

- `src/apps_script/47_DI3_SupplyCorrection.gs` adds
  `di3AuditSupplyCorrectionSource(supplyId)` and a pure exact-mapping validator.
- The audit requires a RECEIVED supply, a COMMITTED `SUPPLY_RECEIVE` operation,
  a valid immutable payload hash, matching supply number/received timestamp,
  matching current `V3_SupplyItems` rows, and exactly one ledger movement,
  movement detail and FIFO lot per original receipt line.
- It verifies operation ownership, event key, product, variant, quantity,
  effective/recorded timestamps, ledger sequence, cost status, unit cost and
  total cost in minor units.
- Missing, duplicate, extra or mismatched source records return BLOCKED; the
  audit does not repair or quarantine them.
- `src/apps_script/48_DI3_SupplyCorrectionTests.gs` adds 9 regression tests and
  `tools/run_supply_domain_tests.js` includes the new suite.

The source audit is read-only: no schema creation, operation registration,
ledger/lot/cost-history writes, FIFO replay, or document edits. It does not yet
build a correction candidate or authorize a correction. The existing
stock-affecting full-edit guard remains in place.

Latest CI for source commit
`319c842d0d91d7e11f341dcba32da5a20c871b90`:
[quality gates run 46087880782](https://github.com/brusvv/dots_inventory-/actions/runs/46087880782)
passed, including Apps Script syntax, all supply lifecycle suites (98/98),
FIFO replay (46/46), order domain (22/22), catalog/order UX (14/14), system
safety (39/39), warehouse dashboard (11/11), finance schema (4/4), and snapshot
auditor tests (8/8).

SC-02 through SC-04 remain unimplemented. No live Apps Script project, Google
Sheet, Drive file, stock record or FIFO projection was changed.
