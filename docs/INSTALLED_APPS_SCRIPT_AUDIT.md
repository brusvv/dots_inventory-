# Installed Apps Script source audit

This is a read-only runtime audit. It does not deploy code, edit spreadsheet data,
change Script Properties, or modify Drive files.

## 1. Export a compact runtime snapshot

1. Open the bound test Apps Script project.
2. Add the probe from
   `runtime/probes/DI3_APPS_SCRIPT_SOURCE_AUDIT_PROBE.gs` as a temporary
   standalone file (do not add it to `src/apps_script`).
3. Run `di3AuditExportRuntimeSourceSnapshot()`.
4. Copy the JSON printed after `DI3_RUNTIME_SOURCE_AUDIT_JSON` into a local
   UTF-8 file, for example `runtime-snapshot.json`.

The snapshot contains file names, Git blob SHA-1 values and byte sizes, but not
source code. It also contains read-only validation results for the named
Bootstrap backup. Treat Script/Spreadsheet IDs as private operational metadata;
do not publish the snapshot.

## 2. Compare with the checked-out GitHub branch

From the repository root run:

```sh
node tools/audit_apps_script_snapshot.js --snapshot runtime-snapshot.json
```

The checker compares every `.gs` module under `src/apps_script` with the
runtime Git blob SHA-1 and byte size. Additional runtime files are listed as
`extra_ignored`; they do not fail the comparison. Missing or changed tracked
modules fail the audit. At least one backup must be present and every reported
backup must pass its integrity and project-identity checks.

To compare against another source directory:

```sh
node tools/audit_apps_script_snapshot.js \
  --snapshot runtime-snapshot.json \
  --source-dir path/to/checkout/src/apps_script
```

## 3. CI coverage

The GitHub quality-gates workflow runs the snapshot auditor's unit tests. These
tests cover Git blob hashing, exact matches, ignored extra files, missing files,
content mismatches, backup validation and invalid input formats.

CI tests the audit tool itself; it cannot read the private live Apps Script
project. A runtime snapshot must still be exported from the target project to
prove installed-code identity.

## Safety

- Do not run Setup, Clean Start, migrations, FIFO rebuilds or stock operations
  as part of this audit.
- Do not restore the Bootstrap backup as part of verification.
- Do not remove extra runtime files automatically.
- The Bootstrap backup contains the pre-install project state (manifest and
  bootstrap loader), not a copy of the installed 47-module source tree.
