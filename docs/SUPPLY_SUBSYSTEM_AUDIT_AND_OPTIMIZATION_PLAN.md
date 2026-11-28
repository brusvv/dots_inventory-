# Supply subsystem audit and optimization plan

Date: 2026-11-28
Branch: `feature/supply-correction-fifo-replay`
Audit type: source inspection; no workbook, Apps Script runtime, schema, ledger, FIFO projection, or business data was changed.

## Scope

The audit covers the supply lifecycle and every source module that directly implements it, plus shared modules whose behaviour affects supply receipt, stock valuation, replay, order COGS, and warehouse views.

### Direct supply modules

- `11_DI3_SupplyDomain.gs` — supply form, draft persistence, financial plan, selector, form state and input validation.
- `12_DI3_SupplyReceiving.gs` — status transitions, receipt operation, stock movement/lot creation, cancellation, register and recovery.
- `34_DI3_HistoricalSupply.gs` — historical supply entry, preflight, confirmation fingerprint and recovery.
- `36_DI3_SupplyFullEdit.gs` — read-only audit snapshot, full-edit plan, immutable document-edit operation and history.
- `13_DI3_CatalogAndSupplyTests.gs`, `14_DI3_SupplyReceivingTests.gs`, `35_DI3_HistoricalSupplyTests.gs`, `37_DI3_SupplyFullEditTests.gs`, `39_DI3_SupplyWorkspaceUxTests.gs` — source-level regression coverage.
- `runtime/probes/DI3_SUPPLY_EDIT_CANCEL_RUNTIME_PROBE.gs`, `runtime/probes/DI3_SUPPLY_CANCEL_FAULT_INJECTION_PROBE.gs`, `runtime/probes/DI3_SUPPLY_CATALOG_RUNTIME_PROBE.gs` — runtime probes.

### Shared dependencies and downstream consumers

- `00_DI3_SchemaRegistry.gs`, `00_DI3_AppConfig.gs`, `01_DI3_ProductIdentity.gs`, `02_DI3_ProductsRepository.gs`, `03_DI3_PackVariants.gs`, `04_DI3_Setup.gs`, `10_DI3_ProductCatalog.gs`.
- `07_DI3_StockCore.gs`, `22_DI3_MenuAndFilterUtils.gs`, `23_DI3_PeriodGuard.gs`, `24_DI3_IncrementalFifo.gs`, `26_DI3_EventDispatcher.gs`, `27_DI3_OperationExecutor.gs`, `28_DI3_InstallationPreflight.gs`, `30_DI3_MoneyCore.gs`, `32_DI3_BackupRestore.gs`, `33_DI3_SchemaVersioning.gs`.
- `16_DI3_OrderWorkflow.gs` and `19_DI3_WarehouseViews.gs` are downstream consumers: receipt/replay changes affect order cost snapshots, seller profit, warehouse views and the stock journal. `20_DI3_FifoHistoryWorkspace.gs` is a further FIFO valuation consumer.

This is a source audit, not proof of behaviour in the bound Google Sheets workbook. Runtime acceptance remains separate.

## Executive summary

The supply lifecycle is already split into sensible layers: document/draft domain, receipt/status workflow, historical entry, and controlled full edit. Receipt uses an immutable `SUPPLY_RECEIVE` payload and operation executor; received-supply stock-affecting full edits fail closed. Cancellation is explicitly blocked once receipt evidence or stock movements exist. Historical entry uses a read-only preflight, confirmation outside the lock, and a second state/fingerprint check under the lock.

The main blockers for supply correction are architectural rather than a missing UI action: the operation registry does not yet include `SUPPLY_CORRECTION`, FIFO replay consumes the current StockLedger event stream, and downstream cost-history/order projections need explicit correction semantics.

There are also safe performance opportunities in the form loader, pack-variant creation, cost-history lookups and register refresh. They should be benchmarked before broader changes.

## Findings

### P1 — correctness and auditability

#### S-01. Supply correction is not implemented in the operation lifecycle

`27_DI3_OperationExecutor.gs` registers `SUPPLY_RECEIVE` and `SUPPLY_DOCUMENT_EDIT`, but not `SUPPLY_CORRECTION`. The received-supply editor explicitly rejects changes to lines, quantity, purchase price, discounts, shipping and G7 until a dedicated correction operation and FIFO replay exist.

**Required design:** register a new immutable operation type; retain the original receipt, ledger and payload as audit history; build a correction-aware effective event stream that supersedes the original receipt lines for valuation without deleting or rewriting the original events. A normal negative stock movement posted today is not an acceptable substitute because it would leave historical COGS wrong.

#### S-02. FIFO replay currently has no source-supersession layer

`24_DI3_IncrementalFifo.gs` reads StockLedger directly. It supports incremental tail processing and product/full replay, but its current event builder does not resolve correction relationships or replace a source receipt with corrected effective lines.

**Required design:** introduce a canonical replay-input builder that resolves active/superseded source movements and emits the corrected receipt at the original effective timestamp. Keep immutable ledger sequence identity and existing replay archive/recovery guarantees. A correction must replay every affected product from the earliest affected event, not merely append a new tail event.

#### S-03. Status-history deduplication is too coarse for a document that can be rolled back and advanced again

`di3EnsureSupplyStatusHistory_` in `12_DI3_SupplyReceiving.gs` treats a supply/new-status pair as already recorded, without considering the previous status, effective timestamp or operation ID. Full Edit has a separate operation-scoped history writer, and can move a not-yet-received document backwards. If that document later advances to a status already present in its earlier history, the ordinary transition helper can suppress the new transition.

**Recommendation:** make status-history idempotency event-scoped: use operation ID where available; otherwise compare supply ID, old status, new status and effective timestamp. Preserve recovery deduplication for the same event while allowing a later legitimate transition to the same status. Add rollback → advance → retry tests.

#### S-04. Receipt preflight should revalidate the document's line identity invariant

Draft and financial-plan code reject duplicate `product_id + pack_variant_id` pairs. The receipt builder validates item IDs, product/variant ownership, pack size and quantity, but does not independently assert uniqueness of the product/variant pair across persisted supply items.

**Recommendation:** repeat the identity invariant at the receipt boundary. This is a cheap fail-closed check against corrupted or manually altered persisted rows; it must not silently merge or discard lines.

#### S-05. Supply correction must update downstream valuation history, not only active FIFO allocations

The FIFO rebuild calls `di3RefreshAllOrderFifoSnapshots_` for impacted products. That routine updates order-item/order current projections and appends immutable `OrderCostSnapshots` when values change. `ProductCostHistory` is also append-oriented and is currently populated from receipt lines.

**Required design:** define correction/supersession rows for product cost history and ensure order snapshots append a new version after replay. Do not rewrite historical snapshots. Recalculate only orders whose dispatch allocations are affected, but include all lines of each impacted order in order-level totals.

### P2 — performance opportunities

#### S-06. Loading a supply currently performs avoidable repeated product lookups

`di3LoadSelectedSupplyDraft` preloads the product option index and public-code map, but then calls `di3LoadProductById_` once per item row. The preloaded product list is not used for this loop. This is an N+1 pattern and repeats reads for products already loaded.

**Optimization:** build a `product_id → product` map from the preloaded list and resolve every line in memory. Keep the existing fallback to `product_label_snapshot` when the product no longer exists.

#### S-07. Resolving pack variants one line at a time repeatedly reloads repositories

`di3ResolveSupplyFormLines_(true)` calls `di3GetOrCreatePackVariant_` per form line. That helper loads the product and the complete PackVariants index for each call. With a multi-line supply this repeats the same sheet reads and can append new variants one at a time.

**Optimization:** add a lock-aware batch resolver: load product and pack-variant indexes once, validate all requested pairs, create missing variants in one append, then return the resolved IDs in the original line order. Keep the single-item public helper for other workflows. Add duplicate, inactive-product, inactive-variant, retry and concurrent-call tests.

#### S-08. Receipt cost-history idempotency scans the full history column

`di3EnsureSupplyCostHistory_` reads all ProductCostHistory source keys for every receipt, even though the receipt payload already contains the exact source keys.

**Optimization:** query only the current receipt's source keys in one batched lookup and append only missing rows. Preserve idempotency and tolerate partial prior writes.

#### S-09. Full-edit audit snapshot reads the entire ProductCostHistory table

`di3BuildSupplyFullEditSnapshot_` reads all ProductCostHistory columns and filters by the current supply prefix in memory.

**Optimization:** construct the expected `SUPPLY_RECEIPT:<supply_id>:<supply_item_id>` keys from the supply's items and retrieve only matching rows. Keep the snapshot read-only and preserve its fingerprint inputs.

#### S-10. Current pack-variant selection uses a product-by-all-variants nested loop

`di3SetCurrentPackVariantsFromReceipt_` loops each product in the receipt and then all variants in the repository.

**Optimization:** index variants by product during the initial read, then visit only variants belonging to affected products. Preserve the current rule that the last received line for a product becomes its current variant.

#### S-11. Register refresh performs full presentation work on every update

`di3RefreshSupplyRegister` rebuilds all rows, clears the old output range, removes/recreates bandings, updates filter range, reapplies validation/notes, resets frozen rows and column visibility, and compacts the sheet on each refresh.

**Optimization:** separate one-time/structural setup from data projection. Update content in a batch and only change validation, banding, filter, frozen rows, visibility and grid dimensions when the relevant structure actually changed. Do not introduce a stale cache or lose editable next-stage date/time values and filter criteria.

#### S-12. Incremental FIFO still performs per-product repository reads

The existing C-01/F-09 performance plan already identifies repeated StockLots, FifoProductState, StockMovementDetails and StockAllocations lookups for each affected product. Supply receipts with many distinct products amplify this cost.

**Optimization:** batch reads across the affected product set and partition in memory where the measured data volume justifies it. Keep a selective-read fallback for small scopes. Do not change event ordering, replay scope, insufficient-stock checks or recovery semantics.

### P3 — tests and operational readiness

#### S-13. Supply unit tests cover important pure rules, but not the full persistence/recovery matrix

Existing tests cover financial allocation, pack identity, state transitions, date validation, free/unknown cost and selected full-edit guards. Runtime probes cover read-only consistency and some fault injection. Source tests do not prove actual Sheets write ordering, lost acknowledgements, partial multi-sheet receipt, concurrent edits, or replay after a corrected receipt.

**Required acceptance matrix:** create draft → edit → send → awaiting → receive; historical entry; cancellation at each pre-receipt status; receipt retry after failure at every write boundary; lost acknowledgement; duplicate invocation; two concurrent sessions; full edit rollback/re-advance; product disabled/variant changed; closed financial period; correction before and after sales; partial stock consumption; returns from affected lots; correction retry and interrupted replay recovery.

#### S-14. Runtime probe contains a stale 13-column label

`DI3_SUPPLY_EDIT_CANCEL_RUNTIME_PROBE.gs` compares the register against `DI3_SUPPLY_REGISTER_HEADERS` dynamically, so the check itself follows the current schema, but its check name still says `current_13_column_layout`. The current source header array has 14 columns. Update the label to avoid misleading diagnostics.

## Optimization order

1. S-06: remove N+1 product reads from supply load.
2. S-07: batch pack-variant resolution and append.
3. S-08/S-09: selective ProductCostHistory lookup.
4. S-10: index pack variants by product.
5. S-03/S-04: strengthen history idempotency and receipt-boundary validation.
6. S-11: register refresh isolation, only after runtime benchmark.
7. S-12: batch FIFO reads, only after C-01 benchmark.
8. Implement S-01/S-02/S-05 as the dedicated SUPPLY_CORRECTION workstream with dry-run candidate replay, journaled commit/recovery and append-only history.

## Safety and acceptance rules

- No live workbook writes, data edits, receipt posting, migration, backup restore or FIFO rebuild were performed during this source audit.
- Never delete or overwrite original StockLedger, Operations, OperationPayloads, original receipt payloads or historical cost snapshots as part of correction.
- A correction candidate must be read-only until the complete affected-product replay and downstream order-cost result passes preflight.
- Commit must be operation-backed, idempotent, lock-protected, fingerprinted and recoverable after interruption at every write boundary.
- No optimization may change financial allocation, FIFO event ordering, business timestamps, lot identity, return linkage, period guards or operation recovery semantics.
- Performance claims require Apps Script runtime measurements on a disposable restored workbook. Node/source tests are not runtime benchmarks.

## Source changes completed during this audit

The following items have been implemented on this branch; they are source changes only and have not been deployed to a live Apps Script project.

| Finding | Status | Change |
|---|---|---|
| S-03 | Implemented | Status-history idempotency now matches supply ID, old/new status, effective timestamp and operation ID. A later re-entry to the same status can be recorded. |
| S-04 | Implemented | Receipt boundary validates unique item IDs, unique product/pack-variant pairs, positive integer pack size and positive integer pack count. |
| S-06 | Implemented | Supply loader resolves labels from one preloaded product index; inactive products remain available for historical display and missing products use the saved label snapshot. |
| S-07 | Implemented | Added batch pack-variant resolver; supply form reuses preloaded product/variant indexes and appends missing variants in one write. |
| S-08 | Implemented | Receipt cost-history idempotency looks up only source keys for the current receipt. |
| S-09 | Implemented | Full-edit snapshot retrieves cost-history rows by the supply's original receipt item IDs instead of loading the complete table. |
| S-10 | Implemented | Current pack variants are grouped by product before updates, avoiding product-by-all-variants nested scans. |
| S-14 | Implemented | Runtime probe diagnostic label now reflects the current 14-column register. |

Regression tests were added for event-scoped status-history deduplication, receipt line invariants, batched pack-variant creation and supply-loader lookup behaviour. The quality-gates workflow now runs the consolidated supply lifecycle test runner on this feature branch.

A pre-existing CI blocker was also found and repaired while enabling this branch's quality gates: `tools/tests/audit_apps_script_snapshot.test.js` had an invalid regular-expression literal and lacked its `node:crypto` import. This issue was unrelated to the supply implementation but prevented every later regression suite from running.

### CI verification result

The GitHub Actions quality-gates run for source commit `e0b5ca66562b75e3717995e6ed012a738cc9cba6` completed successfully:

- Apps Script syntax: **55/55** modules.
- Snapshot auditor: **7/7**.
- FIFO replay and sequence: **46/46**.
- Order domain: **22/22**.
- Supply domain and lifecycle: **85/85** across five suites.
- Catalog/order UX: **14/14**.
- System safety/operation: **39/39**.
- Warehouse dashboard: **11/11**.
- Finance schema: **4/4**.

Total automated assertions/tests reported by these suites: **228 passed, 0 failed**. The successful run is [GitHub Actions #46086661404](https://github.com/brusvv/dots_inventory-/actions/runs/46086661404).

The branch was also synchronized with the latest `feature/github-preview-releases` base. The merge commit `593ad71f6662521545fe93fdd45b0824b8b00cf5` has the latest preview branch as its second parent; the merge tree preserves the already-tested source state and includes the newer base documentation/source-audit tooling. The branch is now **0 commits behind** the preview base.

### Full-edit form: automatic quantity and financial recalculation

Implemented after the initial audit:

- In `FULL_EDIT` mode, edits or multi-cell pastes intersecting `A12:D31` automatically rebuild the financial preview. This includes product, units per pack, pack count and purchase price.
- Edits intersecting `B5:B7` also recalculate seller discount, partner discount, shipping allocation and the final document total.
- The calculation reuses `di3ResolveSupplyFormLines_(false)` and `di3BuildSupplyFinancialPlan_`; it does not create pack variants, save document rows, post ledger movements or execute FIFO.
- If the user temporarily enters invalid/incomplete values, the previous preview is cleared and the error is placed in the M2 note. This prevents stale calculated values from appearing current.
- Source tests cover the edited ranges, unit/pack quantity effects, line total, discount/shipping distribution, unit cost and the read-only nature of the automatic preview.

The expected behaviour is:
- Change units per pack: received units and unit cost are recalculated; pack purchase price and document goods total remain unchanged if pack count and price are unchanged.
- Change pack count: received units, goods amount, proportional discount/shipping allocations, final line amount, final pack cost and unit cost are recalculated.
- Change both: all dependent values are recalculated from the new pair of inputs.

This is a document preview only. For a received supply, the existing guard still blocks saving stock-affecting changes until the correction operation and FIFO replay are implemented and runtime-accepted.

### Deferred pending measurements or design

- S-11 (register refresh): defer structural formatting optimizations until Apps Script runtime measurements exist; avoid introducing stale presentation state.
- S-12 (FIFO repository reads): defer batching until C-01 benchmark identifies the dominant reads and thresholds.
- S-01/S-02/S-05 (SUPPLY_CORRECTION, canonical replay stream and downstream valuation history): remain the main implementation workstream. No received supply has been corrected or replayed.

## Current conclusion

The subsystem is not ready for stock-affecting correction of an already received supply. The current fail-closed guard is correct and should remain until S-01/S-02/S-05 are implemented and runtime-accepted.

There are several low-risk optimizations worth implementing, starting with the supply loader's N+1 reads and batched pack-variant resolution. The status-history idempotency rule and receipt-boundary line validation should be hardened before enabling corrections.
