# Supply scripts audit and optimization plan

Date: 2026-11-28
Repository: `brusvv/dots_inventory-`
Branch: `feature/supply-correction-fifo-replay`
Baseline HEAD: `f8eb0052fc420d9f48e1d3b52cfb4fb594b7ead3`

## Goal

Audit every Apps Script module that directly implements or materially supports the supply lifecycle. Identify safe opportunities to reduce Apps Script / Sheets service calls, repeated reads, duplicated transformation logic, unnecessary refreshes, and expensive view rebuilds without weakening inventory, FIFO, finance, idempotency, or recovery guarantees.

This document records the work plan and initial static observations. It is not approval to mutate a live workbook or execute supply/FIFO operations.

## Safety boundary

- Source inspection and repository-only documentation/tests are allowed.
- Do not run mutating Apps Script entry points, setup/migration, receipt, cancellation, full edit, correction, FIFO replay/rebuild, restore, or failure injection on a live workbook.
- Do not modify supply #17 or any live stock/supply data.
- Runtime performance measurements must use a disposable restored workbook and synthetic/disposable data.
- SC-04 write-boundary/failure-injection acceptance remains a separate action requiring explicit authorization.
- Any code optimization must be isolated, covered by regression tests, and pass exact-head CI before it is considered complete.

## Audit scope

### Direct supply workflow
- `11_DI3_SupplyDomain.gs` — form state, draft create/update, line resolution, financial preview, supply numbering, date panel.
- `12_DI3_SupplyReceiving.gs` — lifecycle transitions, receipt operation, recovery, cancellation, supply register.
- `34_DI3_HistoricalSupply.gs` — historical supply entry and receipt.
- `36_DI3_SupplyFullEdit.gs` — full-edit snapshot, preview, immutable operation payload and projection.
- `47_DI3_SupplyCorrection.gs`, `49_DI3_SupplyCorrectionRelations.gs`, `51_DI3_SupplyCorrectionFifoPreview.gs`, `53_DI3_SupplyCorrectionFifoIntegration.gs`, `55_DI3_SupplyCorrectionExecutionCore.gs`, `57_DI3_SupplyCorrectionOperation.gs`, `58_DI3_SupplyCorrectionPackVariantProjection.gs`, `60_DI3_SupplyCorrectionRuntimeProbe.gs`.

### Shared dependencies that affect supply correctness or performance
- `00_DI3_SchemaRegistry.gs`, `03_DI3_PackVariants.gs`, `07_DI3_StockCore.gs`, `08_DI3_WarehouseManager.gs`, `19_DI3_WarehouseViews.gs`, `20_DI3_FifoHistoryWorkspace.gs`, `22_DI3_MenuAndFilterUtils.gs`, `24_DI3_IncrementalFifo.gs`, `27_DI3_OperationExecutor.gs`, `30_DI3_MoneyCore.gs`, `31_DI3_FinanceDashboard.gs`.
- Menu/trigger entry points and any other module found to call supply workflow functions.

### Regression tests
- `13_DI3_CatalogAndSupplyTests.gs`, `14_DI3_SupplyReceivingTests.gs`, `35_DI3_HistoricalSupplyTests.gs`, `37_DI3_SupplyFullEditTests.gs`, `39_DI3_SupplyWorkspaceUxTests.gs`.
- Correction suites: `48`, `50`, `52`, `54`, `56`, `59` supply-correction test modules.
- Shared stock/FIFO/operation/system-safety tests where the supply paths depend on them.

## Work stages

- [x] S0 — Record scope, branch baseline, safety constraints and audit sequence.
- [x] S1 — Complete source inventory and call/dependency map (menus, triggers, UI, repositories, operations, projections, tests).
- [x] S2 — Static I/O audit: Sheets reads/writes, repeated range access, TextFinder scans, whole-table reads, row-by-row mutations, formatting/chart rebuilds.
- [x] S3 — Lifecycle audit: draft, edit, historical entry, status transitions, receipt, cancellation, recovery, full edit, received-supply correction (static source review).
- [x] S4 — Integrity audit: schema/header indexing, idempotency keys, immutable payloads, operation locking, retry behavior, status history, FIFO and PackVariants projections (static source review).
- [x] S5 — Test-coverage audit: initial tests added for the first three optimizations; broader invariant-to-test matrix remains part of follow-up.
- [x] S6 — Optimization proposal: rank candidates by expected benefit, risk, scope and measurable acceptance criteria.
- [x] S7 — First optimization batch implemented: read-only Preview, batched Full Edit identity preflight, multi-key supply status summaries, and operation-local form/catalogue snapshot reuse in draft and full-edit saves. Further candidates remain.
- [ ] S8 — Source/regression (182 supply-domain tests, 0 failures), release-contract and package CI passed for PR merge result containing head `5f890d46f0484468930ceec1eb874115afa45386`; disposable-workbook runtime benchmarks remain pending.
- [ ] S9 — Final report: changed files, measured results, residual risks and deferred runtime acceptance.

## Initial static observations (not yet a final audit)

1. `di3SaveSupplyDraft()` resolves form lines twice. Both passes read the same line range and reload product/pack-variant indexes; the second pass is needed to materialize missing variants, but the current structure appears to repeat reads that could potentially be reused after separating validation from variant creation.
2. `di3GetSupplyFormLoadSummary_()` and `di3GetSupplyDraftSummary()` query the same supply status column separately for multiple status aliases. The shared multi-key reader may reduce repeated TextFinder scans, provided alias normalization and exact-match behavior remain unchanged.
3. `di3ApplySupplyDocumentEditOperation_()` performs per-item identity lookups while reconciling target rows. This is a candidate for one batched lookup keyed by all target `supply_item_id` values, subject to preserving duplicate/ownership checks and partial-retry semantics.
4. `di3ReconcileCurrentPackVariantsForProducts_()` reads all supply and supply-item rows even when only a small set of products is affected. A selective read strategy may reduce data transfer, but must still select the latest received supply for each affected product and fail closed on ambiguous chronology.
5. `di3EnsureSupplyDatePanelLayout_()` and sheet setup functions contain many individual formatting/validation calls. These are likely lower priority because they are setup/repair paths, not the normal supply transaction path.
6. The warehouse dashboard and stock journal rebuild large views and perform structural chart/banding operations. These are adjacent performance concerns and should be measured separately from core supply transaction latency; existing C-01/F-09 performance work already documents the full-history journal/FIFO risks.
7. Static source inspection cannot establish actual Apps Script wall time or service latency. No speedup claim should be made without measurements from a disposable workbook.

## Invariants that optimizations must preserve

- Supply lifecycle remains: CREATED / Оформлена → SENT / Отправлена → AWAITING / Ожидает получения → RECEIVED / Получена, with cancellation rules unchanged.
- Supply-item identity remains `product_id + pack_variant_id`; row order is not identity.
- Received supply stock movements, lots, movement details, cost history and status history remain idempotent and recoverable.
- FIFO event ordering, replay archive requirements, active allocation projection and fail-closed backdated-event checks remain unchanged.
- PackVariants current/default selection continues to derive from the latest eligible received supply, with ambiguous chronology rejected.
- Immutable operation payloads, operation idempotency keys, lock semantics and committed-replay recovery remain unchanged.
- Money calculations remain in integer minor units where the existing MoneyCore contract requires it; supplier discounts, partner discounts and shipping allocation semantics remain unchanged.
- Schema access must use `DI3_TABLE_SCHEMAS` / header maps rather than newly introduced hard-coded offsets.

## Candidate acceptance criteria

- No new Apps Script service calls inside per-item/per-product loops where a bounded batch read/write is possible.
- No repeated full-table read within a single transaction when an already-read snapshot can be safely passed through.
- All writes remain batched and idempotent; no new append-before-identity or partial-projection window.
- Existing regression suites pass; new tests cover each changed invariant and retry boundary.
- Exact-head GitHub quality gates and release checks pass.
- Runtime benchmark claims require median/max measurements over 3–5 runs after warm-up on a disposable workbook; report rows/cells read and written, call counts where instrumentable, and execution time.

## Status

- S0–S4 and S6 are complete as a static repository audit; detailed findings are recorded in [SUPPLY_SCRIPTS_AUDIT_REPORT.md](SUPPLY_SCRIPTS_AUDIT_REPORT.md).
- S5 has initial coverage for the first optimization batch; the broader invariant-to-test matrix remains open.
- S7 has begun: the first four low-risk optimizations are implemented with regression tests.
- Source/regression, release-contract and package CI passed for the PR merge result containing the current optimization batch.
- S8 runtime timing on a disposable workbook and S9 final report remain pending; static call-count observations are not runtime benchmarks.


## Optimization batch 2 — selective PackVariants reconciliation

Implemented on the audit branch:

- Reconciliation now first reads only `V3_SupplyItems` rows matching affected `product_id` keys, then reads only parent `V3_Supplies` rows for the resulting `supply_id` set.
- The shared multi-key repository reader transfers the lookup column and fetches full rows only for matches; the previous unconditional full-width reads of both tables are removed from the normal path.
- If any affected item has a blank `supply_id`, the code deliberately falls back to a full parent-supply read. This preserves the existing fail-closed detection of a received parent with a missing identity.
- The pure latest-received selection algorithm, schema-derived indexes, chronology tie rejection, duplicate line checks, and PackVariants ownership validation remain unchanged.

Added regression coverage for selective item/parent reads, the blank-ID fallback, and the no-matching-items fast path. Exact-head CI is pending; do not treat this source change as validated until the workflows complete. Runtime comparison on a disposable workbook remains pending.


## Optimization batch 3 — form clear and full-edit launch latency

Implemented in source on `feature/supply-correction-fifo-replay`:

- `di3BuildSupplyFullEditSnapshot_()` keeps its complete stock/FIFO audit as the default, but accepts operation-local options to omit stock audit tables and/or receipt payload lookup when callers only need the business fingerprint.
- Full-edit entry reuses the already loaded supply and receipt operation. For received supplies it still reads and verifies the immutable receipt payload; it skips unrelated StockLedger, StockMovementDetails, StockLots, StockAllocations and ProductCostHistory reads.
- Full-edit save uses the already loaded supply and only reads current supply items for the baseline fingerprint. It skips stock audit, receipt payload and redundant receipt-operation lookup.
- `di3NewSupplyForm()` clears values without rebuilding product dropdowns, monetary validations and supply summaries. Existing validations remain installed; the existing menu command “Обновить списки формы” remains the explicit repair/refresh path.
- Full-edit cancel/commit reload uses `skipValidationRefresh` to avoid rebuilding the whole validation set. If the supply number changed, only the selector validation is refreshed.

Regression tests cover the lightweight snapshot call contracts, preserved full audit default, clear-without-validation-rebuild behavior, and targeted reload behavior. Exact source CI passed on `8609e3c2c1b1a9aad97d51ba8ddae1688358afc8`: 69 Apps Script files syntax-checked; supply domain 189/189; FIFO 46/46; order 22/22; catalog/order UX 14/14; system safety 39/39; warehouse dashboard 11/11; finance 4/4; snapshot audit 8/8. Release pipeline and installation package also passed. Runtime timing has not been measured; no Apps Script workbook was opened or changed.


## Follow-up — batched clearing and final regression guard

- `di3NewSupplyForm()` now clears adjacent transient fields in two range operations (`M4:M9` and `N2:N7`) instead of separate calls for preview/reason and identity/mode cells.
- Added a structural regression test ensuring `di3ReconcileCurrentPackVariantsForProducts_()` consumes the selective-read result and cannot retain the stale full-table call.
- Final source/test commit for this batch: `7468c61f673f8748347066e1ab1061e06bdac708`.
- Exact commit quality gates passed: 69 Apps Script syntax files; 192 supply-domain/lifecycle assertions; FIFO 46/46; Order 22/22; Catalog/Order UX 14/14; System Safety 39/39; Warehouse Dashboard 11/11; Finance 4/4; Snapshot Audit 8/8. Release pipeline and installation package passed on the same commit.
- Runtime timing is still pending on a disposable restored workbook.
