# Dots Inventory v4 — RC9 work plan and acceptance checklist

Last updated: 2026-11-28  
Working branch: `feature/github-preview-releases`  
Branch HEAD at update: `5302163d88e657444c2c7e18377260d68ecb95d3`

> This is the execution checklist. Mark an item `[x]` only when the stated evidence exists. `[ ]` means not done or not evidenced; `[~]` means partially completed; `[!]` means blocked/deferred. Source implementation, CI, and live Google Apps Script acceptance are separate evidence classes.

## 0. Safety and scope gates

- [x] Keep production RC8 and its workbook untouched.
- [x] Keep PR #7 Draft; no merge, tag, GitHub Release, Preview/Stable publication, or production update.
- [x] Keep N-02 runtime fault-injection deferred at the user's request.
- [ ] Confirm the exact disposable Apps Script project and workbook before any write/runtime acceptance.
- [ ] Obtain explicit approval immediately before each destructive or business-data write operation.
- [ ] Record before/after fingerprints and backup references for every approved write test.

## 1. Source audit and GitHub release pipeline — current work

### 1.1 Redirect security patch

- [x] Disable automatic redirects for authenticated GitHub API requests.
- [x] Follow signed asset redirects manually, with redirects disabled per request.
- [x] Validate every redirect hop as HTTPS and allowlisted to GitHub asset hosts.
- [x] Enforce redirect hop limit and fail closed on untrusted host / invalid response.
- [x] Add regression tests for untrusted second-hop redirect and API 302 behavior.
- [x] GitHub Actions passed for commit `1e5fa4181f106ba31560aa2578248599424abd4a` (includes redirect tests).
- [x] Workflow logs reviewed: 40 GitHub deployment-manager tests passed; release contract and tag policy passed; Apps Script quality gates passed; package build passed.

### 1.2 Continue static installer / rollback audit

- [x] Source review + regression test: preview preserves exact target `appsscript.json`.
- [x] Source review + regression test: preview preserves non-`SERVER_JS` files and unmanaged local `SERVER_JS` modules.
- [x] Source review + regression test: Apps Script `SERVER_JS` name normalization verified.
- [x] Duplicate manifest names, non-server name collisions, missing source, source hash/size mismatch, extra downloaded files and cross-type project-name collisions are fail-closed across preview, fingerprint and source-backup creation/validation.
- [x] Source review + regression tests: fingerprint includes name, type and source, sorted deterministically.
- [x] Source review: NO returns `CANCELLED` without `projects.updateContent`; verified source backup is retained and returned.
- [x] Source review: fingerprint checked against preview, after backup, and immediately before `projects.updateContent`.
- [x] Source review: ambiguous update error returns `UPDATE_RESULT_UNCERTAIN`; no retry or rollback is invoked automatically.
- [x] Source review: unavailable read-back and mismatched read-back return separate statuses with backup link.
- [x] Source review: rollback validates Drive metadata, folder membership, Script ID, envelope and per-file hashes.
- [x] Source review + regression test: rollback preserves current manifest and post-write verifies the complete target file set.
- [x] Regression coverage: 47 GitHub Deployment Manager tests. Added integration-style mocked installer tests for NO cancellation (verified backup retained, no updateContent), uncertain update result (single call/no retry), unavailable post-write read-back, and mismatched post-write file set. Live Apps Script behavior remains unverified.
- [x] Limits documented in release pipeline and rollback confirmation.

### 1.3 Release governance

- [ ] D-03 read-only release inspection accepted in disposable Apps Script project.
- [ ] D-04 Drive source backup/read-back accepted.
- [ ] D-05 preview accepted.
- [ ] D-05 confirmed install and post-write verification accepted.
- [ ] D-06 source rollback accepted.
- [ ] D-07 runtime acceptance completed on disposable project/workbook.
- [ ] D-08 browser bootstrap accepted separately.
- [ ] PR review and merge decision explicitly approved.
- [ ] Preview tag/release explicitly approved and verified.
- [ ] Stable/RC9 release explicitly approved only after all required gates pass.

## 2. R0 — test environment inventory (read-only)

- [x] Identify Dots beta 4 as the test workbook.
- [x] Confirm separate bound Apps Script Script ID is recorded by owner.
- [x] Confirm initial Bootstrap reported 47/47 modules installed and verified.
- [x] Confirm initial timezone evidence: `Europe/Moscow`.
- [x] Confirm Dry Run: READY, schema v4 target v4, clean final baseline, no planned changes.
- [x] Confirm Dashboard chart geometry: anchor row 81, 480 px height, 25 reserved rows, grid 106 rows; rows 100–106 must not be deleted.
- [x] Confirm bootstrap source backup payload/hash/read-back and target IDs; note it contains only pre-install manifest + Bootstrap, not all 47 modules or Script Properties.
- [~] Runtime source comparison: 44/47 modules matched Bootstrap commit; 3 modules differ; full mismatch details still required.
- [ ] Obtain correct `DI3_MISMATCH_DETAILS` for modules 11, 19 and 35.
- [ ] Resolve/accept each of the three diffs; do not overwrite based on summary fragments.
- [ ] Verify actual `appsscript.json` timezone and OAuth scopes.
- [ ] Inventory deployments and trigger handlers.
- [ ] Inventory Script Properties by key names/presence only; do not export secret values.
- [ ] Capture current project file fingerprint and compare against intended release source.
- [ ] Verify backup metadata, size, folder membership and contents; distinguish bootstrap backup from full source backup.

## 3. N-03 — clean final schema v4

Status: runtime acceptance pending. No destructive operation has been approved.

- [ ] Re-run read-only Dry Run and Diagnostics immediately before test.
- [ ] Verify no unexpected populated tabs and no pending stock operations.
- [ ] Verify backup is current and recoverable for the exact disposable target.
- [ ] Review exact migration/setup plan and expected writes.
- [ ] Obtain explicit approval for Clean Start / schema migration.
- [ ] Run clean baseline installation on disposable copy.
- [ ] Verify schema v4, required sheets, headers, indexes and migration journal.
- [ ] Re-run installation; confirm idempotency and no duplicate sheets/ranges/triggers.
- [ ] Test controlled interruption at approved safe checkpoint.
- [ ] Verify resume/recovery and no partial business-data mutation.
- [ ] Verify menu, triggers, timezone and diagnostics after installation.
- [ ] Record final before/after fingerprints and logs.

## 4. Supply Workspace and UX acceptance

### 4.1 Existing UX scenarios

- [~] UX-01–06: implemented; user previously checked 7 of 8 scenarios.
- [ ] Complete the remaining product identity scenario.
- [ ] UX-07–09: verify actual confirmation dialogs and decline via NO.
- [ ] UX-10: verify manual IN/OUT confirmation and decline via NO.
- [ ] Verify each operation's cancel path leaves data unchanged.
- [ ] Verify confirmation text identifies the exact operation and affected entity.

### 4.2 Supply lifecycle

- [ ] Create a new test supply.
- [ ] Verify lifecycle: Оформлена → Отправлена → Ожидает получения → Получена.
- [ ] Verify receipt of multiple products/variants and exact quantities.
- [ ] Verify FIFO layers are created exactly once.
- [ ] Verify retry/double-click does not duplicate receipt or stock movements.
- [ ] Verify full edit of a test supply, including all supported fields.
- [ ] Verify edit/cancel behavior by status and closed-period rules.
- [ ] Verify historical supply entry mode and recovery of interrupted receipt.
- [ ] Verify mutually exclusive modes: new supply vs historical supply vs full edit.
- [ ] Verify menu commands and context availability in every supply status.
- [ ] Verify ScriptLock is not held while a user dialog is open.
- [ ] Verify register ordering and supply number date prefix.
- [ ] Verify diameter/shape/thickness/foam values remain text/typed correctly.

### 4.3 Warehouse Dashboard

- [x] Source chart sizing calculation aligned with Dashboard layout.
- [x] Live chart geometry confirmed; 106-row grid is correct.
- [ ] Verify chart actually renders data in Sheets.
- [ ] Verify source range `N1:O21` and hidden helper range.
- [ ] Run W-1 through W-10 and record individual results.
- [ ] Verify filter labels, category ordering, duplicate product labels and chart explanation.
- [ ] Verify view errors are isolated and chart recreation is idempotent.
- [ ] Verify Dashboard refresh does not mutate stock/FIFO ledgers.

## 5. FIFO, orders, returns and historical sales

### 5.1 F-01 — return after later stock movement

- [x] Source fix implemented (source-ready; not runtime accepted).
- [ ] Test dispatch of order A.
- [ ] Perform a separate stock/FIFO operation after dispatch.
- [ ] Return order A.
- [ ] Verify return resolves original allocations by stable movement identity, not only current active FIFO run.
- [ ] Verify exact lots, quantities, costs and ledger linkage.
- [ ] Verify retry does not double-return stock.

### 5.2 F-02 — historical sales

- [x] Source implementation exists (source-ready; not runtime accepted).
- [ ] Verify historical sale date and dispatch/completion dates.
- [ ] Verify FIFO chronology and cost allocation relative to later/earlier movements.
- [ ] Verify PeriodGuard and closed-period behavior.
- [ ] Verify migration v3 → v4 only on disposable copy and only after approval.
- [ ] Verify Finance records and dashboard reflect historical business date.
- [ ] Verify duplicate import/retry protection.

### 5.3 FIFO integrity and recovery

- [ ] Verify F-06 archive/replacement of FIFO allocations.
- [ ] Verify F-07 stable ledger sequence/cursors independent of row numbers.
- [ ] Verify FIFO integrity checks on normal and interrupted operations.
- [ ] Verify F-09 view/log update isolation and bounded reads.
- [ ] Verify F-10 repeated period close preserves opening audit trail.
- [ ] Verify F-18 money rounding at half-cent boundaries, including 10.075.
- [ ] Verify F-19 replay/recovery regression coverage and failure classification.
- [ ] Verify F-20 actor attribution and audit identity limitations.

### 5.4 N-02 — deferred runtime fault injection

- [!] Deferred by user. Do not run until explicitly resumed.
- [ ] Transient service error leaves replay PREPARED and retryable.
- [ ] Integrity violation moves replay to QUARANTINED.
- [ ] Quarantine resolution requires owner attestation and reason.
- [ ] Archive fingerprints are validated.
- [ ] Related operation is re-enqueued in a new retry epoch.
- [ ] Manual resolution never directly edits StockLedger, StockLots, StockAllocations or FifoProductState.

## 6. Finance and commission

- [x] Commission payer selection and calculation changes exist in source.
- [ ] Verify BUYER payer case with goods 300, commission 10%, FIFO cost 105.
- [ ] Verify SELLER payer case with same amounts.
- [ ] Verify buyer payable, seller revenue and profit are separated correctly.
- [ ] Verify rates 5%, 9%, 10% and a nonstandard configured rate.
- [ ] Verify discounts are applied to seller revenue as specified.
- [ ] Reconcile a set of completed test orders against ledger and Finance.
- [ ] Verify Finance Dashboard values and labels.
- [ ] Verify schema migration and old-order compatibility on disposable copy.
- [ ] Verify F-16 Finance Dashboard does not rely on fragile magic column indexes.

## 7. Reliability, concurrency and performance

- [ ] F-03: historical-supply dialogs do not hold global ScriptLock while waiting.
- [ ] F-04: payload size limits and safe failure around 50,000 characters.
- [ ] F-05: stale payload cannot be executed by a repeated save.
- [ ] F-08: restore cancelled supply only if included in RC9 scope; otherwise track as post-RC9.
- [ ] F-11: previewing a sequence number does not consume it.
- [ ] F-13: backup flush/read-back/timestamp/lock duration.
- [ ] F-14: two independent GAS sessions prove concurrency behavior.
- [ ] C-01: FIFO load tests at 500 / 1,000 / 2,000 movements.
- [ ] C-06: concurrent mutation and lock behavior.
- [ ] C-08: TextFinder behavior and bounds.
- [ ] C-09: UNKNOWN/FREE inventory cases.
- [ ] C-10: Money Core boundaries.
- [ ] C-15: finance reconciliation under load.
- [ ] C-16: Finance Dashboard runtime acceptance.
- [ ] C-17: final UX/role/access audit, subject to owner agreement on roles.

## 8. Historical supplies import — separate controlled workstream

- [ ] Complete missing source data for historical supply #8 (switheskeys).
- [ ] Reconcile total and Jade Air unit allocations for historical supply #11.
- [ ] Verify fractional amount 1,579.15 ₽ across two packages for Mifuny #4; do not silently round.
- [ ] Confirm discount allocation rules for supplies #4–5, #7, #10 and #11.
- [ ] Keep NxGLOBAL #6 excluded from the #4–5 shared discount.
- [ ] Build import preview with product/variant rows, package counts and unit costs.
- [ ] Check duplicate historical supply detection and import idempotency.
- [ ] Obtain explicit approval before import/receipt.
- [ ] Import through supported supply workflow only; never write directly to stock ledger.
- [ ] Reconcile final stock, FIFO layers, costs and supplier totals.

## 9. Post-RC9 backlog (not a release blocker unless scope changes)

- [ ] SUPPLY_CORRECTION with compensating movements and candidate FIFO replay.
- [ ] Partial order returns.
- [ ] Duplicate historical supply detection enhancements.
- [ ] Restore cancelled supplies (if not promoted into RC9).
- [ ] Selective export/import.
- [ ] Scheduled backups and retention policy.
- [ ] F-17 delivery methods reference data and management.
- [ ] Final role model and C-17 access policy if not agreed before release.

## 10. RC9 release gate

RC9 may be considered only when all mandatory release-blocking items have evidence and the owner approves promotion.

- [ ] All P0 business-cycle defects accepted in runtime: supply → receipt → FIFO → order → dispatch → return → finance.
- [ ] N-03 clean baseline and recovery accepted on disposable copy.
- [ ] N-02 runtime acceptance resumed and completed, or explicitly reclassified by owner as post-RC9 with documented risk acceptance.
- [ ] Finance and commission reconciliation accepted.
- [ ] Dashboard visual/data acceptance accepted.
- [ ] Backup/restore and concurrency acceptance accepted.
- [ ] D-07 runtime acceptance passed.
- [ ] CI green for exact release candidate commit.
- [ ] PR chain reviewed and merged only with approval.
- [ ] Preview and Stable release actions explicitly approved.
- [ ] Final production backup and deployment plan reviewed before any production update.

---

## Evidence log

Add one entry per executed test. Include date/time, target copy, source commit, test ID, input fixture, expected result, actual result, log/artifact link, and operator. Do not paste secrets or full IDs.

| Date | Target copy | Commit | Test ID | Result | Evidence |
|---|---|---|---|---|---|
| 2026-11-28 | GitHub source branch | 1e5fa418 | GitHub + Google API redirect hardening; 40 deployment-manager tests, quality gates and package build passed | PASS (source/CI only) | [Release pipeline](https://github.com/brusvv/dots_inventory-/actions/runs/46082609384), [Quality gates](https://github.com/brusvv/dots_inventory-/actions/runs/46082609396), [Package build](https://github.com/brusvv/dots_inventory-/actions/runs/46082609330) |
| 2026-11-28 | GitHub source branch | 3c7d67c8 | Cross-type duplicate identity hardening; installer cancel/uncertain-write/post-write read-back regression tests; 47 deployment-manager tests passed | PASS (source/CI only) | [Release pipeline](https://github.com/brusvv/dots_inventory-/actions/runs/46083590635), [Quality gates](https://github.com/brusvv/dots_inventory-/actions/runs/46083590632), [Package build](https://github.com/brusvv/dots_inventory-/actions/runs/46083590656) |
| 2026-11-28 | GitHub source branch | 5302163d | Added rollback cancel/uncertain-write/read-back failure regression tests; 51 deployment-manager tests passed | PASS (source/CI only) | [Release pipeline](https://github.com/brusvv/dots_inventory-/actions/runs/46083678406), [Quality gates](https://github.com/brusvv/dots_inventory-/actions/runs/46083678413), [Package build](https://github.com/brusvv/dots_inventory-/actions/runs/46083678340) |

