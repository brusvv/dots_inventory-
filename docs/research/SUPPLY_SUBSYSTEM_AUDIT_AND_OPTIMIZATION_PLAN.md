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

### Follow-up implementation: automatic full-edit recalculation

The automatic full-edit preview was expanded to use an explicitly read-only product lookup path. This avoids invoking the product public-code ensure routine from the onEdit preview. The preview still reads the product and pack-variant catalogues, but it does not create variants or mutate stock/document data.

The latest source CI run `46087315910` passed after these changes. The supply lifecycle suite now reports **89 passed, 0 failed**; Apps Script syntax remains **55/55**. See [GitHub Actions](https://github.com/brusvv/dots_inventory-/actions/runs/46087315910).

The detailed next-stage correction design is in [SUPPLY_CORRECTION_IMPLEMENTATION_SPEC.md](SUPPLY_CORRECTION_IMPLEMENTATION_SPEC.md). It defines the immutable correction payload, append-only source-to-replacement relation, correction-aware FIFO event stream, operation phases and runtime acceptance matrix. This is a specification only; the correction handler, new event schema, and replay integration have not yet been implemented.

#### SC-01 follow-up source audit — correction relation and cost-history semantics

A repository-wide scan of all **47 Apps Script modules** on this branch found
`ProductCostHistory` references only in:
- `12_DI3_SupplyReceiving.gs`: append-only original receipt cost-history rows;
- `36_DI3_SupplyFullEdit.gs`: read-only audit snapshot lookup by original receipt source keys.

No product catalogue, dashboard, finance or order workflow currently reads this
table directly. The correction implementation must still preserve the table's
history and make correction supersession auditable; it must not invent a new
current-cost consumer or change FIFO valuation to depend on ProductCostHistory.
The actual FIFO cost source remains the effective StockLots/event stream.

The spec was tightened before implementation to resolve three edge cases:
- correction relation rows now distinguish `REPLACE`, `REMOVE` and `ADD`;
  product identity changes are represented as REMOVE + ADD, not a cross-product
  replacement;
- a relation is effective for ordinary replay only when both its relation event
  and linked Operations row are COMMITTED; rejected/abandoned attempts have an
  ABORTED terminal relation event;
- replacement FIFO events retain the original receipt `recorded_at` tie-break
  timestamp while receiving a new ledger sequence. The correction's actual
  recording time stays in the correction operation/relation audit. This avoids
  reordering same-effective-time receipts and sales merely because a correction
  was recorded later.

These are specification clarifications only; the subsequent SC-01 source-audit
module does not change schema, workbook, stock projections or runtime state.

#### SC-01 read-only source audit implemented

`47_DI3_SupplyCorrection.gs` now provides a read-only source audit for a
received supply. It verifies the committed receipt operation and payload hash,
the current supply number/received timestamp, the current supply-item rows, and
the exact one-to-one mapping from each original receipt line to StockLedger,
StockMovementDetails and StockLots. It also audits the active StockAllocations
projection for those lots and reconciles per-lot CONSUME quantities and allocated
cost against StockLots.remaining_quantity and total cost. It rejects missing,
duplicate, extra or mismatched records without attempting repair.

Eleven regression tests were added in `48_DI3_SupplyCorrectionTests.gs` and
wired into the consolidated supply test runner. Quality gates passed at
`7a98f3c9022a19f80993d02174edbf3f0f02206f`:
- Supply domain/lifecycle: **100/100**.
- FIFO replay: **46/46**.
- Order domain: **22/22**.
- Catalog/order UX: **14/14**.
- System safety: **39/39**.
- Warehouse dashboard: **11/11**.
- Finance schema: **4/4**.
- Snapshot auditor: **8/8**.
- Apps Script syntax: passed.

SC-01 is limited to source audit. It does not register a correction operation,
create the SupplyCorrectionEvents schema, write replacement movements, rebuild
FIFO or change the existing fail-closed guard. SC-02–SC-04 remain pending.

### Deferred pending measurements or design

- S-11 (register refresh): defer structural formatting optimizations until Apps Script runtime measurements exist; avoid introducing stale presentation state.
- S-12 (FIFO repository reads): defer batching until C-01 benchmark identifies the dominant reads and thresholds.
- S-01/S-02/S-05 (SUPPLY_CORRECTION, canonical replay stream and downstream valuation history): remain the main implementation workstream. No received supply has been corrected or replayed.

## Current conclusion

The subsystem is not ready for stock-affecting correction of an already received supply. The current fail-closed guard is correct and should remain until S-01/S-02/S-05 are implemented and runtime-accepted.

There are several low-risk optimizations worth implementing, starting with the supply loader's N+1 reads and batched pack-variant resolution. The status-history idempotency rule and receipt-boundary line validation should be hardened before enabling corrections.


### SC-02 foundation — correction relation journal

Added an additive \`SupplyCorrectionEvents\` schema and a pure resolver for
append-only correction relations. Lifecycle events are grouped by stable
\`relation_id\` and ordered by unique \`event_sequence\`. Ordinary replay may
consume only COMMITTED relation events whose owning \`SUPPLY_CORRECTION\`
operation is also COMMITTED. A pending candidate may opt into PREPARED rows for
its exact operation ID only.

The resolver validates relation shape (REPLACE/REMOVE/ADD), operation ownership,
stable metadata, source/replacement uniqueness and correction-chain acyclicity.
It rejects quarantined relations. Tests cover committed and pending visibility,
correction chains, REMOVE/ADD, abort/quarantine, duplicate supersession,
duplicate replacement, product mismatch and cycles.

This does not yet modify the FIFO event stream or execute corrections. No
handler is registered and no live workbook/schema, stock ledger, lot, allocation,
cost history, order snapshot or document was changed. The fail-closed guard for
received-supply stock edits remains in place.


SC-02 relation-journal quality gates passed for source commit
\`4364355461999ef2e4c25fe8678a17d6e22673b0\`:
[GitHub Actions #46095111648](https://github.com/brusvv/dots_inventory-/actions/runs/46095111648).

The run checked JavaScript syntax for 59 Apps Script modules and passed all
automated suites: snapshot auditor 8, FIFO 46, order domain 22, supply domain
and lifecycle 113, catalog/order UX 14, system safety 39, warehouse dashboard
11, finance schema 4. Total: **257 passed, 0 failed**. This does not replace
Apps Script runtime acceptance against a restored/disposable workbook.


### SC-03 foundation — read-only candidate FIFO preview

Added a pure candidate replay helper and tests. It resolves the effective
correction relation map, verifies referenced source/replacement movements and
their original effective receipt timestamp, includes every affected product
(including removed source products), filters superseded receipt events, and
runs the existing full FIFO plan over the candidate snapshot. The helper
returns a fingerprint and candidate allocations/costs/remaining lots without
writing any sheet.

The new tests cover REPLACE cost replay, stock deficit after REMOVE, cross-
product REMOVE+ADD, correction chains, pending-operation visibility, invalid
replacement movements and snapshot immutability.

This helper is not yet wired into operation execution or the normal FIFO
rebuild. No stock projection or live workbook data was changed.


SC-03 read-only candidate FIFO preview passed its source quality gates in
[GitHub Actions #46095508594](https://github.com/brusvv/dots_inventory-/actions/runs/46095508594):
61 Apps Script modules passed syntax validation and all automated suites
reported **264 passed, 0 failed** (snapshot 8, FIFO 46, order 22, supply 120,
catalog/order UX 14, safety/operation 39, warehouse 11, finance 4). This is
not a live workbook runtime acceptance.


### SC-03 integration update — ordinary FIFO and downstream stock reads

The correction-aware relation map is now wired into the normal FIFO rebuild path. A changed committed relation fingerprint forces a full replay even when there is no new ledger tail, and the replay scope includes both source and replacement products. The effective snapshot filters superseded source movements, details and lots without rewriting their immutable source rows. Original physical StockLots row numbers are retained through filtering.

Read-side consumers were aligned:
- product valuation and the warehouse dashboard exclude superseded lots;
- product FIFO valuation history excludes superseded ledger movements;
- the operational stock journal shows the effective ledger history;
- valuation and stock-journal reads fail closed if active correction relations are not reflected in the committed FIFO projection;
- pending `SUPPLY_CORRECTION` operations are included in the stock-operation guard.

This closes the source-level gap described in S-02 for the ordinary replay/read path. It does not create or commit a correction operation. SC-04 write ordering, recovery, ProductCostHistory handling and bound-workbook runtime acceptance remain open. The existing received-supply edit guard must remain enabled.

Source quality gates passed at `56f09f4fa335f0ac18e5408e1c13ebd7cb021751`: 63 Apps Script files syntax-checked; snapshot 8, FIFO 46, order 22, supply/correction/lifecycle 127, catalog/order UX 14, system safety 39, warehouse dashboard 11, finance schema 4; **271 passed, 0 failed**. [GitHub Actions run](https://github.com/brusvv/dots_inventory-/actions/runs/46096055903). This is not runtime acceptance against the live workbook.
