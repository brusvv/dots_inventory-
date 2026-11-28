# Dots Inventory v4 — RC9 work plan and acceptance checklist

Last updated: 2026-11-28  
Working branch: `feature/supply-correction-fifo-replay`  
Branch HEAD at update: `a763a36cbe714a4f0cd9849d50152b2a649c8e16`

> This is the execution checklist. Mark an item `[x]` only when the stated evidence exists. `[ ]` means not done or not evidenced; `[~]` means partially completed; `[!]` means blocked/deferred. Source implementation, CI, and live Google Apps Script acceptance are separate evidence classes.

## 0. Safety and scope gates

- [x] Keep production RC8 and its workbook untouched.
- [x] Keep all existing PRs Draft; no merge, tag, GitHub Release, Preview/Stable publication, or production update.
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

- [x] Re-open and fully revalidate the selected rollback backup after YES: file identity, name, metadata, Script ID, folder membership, envelope/hash, and target fingerprint are checked again immediately before update.
- [x] Regression tests: selected backup is re-read after confirmation; if it becomes unavailable before write, rollback fails closed and makes zero `projects.updateContent` calls.
- [x] CI for source/test state `05d0fafe634f7bb7086faa2c46df0082468bf085`: Release Pipeline, Apps Script quality gates and package build all passed. Release Pipeline includes rollback revalidation (57/57); snapshot auditor/probe tests 8/8.

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
- [x] Regression coverage before selected-backup revalidation: 55 GitHub Deployment Manager tests. Added mocked integration-style installer and rollback tests for NO cancellation, uncertain update result (single call/no retry), unavailable post-write read-back, mismatched post-write file set, final fingerprint/concurrency guards, Drive metadata mismatch and backup moved outside the configured folder. Live Apps Script behavior remains unverified.
- [x] Source: rollback reopens and fully revalidates the selected Drive backup after YES, rebuilds the rollback target and checks the target fingerprint before update.
- [x] Tests: added successful post-confirmation re-read and fail-closed backup-unavailable-after-YES cases.
- [x] Initial harness scoping and fixture issues were corrected; final source/test commit `f818dc2dc72663f32579f3aee534abc8c2af294e` passed all three CI workflows. GitHub Deployment Manager: 57/57.
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

## 2. R0 — test environment inventory (runtime inspection read-only; temporary probe insertion is a separately approved source write)

- [x] Extend the runtime probe to report manifest timezone/OAuth scopes, project fingerprint, trigger metadata, deployment version metadata, Script Properties key names only, and backup payload/Drive metadata/folder membership.
- [x] Harden OAuth-authenticated Apps Script API reads in the probe with `followRedirects: false`.
- [x] Strengthen snapshot auditor backup acceptance to require valid Drive metadata and configured-folder membership.
- [x] Add regression coverage for probe redirect behavior and invalid backup metadata/folder membership; Apps Script quality gates passed 8/8. Current verified branch HEAD `4aae90bad96d73a73d98b741f9000fc01d4acd5a`: Release Pipeline, quality gates and package build all PASS.
- [ ] Obtain explicit approval before adding/removing the temporary probe file in the exact disposable bound project.
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
| 2026-11-28 | GitHub source branch | 27d56ec7 | Added installer and rollback final fingerprint/concurrency guard tests; 53 deployment-manager tests passed | PASS (source/CI only) | [Release pipeline](https://github.com/brusvv/dots_inventory-/actions/runs/46083741968), [Quality gates](https://github.com/brusvv/dots_inventory-/actions/runs/46083742016), [Package build](https://github.com/brusvv/dots_inventory-/actions/runs/46083741941) |


| 2026-11-28 | GitHub source branch | 4f4508ad | Installer now revalidates Drive backup metadata, payload identity and backup-folder membership; 55 deployment-manager tests passed | PASS (source/CI only) | [Release pipeline](https://github.com/brusvv/dots_inventory-/actions/runs/46083992642), [Quality gates](https://github.com/brusvv/dots_inventory-/actions/runs/46083992555), [Package build](https://github.com/brusvv/dots_inventory-/actions/runs/46083992637) |


## 2026-11-28 — Evidence: rollback backup revalidation

| Date | Target copy | Commit | Test ID | Result | Evidence |
|---|---|---|---|---|---|
| 2026-11-28 | GitHub source branch | 76cfd014 | Re-read selected rollback backup after YES; block if backup disappears before write | Source change + regression tests committed; package build PASS; two CI workflows pending at record time | [Source commit](https://github.com/brusvv/dots_inventory-/commit/0b8f3f30ff6375162748b57796438ab51b7a1c67), [Test commit](https://github.com/brusvv/dots_inventory-/commit/76cfd0140ce39c403a203251a76dac7740eed3dd), [Release Pipeline](https://github.com/brusvv/dots_inventory-/actions/runs/46084373426), [Quality gates](https://github.com/brusvv/dots_inventory-/actions/runs/46084373429), [Package build](https://github.com/brusvv/dots_inventory-/actions/runs/46084373385) |


## Evidence update — post-confirmation selected-backup revalidation

| Date | Target | Commit | Result | Evidence |
|---|---|---|---|---|
| 2026-11-28 | GitHub source branch | 0b8f3f30 / 76cfd014 / 05a84fbc | Source fix committed; first runner attempt failed due to test harness ReferenceError; harness corrected; CI pending at evidence update | [Source](https://github.com/brusvv/dots_inventory-/commit/0b8f3f30ff6375162748b57796438ab51b7a1c67), [Tests](https://github.com/brusvv/dots_inventory-/commit/76cfd0140ce39c403a203251a76dac7740eed3dd), [Harness fix](https://github.com/brusvv/dots_inventory-/commit/05a84fbc290543fe1684e264c477d1a3c4fbd02a), [Release Pipeline run](https://github.com/brusvv/dots_inventory-/actions/runs/46084428704), [Quality gates](https://github.com/brusvv/dots_inventory-/actions/runs/46084428707), [Package build](https://github.com/brusvv/dots_inventory-/actions/runs/46084428715) |


## Evidence update — selected rollback backup revalidation

| Date | Target | Source/test state | Result | Evidence |
|---|---|---|---|---|
| 2026-11-28 | GitHub source branch | `57327687990979594ed69aa7ee88cb7f6b132738` | PASS — Release Pipeline, Apps Script quality gates, package build; includes rollback backup reread after YES and unavailable-backup fail-closed test | [Release Pipeline](https://github.com/brusvv/dots_inventory-/actions/runs/46084515885), [Quality gates](https://github.com/brusvv/dots_inventory-/actions/runs/46084515883), [Package](https://github.com/brusvv/dots_inventory-/actions/runs/46084515887) |


## 2026-11-28 — consolidated work plan and PR review

### Current source branch

- Working branch: `feature/supply-correction-fifo-replay`.
- Branch HEAD at this update: `a763a36cbe714a4f0cd9849d50152b2a649c8e16`.
- It is 201 commits ahead of `feature/github-preview-releases`, with no commits behind; the incremental comparison contains 37 changed files. Treat this as a stacked continuation of the release/updater branch, not as a replacement for the existing PR chain.
- SC-01 through SC-04 are implemented in source: immutable receipt/source audit; append-only correction relation journal; candidate/effective FIFO preview and normal replay integration; explicit correction operation with recovery and a read-only all-sheet preview probe.
- SC-04 remains source-ready only. The mutating API `di3CorrectReceivedSupply()` is not exposed in the menu. It must not be used on a live/production supply until runtime acceptance on a restored disposable workbook.
- Known SC limitation: a second correction of the same supply is blocked; correction-chain document hydration is not implemented.
- Latest source CI is run [46100406477](https://github.com/brusvv/dots_inventory-/actions/runs/46100406477) on parent source commit `ae963fc958991ae809453cf9551933f299e8c849`: Apps Script syntax and all regression suites passed. The current branch HEAD adds documentation only after that source commit; therefore this is source/Node evidence, not Apps Script runtime evidence.
- The all-sheet preview probe is prepared but has not been executed in a bound workbook. No live Apps Script project, Drive, spreadsheet, production data, or deployment was changed.

### GitHub pull-request audit (2026-11-28)

All currently open PRs are Draft. No PR has submitted reviews or inline review threads. The PRs are stacked and must not be merged out of order.

| PR | Scope | Current assessment | Decision |
|---|---|---|---|
| #1 | N-03 clean schema v4, F-02 and core hardening | Source CI passed; broad foundational change; runtime migration/setup and business-flow acceptance remain pending. Includes N-02 source resolution code, but N-02 runtime fault injection remains deferred. | Keep Draft; do not merge before disposable-copy acceptance. |
| #2 | D-01/D-02 release manifest/package | Base is PR #1 branch; GitHub reports merge conflict/not mergeable at this snapshot. | Keep Draft; rebase/resolve only after its base is finalized. |
| #3 | D-03/D-04 release inspection and verified source backup | Depends on #2; source tests pass; Apps Script scopes and actual Drive backup/read-back are not runtime accepted. | Keep Draft. |
| #4 | D-05 confirmed installer | Depends on #3; source tests pass; no disposable-project install/read-back acceptance. | Keep Draft. |
| #5 | D-06 verified code rollback | Depends on #4; source tests pass; no disposable-project rollback acceptance. | Keep Draft. |
| #6 | D-07 runtime acceptance runbook | Depends on #5; documentation/CI only. D-07 execution is still blocked until the release chain is available and a disposable project is prepared. | Keep Draft. |
| #7 | Stable/Preview channels and updater safeguards | Depends on #6; release pipeline, package build and quality gates passed on its checked head. D-07 live runtime acceptance has not run. | Keep Draft; no tag/release/merge yet. |
| #8 | D-08 browser-only bootstrap | Depends on #7; CI passed on its checked head, but GitHub reports not mergeable. Its bootstrap pins an older source commit and needs an explicit freshness/upgrade decision before acceptance. | Keep Draft; inspect/update the pinned source before merge. |
| #10 | D-09 pinned branch selector | Depends on #7; focused run [46099723578](https://github.com/brusvv/dots_inventory-/actions/runs/46099723578) passed 55 syntax checks and 69 deployment-manager tests. Full release-pipeline CI on the exact PR head and runtime acceptance are not evidenced. | Keep Draft; require full CI and disposable-project runtime acceptance. |

### PR sequencing and next action

1. Keep the foundational chain #1 → #2 → #3 → #4 → #5 → #6 → #7 intact. Do not merge a child PR before its base is accepted.
2. #8 and #10 are separate stacked follow-ups to #7; they are not prerequisites for the supply correction work.
3. Created Draft [PR #11](https://github.com/brusvv/dots_inventory-/pull/11) from `feature/supply-correction-fifo-replay` to `feature/github-preview-releases`. This makes the 34-file incremental SC/supply delta reviewable without mixing it into the older D-02 PR. The new PR remains blocked from merge until source review and disposable-workbook runtime acceptance.
4. Run the complete quality-gates, release-pipeline and package workflows on the new PR head. The current green run is on its parent source commit.
5. Do not run N-02 fault injection, production migration, received-supply correction, release publication, or deployment without separate explicit approval.

### Revised verification order

- [ ] Review/accept the foundational release chain in dependency order, but only after its required runtime gates.
- [ ] Complete R0 inventory on the exact disposable project: actual manifest/scopes, timezone, project fingerprint, triggers/deployments, Script Properties key names only, and verified full source backup.
- [ ] Resolve the three source mismatches (modules 11, 19, 35) from exact diffs; do not overwrite based on summaries.
- [ ] Complete N-03 Dry Run, backup and v3→v4 migration on the disposable copy only, after explicit approval.
- [ ] Finish Supply Workspace UX, lifecycle, Dashboard W-1–W-10 and commission/Finance runtime acceptance.
- [ ] Complete F-01 return-after-later-stock-operation and F-02 historical-sale chronology/PeriodGuard acceptance.
- [ ] Complete Backup/Restore-as-new, F-13 timing, F-14 two-session ScriptLock, and remaining C-01–C-17 checks.
- [ ] SC-01: execute the read-only source audit on representative received supplies in the disposable copy; verify blocked/mismatch cases.
- [ ] SC-02/03: validate relation resolution, candidate replay and effective FIFO projections in the disposable copy, including REMOVE-only products and insufficient-stock cases.
- [ ] SC-04: first test the all-sheet read-only preview probe; then test correction execution only after a separately approved backup, exact preview, and explicit write authorization. Inject failures at every write boundary only in the disposable copy.
- [ ] Keep second correction of the same supply out of scope until document hydration and correction-chain acceptance are implemented.
- [!] N-02 runtime fault injection remains deferred by the user.
- [ ] Final RC9 gate: exact candidate commit CI green, all required runtime evidence recorded, PR approvals/merge order explicitly authorized, and no unresolved P0/P1 defects.


## 2026-11-28 — PR #11 exact-head CI evidence

- [x] Created Draft [PR #11](https://github.com/brusvv/dots_inventory-/pull/11), head `feature/supply-correction-fifo-replay`, base `feature/github-preview-releases`.
- [x] Added the PR base branch to quality-gates, release-pipeline and package workflow filters.
- [x] Exact PR head `1df024ab46b22c2eb28ded02dc5fdf5292442e86`: [quality gates 46100646815](https://github.com/brusvv/dots_inventory-/actions/runs/46100646815), [release pipeline 46100646810](https://github.com/brusvv/dots_inventory-/actions/runs/46100646810), [package build 46100646814](https://github.com/brusvv/dots_inventory-/actions/runs/46100646814) — all PASS.
- [ ] Source-level code review and approval for PR #11.
- [ ] Read-only all-sheet runtime probe on a restored disposable workbook.
- [ ] SC-04 partial-failure/recovery acceptance on the disposable copy, after separate explicit authorization.
- [!] N-02 runtime fault injection remains deferred.


## 2026-11-28 — SC-04 preflight hardening

- [x] Remove schema/FIFO bootstrap from `di3CorrectReceivedSupply()`; the mutating correction entrypoint now performs only a read-only v4/FIFO readiness audit before any operation registration or business write.
- [x] Fail closed if any core v4 sheet is missing, any core header differs, FIFO state version is absent/wrong, or FIFO cursor is behind the current StockLedger sequence.
- [x] Add four regression cases for prerequisite readiness and the no-bootstrap contract.
- [x] Exact source commit `7ea2989bb6f06a81ab5424594e9f869fdefa3773`: 69 Apps Script syntax files; snapshot 8/8; FIFO 46/46; order 22/22; supply/correction 153/153; catalog/order UX 14/14; system safety 39/39; Dashboard 11/11; Finance 4/4; Deployment Manager 57/57.
- [x] Exact-head GitHub Actions: [quality gates 46100854031](https://github.com/brusvv/dots_inventory-/actions/runs/46100854031), [release pipeline 46100854106](https://github.com/brusvv/dots_inventory-/actions/runs/46100854106), [package 46100854083](https://github.com/brusvv/dots_inventory-/actions/runs/46100854083) — PASS.
- [ ] Run the all-sheet preview probe on the restored disposable workbook.
- [ ] Run SC-04 write-boundary failure/recovery acceptance on the disposable copy after separate explicit approval.


## PR review update — 2026-11-28

- [x] PR #10 latest focused CI: [46100554436](https://github.com/brusvv/dots_inventory-/actions/runs/46100554436), 55/55 syntax and 71/71 deployment-manager tests PASS. Full quality-gates/package checks and runtime acceptance are still not evidenced for its current head.
- [!] PR #2 has a Git merge conflict (`mergeable_state=dirty`); resolve after its N-03 base is finalized.
- [!] PR #8 has a Git merge conflict (`mergeable_state=dirty`) and uses an older pinned bootstrap source commit; update/review before merge.
- [x] PR #11 current documentation head `352c04436798a0da69bca83e8319d60728a5780a`: quality gates [46100927016](https://github.com/brusvv/dots_inventory-/actions/runs/46100927016), release pipeline [46100927023](https://github.com/brusvv/dots_inventory-/actions/runs/46100927023), package [46100926970](https://github.com/brusvv/dots_inventory-/actions/runs/46100926970) all PASS.
- [ ] No PR has external code review/approval; all open PRs remain Draft.
