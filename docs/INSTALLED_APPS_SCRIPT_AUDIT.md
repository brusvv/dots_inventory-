# Installed Apps Script source audit

The probe function performs read-only runtime inspection: it does not deploy code,
edit spreadsheet data, change Script Properties, or modify Drive files. However,
adding the temporary probe file to an Apps Script project is itself a source-code
write, and removing it afterwards is another write. Do not add it to the live
Dots beta 4 project without separate explicit approval for the exact target.

## 1. Export a compact runtime snapshot

1. Open the bound test Apps Script project.
2. Only after explicit approval for a temporary source edit on the exact disposable
   target, add the probe as a standalone file (do not add it to `src/apps_script`).
   Adding and later removing the file are both project-code writes.
3. Run `di3AuditExportRuntimeSourceSnapshot()` after the approved insertion.
4. Copy the JSON printed after `DI3_RUNTIME_SOURCE_AUDIT_JSON` into a local
   UTF-8 file, for example `runtime-snapshot.json`.

The snapshot contains project file names/types, Git blob SHA-1 values, byte sizes
and a full-project fingerprint, but not source code. It also reports the actual
manifest timezone/scopes, trigger handlers/event types, deployment IDs/version
metadata, Script Properties key names only (never values), and validation of the
named Bootstrap backup including Drive metadata and configured-folder membership.
Treat Script/Spreadsheet IDs, deployment IDs and property key names as private
operational metadata; do not publish the snapshot.

## 2. Compare with the checked-out GitHub branch

From the repository root run:

```sh
node tools/audit_apps_script_snapshot.js --snapshot runtime-snapshot.json
```

The checker compares every `.gs` module under `src/apps_script` with the
runtime Git blob SHA-1 and byte size. Additional runtime files are listed as
`extra_ignored`; they do not fail the comparison. Missing or changed tracked
modules fail the audit. At least one backup must be present and every reported backup must pass payload,
per-file hash, project identity, Drive description metadata and configured-folder
checks. Deployment inventory may be UNAVAILABLE if the project lacks
`script.deployments.readonly`; the probe reports the missing read-only scope
without requesting write access.

To compare against another source directory:

```sh
node tools/audit_apps_script_snapshot.js \
  --snapshot runtime-snapshot.json \
  --source-dir path/to/checkout/src/apps_script
```

## 3. CI coverage

The GitHub quality-gates workflow runs the snapshot auditor's unit tests. These
tests cover Git blob hashing, exact matches, ignored extra files, missing files,
content mismatches, backup validation, invalid input formats and the runtime
probe's OAuth redirect and metadata inventory behavior.

CI tests the audit tool itself; it cannot read the private live Apps Script
project. A runtime snapshot must still be exported from the target project to
prove installed-code identity.

## Safety

- Treat insertion/removal of the temporary probe as source writes requiring explicit approval.
- Do not run Setup, Clean Start, migrations, FIFO rebuilds or stock operations
  as part of this audit.
- Do not restore the Bootstrap backup as part of verification.
- Do not remove extra runtime files automatically.
- The Bootstrap backup contains the pre-install project state (manifest and
  bootstrap loader), not a copy of the installed 47-module source tree.
