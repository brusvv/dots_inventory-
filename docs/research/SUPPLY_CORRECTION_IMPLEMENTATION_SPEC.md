# SUPPLY_CORRECTION implementation specification

Status: SC-01, SC-02 and SC-03 (including normal FIFO integration and correction-aware read projections) are implemented and source-CI-covered. The correction operation handler, SC-04 commit/recovery and bound-workbook runtime acceptance remain pending.
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

- `event_id` — unique append-only journal event ID
- `relation_id` — stable ID grouping lifecycle events for one source/replacement relation
- `correction_id`
- `operation_id`
- `supply_id`
- `event_sequence` — monotonically increasing journal sequence, unique across all events
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
- It reads the active StockAllocations projection for the source lots, validates
  each CONSUME row and its cost, and reconciles allocated quantity plus
  StockLots.remaining_quantity to initial_quantity. The active allocation rows
  and lot-cache values are included in the source fingerprint.
- Missing, duplicate, extra or mismatched source records return BLOCKED; the
  audit does not repair or quarantine them.
- `src/apps_script/48_DI3_SupplyCorrectionTests.gs` adds 11 regression tests and
  `tools/run_supply_domain_tests.js` includes the new suite.

The source audit is read-only: no schema creation, operation registration,
ledger/lot/cost-history writes, FIFO replay, or document edits. It does not yet
build a correction candidate or authorize a correction. The existing
stock-affecting full-edit guard remains in place.

Latest CI for source commit
`7a98f3c9022a19f80993d02174edbf3f0f02206f`:
[quality gates run 46088102384](https://github.com/brusvv/dots_inventory-/actions/runs/46088065273)
passed, including Apps Script syntax, all supply lifecycle suites (98/98),
FIFO replay (46/46), order domain (22/22), catalog/order UX (14/14), system
safety (39/39), warehouse dashboard (11/11), finance schema (4/4), and snapshot
auditor tests (8/8).

SC-02 through SC-04 remain unimplemented. No live Apps Script project, Google
Sheet, Drive file, stock record or FIFO projection was changed.


## 11. SC-02 foundation — append-only relation journal

Implemented on \`feature/supply-correction-fifo-replay\`:

- Added \`SupplyCorrectionEvents\` to \`DI3_TABLE_SCHEMAS\`; it is an additive
  system table with the relation lifecycle fields, stable \`relation_id\`, and
  monotonic \`event_sequence\`. The normal schema initializer will create the
  missing table without rewriting existing tables.
- Added \`49_DI3_SupplyCorrectionRelations.gs\` with strict relation metadata
  validation, an idempotent append helper, and a pure effective-relation
  resolver.
- The resolver activates a relation for ordinary replay only when the latest
  relation event is COMMITTED and its linked Operations row is COMMITTED.
  PREPARED relations can be included only for the exact pending operation ID
  explicitly supplied by a candidate-replay caller.
- The resolver validates REPLACE/REMOVE/ADD field semantics, operation ownership,
  unique event sequence, stable relation metadata, one supersession per source,
  unique replacement ownership, and acyclic correction chains. QUARANTINED
  relations fail closed; ABORTED relations remain inactive.
- Added \`50_DI3_SupplyCorrectionRelationTests.gs\` and included it in the
  consolidated supply-domain runner.

This is only the relation-journal foundation. The normal FIFO event builder
does **not** yet consume the resolved map; no \`SUPPLY_CORRECTION\` operation
handler is registered; no replacement movements/lots are created; no order
snapshots or product cost-history projections are changed. SC-03/SC-04 remain
disabled. The received-supply stock-affecting edit guard remains mandatory.


### SC-02 quality-gate verification

The latest source CI run for commit
\`4364355461999ef2e4c25fe8678a17d6e22673b0\` passed:
[GitHub Actions #46095111648](https://github.com/brusvv/dots_inventory-/actions/runs/46095111648).

- Apps Script syntax: **59/59** modules.
- Snapshot auditor: **8/8**.
- FIFO replay: **46/46**.
- Order domain: **22/22**.
- Supply domain/lifecycle/correction suites: **113/113** (including 13 relation-journal tests).
- Catalog/order UX: **14/14**.
- System safety/operation: **39/39**.
- Warehouse dashboard: **11/11**.
- Finance schema: **4/4**.

All reported assertions passed. This is source/Node CI evidence, not a bound-workbook runtime acceptance.


## 12. SC-03 foundation — read-only candidate FIFO preview

Added \`51_DI3_SupplyCorrectionFifoPreview.gs\`:

- Accepts a consistent snapshot of StockLedger, StockMovementDetails,
  StockLots, SupplyCorrectionEvents and Operations. Replacement inbound rows
  must already be present in the supplied candidate snapshot.
- Resolves committed relations for normal candidate state, or PREPARED
  relations only for the exact \`include_operation_id\`.
- Verifies each referenced source/replacement movement exists, is an inbound
  movement for the declared product, and preserves the original effective
  receipt timestamp.
- Builds the complete affected-product scope from both source and replacement
  product IDs. This deliberately includes products removed from the corrected
  document, so their historical sales and stock are still replayed.
- Excludes superseded source movement IDs and their details/lots, then runs the
  existing full FIFO replay plan against the remaining candidate events.
- Returns affected products, relation/input fingerprints, replay allocations,
  movement costs and remaining lots. It does not write to Sheets.

Regression tests in \`52_DI3_SupplyCorrectionFifoPreviewTests.gs\` cover
replacement cost replay, negative stock after REMOVE, cross-product REMOVE+ADD,
multi-step correction chains, exact pending-operation visibility, invalid
replacement movement type/date and input immutability.

**Scope boundary:** this is a pure preview/preflight primitive. It is not yet
called by the operation executor or normal FIFO rebuild; no live correction
can be committed and no active FIFO projection is changed. SC-03 integration
and SC-04 commit/recovery remain pending.


### SC-03 preview quality-gate verification

The candidate preview and its tests passed in
[GitHub Actions #46095508594](https://github.com/brusvv/dots_inventory-/actions/runs/46095508594),
source commit \`591020b6af15aecef8a24466c2251f17800933df\`.

- Apps Script syntax: **61/61** modules.
- Snapshot auditor: **8/8**.
- FIFO replay: **46/46**.
- Order domain: **22/22**.
- Supply domain, lifecycle and correction: **120/120**.
- Catalog/order UX: **14/14**.
- System safety/operation: **39/39**.
- Warehouse dashboard: **11/11**.
- Finance schema: **4/4**.

Total automated assertions: **264 passed, 0 failed**. The test run validates
the read-only candidate preview only; it does not establish Apps Script
runtime acceptance or enable live correction execution.


## 13. SC-03 integration — ordinary FIFO and stock read models

Implemented on `feature/supply-correction-fifo-replay`:

- `53_DI3_SupplyCorrectionFifoIntegration.gs` builds a read-only effective FIFO snapshot from the immutable ledger/details/lots plus the resolved relation map.
- The snapshot validates every referenced source and replacement movement: it must exist, be an inbound movement, match the relation's product, and retain the original receipt `effective_at`.
- Superseded source movements, their details and their lots are excluded from the effective snapshot. Original rows remain untouched in the source tables.
- `di3RebuildFifoAllocations_` now reads the correction relation map. A changed committed relation fingerprint forces a full replay even if the ledger cursor has no new rows; affected product scope includes source and replacement products, including REMOVE-only products.
- The relation fingerprint participates in replay input fingerprints and is persisted only after a successful replay run. A candidate replay for a still-pending correction does not publish its pending fingerprint as the globally committed one.
- Filtered StockLots rows retain their original physical sheet row numbers so projection writes cannot be shifted by filtering.
- Product valuation, warehouse dashboard and stock journal use the effective receipt set. Valuation and journal reads fail closed when active correction relations do not match the last committed FIFO projection.
- `SUPPLY_CORRECTION` is included in pending stock-operation detection, so normal stock valuation reads are blocked while a correction operation is pending.
- Product FIFO valuation history excludes superseded source movements and therefore reconstructs the corrected event history rather than double-counting the original receipt.

Regression coverage:
- `54_DI3_SupplyCorrectionFifoIntegrationTests.gs`: REPLACE, REMOVE, ADD, correction chains, immutable input snapshots, invalid movement type, mismatched effective timestamp, and preservation of physical StockLots row identity.
- Existing candidate-preview tests remain in place.

Quality gates passed at source commit `56f09f4fa335f0ac18e5408e1c13ebd7cb021751`:
- Apps Script syntax: **63/63**.
- Snapshot auditor: **8/8**.
- FIFO replay: **46/46**.
- Order domain: **22/22**.
- Supply/correction/lifecycle suites: **127/127**.
- Catalog/order UX: **14/14**.
- System safety/operation: **39/39**.
- Warehouse dashboard: **11/11**.
- Finance schema: **4/4**.
- Total: **271 passed, 0 failed**.
- [GitHub Actions run](https://github.com/brusvv/dots_inventory-/actions/runs/46096055903).

This is source/Node CI evidence only. It does not validate Apps Script execution against the bound workbook. No correction operation handler exists yet; no replacement movements have been written, no live FIFO projection has been rebuilt, and no supply has been corrected. SC-04 commit/recovery and runtime acceptance remain pending.
