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
- [ ] S1 — Complete source inventory and call/dependency map (menus, triggers, UI, repositories, operations, projections, tests).
- [ ] S2 — Static I/O audit: Sheets reads/writes, repeated range access, TextFinder scans, whole-table reads, row-by-row mutations, formatting/chart rebuilds.
- [ ] S3 — Lifecycle audit: draft, edit, historical entry, status transitions, receipt, cancellation, recovery, full edit, received-supply correction.
- [ ] S4 — Integrity audit: schema/header indexing, idempotency keys, immutable payloads, operation locking, retry behavior, status history, FIFO and PackVariants projections.
- [ ] S5 — Test-coverage audit: map invariants to tests; identify gaps and add pure regression tests before changing behavior.
- [ ] S6 — Optimization proposal: rank candidates by expected benefit, risk, scope and measurable acceptance criteria.
- [ ] S7 — Implement approved low-risk optimizations in small commits; no live workbook actions.
- [ ] S8 — Run quality gates and exact-head CI; compare code-level I/O counts and, where possible, runtime benchmarks on a disposable workbook.
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

Only S0 is complete at document creation. The initial observations are leads for the full audit, not approved code changes.
