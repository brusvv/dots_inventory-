# Clean baseline schema and versioning strategy

Date: 2026-11-26  
Status: clean-baseline source path implemented on `feature/clean-final-baseline`; targeted regression cases added. CI and Google Sheets runtime acceptance are pending.

## Why this is required

The current setup flow is designed to adopt an existing RC8 baseline and then apply ordered additive migrations:

- `DI3_SCHEMA_VERSION = 3`;
- baseline adoption advances schema version 0 to 1;
- migration definitions advance 1 → 2 and 2 → 3;
- `di3EnsureSchemaVersioning_` expects exactly those migration records when version 3 is current.

At the same time, `DI3_TABLE_SCHEMAS` already describes the current final v3 column layouts. On an empty workbook, setup creates those final headers first and then the versioning routine records the historical migration chain. That approach is workable for RC8, but it becomes increasingly misleading when the next clean release includes new FIFO and historical-sale structures.

Simply changing `DI3_SCHEMA_VERSION` to 5 is unsafe: the current versioning report and migration runner assume a v1 baseline and a complete sequential chain. A blank final workbook should not pretend that it was migrated through every historical intermediate schema.

## Recommended model: two explicit installation paths

### A. Clean final baseline adoption

Used only when the workbook is genuinely empty of business data and has no prior schema identity.

1. Installation preflight classifies the workbook as `CLEAN_EMPTY` only when every known system table and user workspace is either absent or empty/uninitialized, and there are no business rows, pending operations, unknown populated tabs, or conflicting headers.
2. Setup creates all final system tables directly from the final `DI3_TABLE_SCHEMAS`.
3. Preflight validates every header exactly, including new StockLedger sequence and FIFO archive fields.
4. Schema versioning writes one idempotent migration record, e.g. `CLEAN_FINAL_BASELINE_ADOPTION`, with from=0 and to=current target version.
5. It sets `schema_version` to the target only after all final headers and required metadata are verified.
6. It marks the baseline record COMPLETED last.
7. FIFO state starts at sequence watermark 0 and state version 4; there is no legacy cursor to reinterpret.
8. A second setup run makes no schema changes and reports CURRENT/READY.

If execution is interrupted:
- STARTED with schema version 0: revalidate final headers and resume.
- STARTED with schema version equal to target: verify all headers/metadata, then complete the journal row.
- Any other version/record mismatch: block and require diagnosis; never guess.

### B. Explicit legacy upgrade

Used only when a workbook contains a recognized earlier application schema or business data.

- Keep the existing sequential migration definitions for the versions they actually represent.
- Add separately reviewed migration steps for F-02, F-06 and F-07 only if continued support for RC8 workbooks is required.
- Require verified backup, no pending stock operations, schema/header validation, FIFO integrity diagnostics and a documented rollback/recovery path.
- Never apply the clean-baseline shortcut to a workbook with existing business data.

The user has stated that a clean new workbook is acceptable, so the clean path is the preferred production route. Legacy upgrade can remain a maintenance/compatibility path and must not delay the new baseline unless the user asks to preserve RC8 compatibility.

## Final baseline content still to be frozen

The final schema must be designed as one coherent release and include:

- StockLedger.ledger_sequence (F-07).
- FifoProductState.last_processed_ledger_sequence (F-07).
- FifoAllocationArchive, FifoLotCacheArchive and FifoReplayEvents, with replay identity, source allocation identity, provenance and PREPARED/COMMITTED/QUARANTINED events (F-06 schema is now defined in `00_DI3_SchemaRegistry.gs`).
- V3_Orders.business_date and any required historical-sale fields (F-02; exact field semantics depend on the unresolved date/time decision).
- Existing commission_payer and money-minor-unit fields.
- All metadata keys and version gates for FIFO, money calculations, application version and configured timezone.

Do not freeze the final schema version number until F-02 field semantics and F-06 archive table contract are settled. The release should have one target schema version, not an accidental chain of intermediate migrations for a workbook that never contained those intermediate states.

## Setup and backup/restore requirements

- `DI3_CORE_TABLE_NAMES` is derived from `DI3_TABLE_SCHEMAS`, so adding a table to the schema registry should automatically include it in core schema setup and system-sheet layout. This must still be confirmed in setup and backup/restore tests.
- Installation preflight must distinguish an empty new workbook from a damaged/partially installed workbook. A workbook with unexpected content must be BLOCKED, not auto-classified as clean.
- Backup must include every new system table, including empty tables and schema headers.
- Restore-as-new must restore the same schema version, sequence metadata, archive history and FIFO state; it must not allocate new ledger sequences during restore.
- Setup must be idempotent: run twice on a blank workbook and twice on a partially completed clean-baseline adoption.
- Do not allow normal stock mutations until schema baseline, FIFO sequence version and money-minor-unit state all report READY.

## Acceptance scenarios

1. Truly blank spreadsheet: dry-run is READY and reports clean-baseline adoption.
2. Unknown populated tab: preflight blocks without changing timezone, sheets, triggers or properties.
3. Empty setup: creates all final schemas and records clean baseline once.
4. Re-run setup: no duplicate baseline record, no schema mutation, READY.
5. Inject interruption after table creation but before version record: rerun safely completes.
6. Inject interruption after schema_version write but before baseline journal completion: rerun verifies and completes.
7. Existing RC8 workbook with business rows: clean path is not selected; legacy path is explicit and backup-gated.
8. Backup/restore-as-new round-trip preserves all new tables, metadata and schema identity.
9. New workbook accepts supply receipt, dispatch, return and finance flows without any migration.

## Additional source findings and partial implementation

- `di3DryRunInstallation()` now inventories every workbook tab. Known system tables, current/legacy managed workspaces and the default blank tab names are allowlisted. Any other tab containing cells or charts is reported as a blocking issue; the preflight does not rename, clear or delete it. This is source-implemented and covered by the System Safety UX Node suite, but still needs a real Google Sheets Dry Run check.
- Backup hashing priority now explicitly includes `FifoAllocationArchive`, `FifoLotCacheArchive` and `FifoReplayEvents`; a regression test protects that priority. Backup snapshots still enumerate all spreadsheet tabs.
- The setup flow in `04_DI3_Setup.gs` still runs schema versioning after `di3EnsureCoreFoundationSchemas_(true)` has created/initialized the current schema. `33_DI3_SchemaVersioning.gs` now distinguishes a clean final baseline from the RC8 upgrade path. A clean workbook receives one `CLEAN_FINAL_BASELINE_ADOPTION` record (0 → current target version) after exact final-header validation; the legacy RC8 baseline and ordered v1→v2→v3 chain remain separate. The clean path is recognized on subsequent setup runs even after ordinary business rows have been created, and interrupted STARTED records can resume after revalidation.
- Current source CI validates 50 Apps Script files and 118/118 Node tests. This is not Google Sheets runtime acceptance.


## Implementation note — clean baseline branch

- Branch: `feature/clean-final-baseline`.
- The clean path currently adopts target schema **v3**, because F-02 historical-sale fields have not yet been implemented or frozen. If F-02 is included before the first production install, update the target schema and include its fields in the clean baseline directly; do not simulate v4 history in a never-migrated workbook.
- Eligibility is fail-closed: the workbook must be unversioned, have no legacy migration records, contain no business rows before the first baseline record, and have only absent/blank/exact-current system headers. Once the clean baseline record exists, it remains the identity anchor for later setup reruns. An unversioned populated workbook without a recognized legacy migration identity is BLOCKED rather than silently adopted as either clean or legacy.
- The legacy path is preserved for recognized earlier workbooks; the clean path does not adopt RC8 data or execute RC8 migrations.
- Added six targeted System Safety UX tests for empty workbook eligibility, rejection of unversioned business rows, rejection of legacy/mismatched headers, and recognition after normal business rows exist.
- These are source changes only at this stage. CI execution, test-runner execution, and real Apps Script Dry Run/setup/interruption acceptance have not yet been verified.
