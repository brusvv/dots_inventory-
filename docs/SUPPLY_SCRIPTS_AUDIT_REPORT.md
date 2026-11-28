# Supply scripts audit — static findings

Date: 2026-11-28  
Repository: `brusvv/dots_inventory-`  
Branch: `feature/supply-correction-fifo-replay`  
Audited code baseline: `f8eb0052fc420d9f48e1d3b52cfb4fb594b7ead3`  
Audit plan: [SUPPLY_SCRIPTS_AUDIT_AND_OPTIMIZATION_PLAN.md](SUPPLY_SCRIPTS_AUDIT_AND_OPTIMIZATION_PLAN.md)

## Scope reviewed

The repository's `src/apps_script` tree contains the Apps Script implementation modules and test modules. The review covered the supply-domain and receipt workflows, historical entry, full edit, correction/FIFO replay, PackVariants projection, shared schema/repository helpers, stock/FIFO and operation infrastructure, menu/trigger wiring, warehouse views and finance dependencies.

Primary modules:
- `11_DI3_SupplyDomain.gs`, `12_DI3_SupplyReceiving.gs`
- `34_DI3_HistoricalSupply.gs`, `36_DI3_SupplyFullEdit.gs`
- `47_DI3_SupplyCorrection.gs`, `49_DI3_SupplyCorrectionRelations.gs`, `51_DI3_SupplyCorrectionFifoPreview.gs`, `53_DI3_SupplyCorrectionFifoIntegration.gs`, `55_DI3_SupplyCorrectionExecutionCore.gs`, `57_DI3_SupplyCorrectionOperation.gs`, `58_DI3_SupplyCorrectionPackVariantProjection.gs`, `60_DI3_SupplyCorrectionRuntimeProbe.gs`

Shared dependencies reviewed:
- `00_DI3_SchemaRegistry.gs`, `03_DI3_PackVariants.gs`, `07_DI3_StockCore.gs`, `08_DI3_WarehouseManager.gs`, `19_DI3_WarehouseViews.gs`, `20_DI3_FifoHistoryWorkspace.gs`, `22_DI3_MenuAndFilterUtils.gs`, `24_DI3_IncrementalFifo.gs`, `26_DI3_EventDispatcher.gs`, `27_DI3_OperationExecutor.gs`, `30_DI3_MoneyCore.gs`, `31_DI3_FinanceDashboard.gs`, plus product-catalog and supply-related regression modules.

This is a static source audit. It does not claim measured Apps Script runtime performance and does not prove behavior on the private live workbook.

## Executive summary

The supply workflow is not a candidate for a wholesale rewrite. The code already contains several sound patterns: operation-backed receipt and correction flows, immutable payloads, targeted idempotency checks, batched row writes, schema-aware correction projection, minor-unit money helpers, and scoped FIFO preflight.

The best opportunities are narrower:
1. eliminate an unintended catalogue write in the ordinary supply preview path;
2. batch repeated supply/status/item lookups;
3. reuse form/catalogue snapshots across validation and commit planning;
4. avoid redundant UI refreshes after receipt;
5. make PackVariants reconciliation selective for affected products;
6. reduce setup-only per-cell formatting calls only after transaction-path improvements.

## Findings by priority

### P1 — Preview path can write ProductPublicCodes

In `11_DI3_SupplyDomain.gs`, `di3PreviewSupplyForm()` calls `di3ResolveSupplyFormLines_(false)` without the read-only catalogue flag. The resolver calls `di3GetProductFormOptionIndex_()`; its default behavior invokes `di3EnsureProductPublicCodes_()` from `07_DI3_StockCore.gs`. That helper takes a lock and appends missing rows to `ProductPublicCodes`.

The preview does not create supply documents or PackVariants, but it can still allocate public product codes. That is an unexpected persistent side effect for a calculation/preview action and conflicts with the intended read-only behavior documented beside the resolver/full-edit preview.

**Recommendation:** call the resolver in read-only catalogue mode from the ordinary preview path (as the full-edit preview already does), and add a regression test proving that preview does not append or otherwise alter `ProductPublicCodes`, `Products`, `PackVariants`, supply tables or stock tables. Preserve the intended write of calculated display cells on the form.

Risk: low-to-medium implementation risk; high value for behavioral clarity. This should be the first code fix.

### P1 — Full-edit projection performs N+1 item identity searches and writes parent before all item ownership checks finish

In `36_DI3_SupplyFullEdit.gs`, `di3ApplySupplyDocumentEditOperation_()` calls `di3FindRowByFirstColumn_("V3_SupplyItems", id)` inside the loop over target item rows, then performs more individual lookups for removed IDs. Each helper call reaches the shared row-search path and can issue its own TextFinder search and row read.

The handler also writes the parent `V3_Supplies` row before all target/removed item IDs have been resolved and ownership-checked. Operation retry makes partial progress recoverable, but a permanent identity/ownership conflict can be discovered only after the parent projection has already been written.

**Recommendation:** gather all target and removed `supply_item_id` values, resolve them with one `di3ReadRowsByColumnValues_` call, build an in-memory ID map, validate duplicate IDs and ownership for every row before the first business write, then preserve the existing batched updates/appends/deletes and retry behavior. Add tests for foreign-owned IDs, missing IDs, duplicate IDs, partial retry, and parent-not-written-on-preflight-failure.

Risk: medium. Must be implemented with careful preservation of operation retry semantics.

### P2 — Draft save reads and resolves the same form/catalogue twice

In `11_DI3_SupplyDomain.gs`, `di3SaveSupplyDraft()` first calls `di3ResolveSupplyFormLines_(false)` and builds a financial plan to validate inputs before creating missing PackVariants. It then calls `di3ResolveSupplyFormLines_(true)` and rebuilds the financial plan.

The two resolver calls re-read the same form line range, reload the product option index and reload the PackVariants index. The validation-before-creation ordering is good and must remain, but the repository snapshots can potentially be reused.

**Recommendation:** split parsing/validation from variant materialization. Read form lines and product/variant indexes once, validate and build the provisional plan, create only missing variants in a batch using those indexes, then attach the returned IDs to the already-validated line objects and build the final plan. Do not move variant writes before complete validation.

Risk: medium; add tests for invalid form data creating zero variants, repeated same product/fascia, reordered rows, and stable supply_item_id reconciliation.

### P2 — Full edit repeats the same line/catalogue resolution for non-received supplies

In `36_DI3_SupplyFullEdit.gs`, `di3SaveFullSupplyEdit()` first builds a plan with `createVariants=false`; for a non-received supply it then builds the plan again with `createVariants=true`. This repeats the same form and catalogue reads, analogous to ordinary draft save.

**Recommendation:** share the same parsed form/catalogue snapshot between the read-only validation plan and the variant-materialization phase. Do not create variants for received supplies or for preview-only calls.

Risk: medium; reuse the draft-save test matrix where applicable and add full-edit idempotency/retry tests.

### P2 — Supply selector summaries perform multiple searches over the same status column

In `11_DI3_SupplyDomain.gs`, `di3GetSupplyFormLoadSummary_()` queries individual status values and aliases one at a time. `di3GetSupplyDraftSummary()` does the same for CREATED aliases. The shared `di3ReadRowsByColumnValues_` helper in `00_DI3_SchemaRegistry.gs` already supports a bounded multi-key TextFinder search (up to 25 alternatives) and exact-value verification after retrieval.

**Recommendation:** replace the repeated per-status lookups with one multi-key lookup per summary. Keep alias normalization, de-duplication by `supply_id`, sorting, and the distinction between draft-only and all selectable supplies unchanged.

Risk: low-to-medium; add pure tests with canonical and legacy status labels, duplicates, and empty values.

### P2 — PackVariants reconciliation reads complete supply and item tables for a small affected-product set

In `58_DI3_SupplyCorrectionPackVariantProjection.gs`, `di3ReconcileCurrentPackVariantsForProducts_()` loads all rows from `V3_Supplies` and `V3_SupplyItems`, then filters down to affected product IDs in memory. The map builder itself correctly uses schema-derived column indexes and fails closed on ambiguous chronology.

**Recommendation:** consider a selective query plan: identify received supplies and relevant item rows for affected products with bounded lookups or a product-indexed snapshot. Benchmark against full-table reads; for small tables a single full read may still be faster and simpler. Preserve latest-received selection and ambiguity rejection exactly.

Risk: medium-to-high because a selective plan must not miss the latest received supply or historical tie. Do not implement without synthetic multi-supply tests and runtime comparison.

### P2 — Receipt path can refresh the supply register twice

In `12_DI3_SupplyReceiving.gs`, `di3CompleteSupplyReceipt_()` refreshes the supply register after committing the receipt. When the user receives from the register, `di3TransitionSelectedSupply_()` also clears the selected stage input and refreshes the same register again. The receipt handler also refreshes form validations; this is useful for direct/recovery entry points, but the selected-register path may do redundant UI work.

**Recommendation:** introduce a narrowly scoped refresh policy/result flag or a caller context so the register is refreshed once per user action, while recovery/direct receipt still refreshes the necessary UI. Do not suppress refreshes for background recovery or calls that have no outer UI owner.

Risk: medium; verify direct receive, register receive, historical receive and recovery separately.

### P3 — Current PackVariants receipt projection reloads the full variant index

`di3SetCurrentPackVariantsFromReceipt_()` loads the complete PackVariants index after the receipt has already loaded it during operation preparation. The reload is understandable for recovery (the operation handler must be self-sufficient), but the common path may be able to use an affected-product-scoped reader or a safe operation-local snapshot.

**Recommendation:** benchmark a product-scoped query before changing this. Do not persist a stale catalogue snapshot in an immutable operation payload merely to avoid one read.

Risk: medium; likely a smaller gain than the P1/P2 items.

### P3 — Supply form/date-panel setup performs many individual formatting and validation calls

`di3EnsureSupplyDatePanelLayout_()`, `di3SetupSupplyForm()`, `di3SetupSupplyRegisterSheet()` and warehouse setup functions contain many individual `getRange` formatting/validation operations. These are setup/repair paths, not the hot receipt/draft transaction path.

**Recommendation:** batch adjacent formatting, notes and validations where APIs allow, but only after measuring setup latency and preserving the legacy layout migration logic. Avoid a broad formatting rewrite.

Risk: medium; low priority.

### P3 — Some supply summary/projection code still relies on positional row indexes

Examples include status-summary extraction in `11_DI3_SupplyDomain.gs` and current-flag row projection in `58_DI3_SupplyCorrectionPackVariantProjection.gs`. The current indexes align with the current schema, and the recent PackVariants reconciliation fix already corrected a separate schema-offset mismatch. However, positional indexes are fragile when columns are inserted/reordered.

**Recommendation:** use `DI3_TABLE_SCHEMAS` header indexes for new/modified code and gradually replace fragile offsets when touching these functions. Do not perform a repository-wide mechanical replacement without tests.

Risk: low-to-medium; primarily maintainability and schema-drift prevention.

## Existing strengths to preserve

- Receipt creates a prepared operation with stable idempotency key and immutable payload before projecting stock.
- Receipt preflights scoped FIFO state, batches missing ledger/detail/lot rows, verifies persisted event components, then rebuilds FIFO.
- Status/date/updated_at writes are grouped into one contiguous row write.
- Supply line identity is `product_id + pack_variant_id`, not visual row position.
- Historical supply flow uses a confirmation snapshot/fingerprint and resumes an existing immutable receipt operation rather than generating a second receipt.
- Full edit blocks stock-sensitive changes to received supplies and directs them to SUPPLY_CORRECTION.
- Correction code has dedicated pure helpers for source audit, relation planning, FIFO preview/integration, execution, committed replay recovery and PackVariants reconciliation.
- SchemaRegistry provides exact-key and multi-key row readers; these should be reused rather than introducing custom sheet scans.
- MoneyCore uses integer minor units for allocation/cost calculations; do not replace it with floating-point shortcuts.
- FIFO has an incremental tail path and separate full-replay/archive recovery machinery. Do not simplify these paths as part of supply UI optimization.

## Test coverage and remaining verification

Dedicated suites exist for supply receiving, historical supply, full edit, supply workspace UX, and each major correction sub-area (source correction, relations, FIFO preview, FIFO integration, execution core, PackVariants). Shared stock/FIFO/operation/safety suites also apply.

The source audit identifies additional tests needed for:
- no persistent writes during ordinary supply preview;
- batched full-edit item lookup and preflight-before-write;
- multi-key supply status summary equivalence;
- draft/full-edit snapshot reuse without creating PackVariants on invalid input;
- exactly-once UI refresh for register receipt while retaining recovery refresh behavior;
- selective PackVariants reconciliation equivalence.

The current audit did not run Apps Script against a workbook. Runtime benchmarks and disposable-workbook acceptance remain outstanding.

## Recommended implementation order

1. Fix ordinary supply preview's ProductPublicCodes side effect and add a no-write regression test.
2. Batch full-edit item lookups and move all identity/ownership preflight before the first projection write.
3. Batch supply status summary lookups.
4. Reuse form/catalogue snapshots in draft save and full edit.
5. Eliminate duplicate register refresh on register-driven receipt.
6. Benchmark PackVariants reconciliation and receipt projection reads.
7. Consider setup formatting batching only if measurements justify it.

## Implemented optimization batch 1

The following source changes have now been applied on the audit branch:

1. **Read-only ordinary Preview.** `di3PreviewSupplyForm()` now calls `di3ResolveSupplyFormLines_(false, true)`. The read-only catalogue option index does not call `di3EnsureProductPublicCodes_()`; ordinary non-preview catalogue use retains the existing ensure behavior.
2. **Full-edit item preflight is batched.** `di3ApplySupplyDocumentEditOperation_()` now resolves all target and removed item IDs in one `di3ReadRowsByColumnValues_()` call. A pure projection-plan helper validates duplicate IDs, target/removal overlap, database duplicate identities, and ownership for every target/removal before the parent supply row or item rows are written. Existing batch update/append and descending delete behavior is retained.
3. **Supply selector status reads are batched.** `di3GetSupplyFormLoadSummary_()` and `di3GetSupplyDraftSummary()` now use one multi-key read per summary instead of repeated per-status lookups. De-duplication, user-facing status labels and chronology sorting remain in place.
4. **Draft and full-edit form/catalogue snapshots are reused.** New `di3LoadSupplyFormLineSnapshot_()` loads the 20-line form range, product option index and PackVariants index once. Draft save and full-edit save now reuse that operation-local snapshot for validation and subsequent variant materialization, preserving the validate-before-create order. Preview/full-edit preview continue to request read-only catalogue mode. The snapshot is not persisted or cached across executions.

Regression coverage added:
- read-only product option index does not allocate public codes;
- one operation-local form/catalogue snapshot is reused for validation and variant materialization;
- ordinary Preview passes read-only catalogue mode;
- selector and draft summaries use one multi-key lookup and preserve de-duplication/sorting/labels;
- full-edit projection planning handles updates, appends, removals, foreign ownership, duplicate identities and target/removal conflicts;
- full-edit handler performs batched lookup and preflight before parent projection write.

Validation:
- Apps Script syntax check: 69 modules passed.
- Supply domain regression runner: 182 passed, 0 failed. Sub-suites: catalog/supply 19; receipt 19; historical supply 12; full edit 33; correction source audit 15; relations 15; FIFO preview 7; FIFO integration 11; execution core 18; PackVariants 15; workspace UX 18.
- Additional CI suites in the same job: FIFO replay 46/46, order domain 22/22, catalog/order UX 14/14, system safety 39/39, warehouse dashboard 11/11, finance schema 4/4, deployment manager 57/57, snapshot audit 8/8.
- Release-contract and installation package jobs: PASS.

CI ran for the branch PR merge result containing head `5f890d46f0484468930ceec1eb874115afa45386`; package artifact was produced successfully. Runtime Apps Script measurements on a disposable workbook have not been run.

## CI / repository state

The audit plan was recorded in commit `33c1d23b25005c0db4f6ca18c41b9fe9aa26ef74`. On that exact commit, the Apps Script quality gates, release pipeline checks and installation-bundle packaging workflows all completed successfully.

Apps Script source and regression tests were modified in the first optimization batch. No live workbook operation, supply #17 operation, receipt, cancellation, correction, FIFO replay, restore or failure injection was run.


## Selective PackVariants reconciliation — implementation note

The normal reconciliation path no longer transfers every full row from `V3_Supplies` and `V3_SupplyItems`. It now:

1. Queries `V3_SupplyItems` by the affected `product_id` set using `di3ReadRowsByColumnValues_()`.
2. Collects the distinct parent `supply_id` values from those item rows.
3. Queries `V3_Supplies` by those IDs, then passes the selected rows to the existing pure chronology/variant selector.

This reduces full-row transfers while retaining the necessary scan of the lookup key column provided by the shared repository helper. A compatibility fallback reads all parent supply rows only when a matched item has a blank `supply_id`, preserving the previous detection of a received parent with a missing identity. Empty affected-item results do not read the parent table.

Three regression tests cover the selective query plan, blank-ID fallback, and empty-match short circuit. CI for this exact source revision is pending, and no runtime benchmark has been performed. The optimization has not been exercised against any workbook.


## Form clearing and full-edit launch performance — 2026-11-28

The code review found two avoidable sources of latency:

1. Full-edit entry called the comprehensive audit snapshot, which also queried StockLedger, StockMovementDetails, StockLots, StockAllocations and ProductCostHistory even though the editor's baseline fingerprint contains only the supply header and supply items. The same path also reloaded the supply and receipt operation already read by the caller.
2. `di3NewSupplyForm()` called `di3RefreshSupplyFormValidations()` after clearing values. That function rebuilds product and money validations, reads draft and selectable-supply summaries, and refreshes the stage panel. Clearing cell contents does not remove existing validations.

Changes:

- The full audit snapshot remains comprehensive by default for `di3AuditSupplyForFullEdit()`. Interactive full-edit entry now reuses the preloaded supply/receipt operation, reads and validates the immutable receipt payload only for received supplies, and skips unrelated stock/FIFO audit tables.
- Full-edit save now computes the baseline fingerprint from the already-loaded supply plus current supply items, without loading receipt-operation/payload or stock audit tables.
- New-supply clearing preserves installed validations and refreshes only the stage/date panel. “Обновить списки формы” remains available as the explicit validation refresh/repair action.
- Cancel/commit reload skips full validation rebuilding; selector validation is refreshed only when the document number changed.
- Fixed the stale legacy `di3BuildLatestReceivedPackVariantMap_(supplyRows, itemRows, affected)` invocation left after the selective PackVariants refactor; the selective read result is now the sole input to the chronology selector.

Exact-head validation on `8609e3c2c1b1a9aad97d51ba8ddae1688358afc8`:

- Apps Script syntax: 69/69 files.
- Supply domain/lifecycle suites: 189 passed, 0 failed (including 35 full-edit tests, 20 workspace UX tests, 18 PackVariants tests).
- FIFO 46/46; Order 22/22; Catalog/Order UX 14/14; System Safety 39/39; Warehouse Dashboard 11/11; Finance 4/4; Snapshot Audit 8/8.
- Release pipeline and installation package: PASS.

These are source/Node CI results, not runtime latency measurements. Full-edit launch, form clearing, and cancel/commit reload have not yet been timed in Apps Script. No workbook or supply data was changed.


## Follow-up — final regression guard and batched form clearing

- Batched `di3NewSupplyForm()` transient clears into `M4:M9` and `N2:N7`, reducing individual Spreadsheet service calls while preserving the existing field reset scope.
- Added a regression guard that the PackVariants reconciliation path consumes the selective-read result and does not retain the old undefined `supplyRows/itemRows` call.
- Final source/test commit: `7468c61f673f8748347066e1ab1061e06bdac708`.
- Exact commit CI: 69/69 Apps Script syntax; supply domain/lifecycle 192/192; FIFO 46/46; Order 22/22; Catalog/Order UX 14/14; System Safety 39/39; Warehouse Dashboard 11/11; Finance 4/4; Snapshot Audit 8/8. Release pipeline and installation package both PASS.
- These are source/Node checks only. Apps Script runtime timing and UI responsiveness have not been measured.
