# Supply correction — disposable-workbook runtime acceptance

Status: **NOT RUN**. This document is an execution runbook, not evidence of runtime acceptance.

Scope: SC-01 through SC-04 on a restored, disposable Apps Script + Google Sheets copy. It does not authorize a correction in the working workbook or production.

## 1. Safety gate and test environment

1. Create a new disposable copy from a verified backup. Do not use the original workbook.
2. Confirm the spreadsheet ID is different from the working/production spreadsheet ID. Record the disposable ID in the test record only.
3. Restore the exact source branch `feature/supply-correction-fifo-replay` at the commit under test. Do not combine source files from different commits.
4. Confirm the complete Apps Script project source was copied, including modules `47–60`, schema registry, operation executor and FIFO modules. Run the source syntax/quality workflows for the exact commit.
5. Record the workbook timezone, v4 schema headers, `fifo_state_version`, `fifo_ledger_sequence_cursor`, current maximum `ledger_sequence`, and current pending-operation/FIFO-run state.
6. Verify there are no pending stock operations or unfinished FIFO runs. If there are, stop and resolve them using the existing recovery procedure before starting this test.
7. Take a fresh backup of the disposable copy and verify its read-back. Preserve the pre-test backup and do not overwrite it during the test series.

**Stop conditions:** wrong spreadsheet ID, unverified backup, schema mismatch, missing v4 prerequisites, cursor behind the ledger, pending operation, non-committed FIFO run, or any source mismatch. Do not try to repair the test workbook implicitly as part of this acceptance.

## 2. SC-01 source audit

Run the read-only audit for a received supply with a known committed `SUPPLY_RECEIVE` operation:

```javascript
di3AuditSupplyCorrectionSource(SUPPLY_ID)
```

Expected:
- `status === "READY"`;
- source receipt operation and payload hash agree;
- every receipt line maps to exactly one source item, StockLedger movement, StockMovementDetails row and StockLots row;
- active allocations plus remaining lot cache reconcile to each source lot's initial quantity;
- repeated/missing/extra/mismatched records return BLOCKED;
- workbook values, formulas and metadata remain unchanged.

Run negative cases only on disposable fixtures/copies: missing source movement, duplicate movement, mismatched product/variant/quantity, altered timestamp, missing detail/lot, and allocation/cache mismatch. Each must fail closed without repair or writes.

## 3. SC-02/SC-03 relation and FIFO acceptance

Use isolated disposable fixtures; do not edit the real receipt rows.

| Scenario | Expected result |
|---|---|
| REPLACE one source line | Original movement becomes ineffective; replacement inbound movement is effective at the original receipt time |
| REMOVE a source line | Source movement is excluded; insufficient remaining stock blocks replay |
| ADD a line | Replacement movement is included without a source movement |
| REMOVE + ADD across products | Both source and replacement products are in replay scope |
| Correction relation chain fixture | Only the final replacement remains effective; cycles/duplicate mappings fail closed |
| PREPARED relation | Visible only to the exact pending operation ID |
| COMMITTED relation + uncommitted operation | Hidden from ordinary replay; visible only to the exact recovery operation where allowed |
| Invalid movement kind/product/supply/timestamp | Replay blocks before publishing the projection |

Check that original StockLedger, StockMovementDetails, StockLots identity/source fields and original receipt payload remain unchanged. The mutable `StockLots.remaining_quantity` cache may change only through the F-06 archive/replay protocol; the old cache value must first be present in the archive.

## 4. SC-04 read-only preview probe

Run on the disposable workbook only:

```javascript
di3RunSupplyCorrectionPreviewRuntimeProbe(SUPPLY_ID, CORRECTION_SPEC)
```

The probe snapshots all workbook sheets, including hidden/auxiliary sheets, and compares values, formulas, notes, number formats, backgrounds, font colors/weights, data validations, frozen panes, visibility, sheet IDs and grid dimensions.

Interpretation:
- `status: "PASS"`, `preview.status: "READY"`, `workbook_unchanged: true`: read-only preview completed and the covered workbook state did not change.
- `PREVIEW_BLOCKED_NO_SIDE_EFFECT`: preview was rejected without a detected write. This is **not** a successful preview; investigate the reason.
- `SIDE_EFFECT_DETECTED` or `workbook_unchanged: false`: stop immediately, preserve the workbook for investigation, and do not call the mutating API.

A PASS does not prove that a correction commit/recovery works. It only accepts the read-only preview path.

### Preview assertions

Review the returned values independently:
- source fingerprint matches the SC-01 audit;
- goods, discounts, shipping and final total match the approved correction specification;
- line quantities equal `units_per_pack × packs`;
- replacement movements preserve the original `effective_at` and `recorded_at`;
- affected product scope contains every original and replacement product, including removed products;
- candidate FIFO has no unexplained negative stock and all allocations/remaining lots reconcile;
- fractional unit costs retain full precision in the candidate replay;
- no operation, relation, ledger, detail, lot, allocation, archive, cost-history, product, variant or AppMeta row was added or changed.

## 5. SC-04 failure/recovery acceptance

**This section requires a separate explicit approval before running any mutating correction, even on the disposable copy.** Use a fresh restore from the verified disposable backup for each failure point. Do not attempt multiple fault cases on a partially failed workbook unless its state has first been fully reconciled.

The operation's intended write order is:

1. immutable operation registration and payload;
2. PREPARED relation journal events (appended immediately after registration, before the executor starts);
3. replacement StockLedger, StockMovementDetails and StockLots rows;
4. supply document/item projection;
5. F-06 archive and full FIFO replay/projection;
6. ProductCostHistory append;
7. COMMITTED relation events;
8. `fifo_supply_correction_fingerprint` AppMeta update;
9. current PackVariants reconciliation;
10. supply register/form validation refresh;
11. final Operations commit by the shared executor.

For each boundary, inject an interruption immediately after that boundary has completed but before the next one starts. Use a test-only fault-injection build or a controlled disposable test harness; do not add a generally callable failpoint to production code.

After each interruption:
- confirm the operation remains PREPARED/RETRYABLE, not falsely COMMITTED;
- run the normal pending-operation recovery path;
- confirm recovery resumes the same operation and does not create duplicate movement, detail, lot, relation, cost-history or archive records;
- confirm source receipt payload/hash and immutable source rows are unchanged;
- confirm effective relation fingerprint, FIFO run, F-06 archive, allocation projection, lot cache and cost-history rows agree;
- confirm the Operations row becomes COMMITTED only after all target projections are verified;
- rerun source audit/read-only preview and relevant FIFO/order read models.

Also test interruption during each multi-row append/batch stage, not only between high-level stages. If the runtime cannot safely reproduce a partial batch write, record that case as NOT TESTED rather than assuming it is covered.

## 6. Financial and stock acceptance cases

At minimum, cover:
- correction before any sale;
- correction after full consumption of an original lot;
- partial consumption across multiple lots;
- REMOVE of a product that has other received lots and historical sales;
- replacement with a different pack variant, including a 40-unit pack;
- discount/shipping allocation and fractional per-unit cost;
- return linked to an affected dispatch;
- closed financial period/PeriodGuard;
- duplicate request with identical correction ID and identical payload;
- same correction ID with changed payload (must reject);
- concurrent correction attempt (must serialize/block);
- missing/duplicate relation, source movement, replacement movement, detail or lot (must fail closed).

Verify affected orders at order level: all lines in each affected order must retain consistent COGS/profit totals after replay, not only the line directly consuming the corrected lot.

## 7. Supply #17 acceptance data (do not execute yet)

The intended correction values to use for the preview, once the exact supply ID and catalog product/pack-variant IDs have been independently confirmed:

- Icarus Lab Pure: 3 packs × 20 units, 229 ₽ per pack; goods total 687 ₽.
- X-Raypad Obsidian Air 6.5: 12 packs × 40 units, 184.50 ₽ per pack; goods total 2,214 ₽.
- Goods total: 2,901 ₽.
- Seller discount: 0 ₽.
- Partner discount: 1,000 ₽.
- Shipping: 454 ₽.
- Final total: 2,355 ₽.
- Total received quantity: 540 units.

Expected proportional cost allocation:
- Icarus Lab Pure: discount 236.81 ₽, shipping 107.51 ₽, final line cost 557.70 ₽, unit cost 9.295 ₽.
- X-Raypad Obsidian Air 6.5: discount 763.19 ₽, shipping 346.49 ₽, final line cost 1,797.30 ₽, unit cost 3.744375 ₽.

Do not round unit cost to two decimals before FIFO storage/replay. Confirm the actual catalog `product_id` and `pack_variant_id` for both lines; do not create catalog records implicitly during correction.

The supply ID, product IDs and pack-variant IDs must be looked up from the disposable workbook. The values above do not authorize calling `di3CorrectReceivedSupply()`.

## 8. Evidence record and release gate

For every test, record:
- exact source commit and CI run URLs;
- disposable workbook identifier (private test record);
- backup identifier/hash and read-back result;
- test case, inputs and expected outcome;
- returned status, fingerprints and relevant operation/FIFO run IDs;
- before/after source immutability checks;
- recovery result and duplicate-count checks;
- PASS / FAIL / NOT TESTED with a short explanation.

SC-04 is accepted only when the read-only probe passes, all required failure/recovery cases pass, all financial/stock/order assertions pass, and the exact source head has green quality-gates, release-pipeline and package workflows.

**No live supply correction, PR merge, deployment or release is authorized by this runbook.** Supply #17 remains unchanged until runtime acceptance is complete and the user separately approves the exact mutating request.
