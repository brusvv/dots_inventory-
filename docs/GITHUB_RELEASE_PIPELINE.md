# Dots Inventory — GitHub release pipeline (D-01 / D-02)

## Scope

This adds the release contract and GitHub Actions packaging. It does not install code into Apps Script and does not change any spreadsheet or deployment.

The future in-project Deployment Manager will read a published manifest, fetch files from immutable commit URLs, verify SHA-256, preserve the target project's actual appsscript.json, back up current code, and require separate confirmation before updating.

## Release contract: dots-inventory-release/v1

The manifest contains product/version/tag/full commit, target schema version read from DI3_SCHEMA_VERSION, timezone read from DI3_APP_CONFIG.TIME_ZONE, minimum updater version, manifest policy PRESERVE_TARGET_PROJECT_MANIFEST, source policy PINNED_COMMIT_RAW_FILES, and sorted files with name, SERVER_JS type, source path, immutable raw URL, byte length and SHA-256.

Only .gs files directly under src/apps_script are included. Runtime probes, test tooling, docs and repository metadata are excluded from the Apps Script file set.

The manifest has a detached SHA-256 sidecar. Source checksums are in SHA256SUMS.txt. The release ZIP contains the same manifest and all source modules.

## Publishing channels

### Stable

Stable is reserved for reviewed code already merged into `main`.

```bash
git fetch origin
git switch main
git pull --ff-only
git tag -a dots-inventory-v4.0.0 -m "Dots Inventory v4.0.0"
git push origin dots-inventory-v4.0.0
```

The workflow requires an annotated `dots-inventory-vX.Y.Z` tag whose commit is reachable from `origin/main`. It publishes a normal GitHub Release.

### Preview from a feature/release branch

Preview can be published without merging the feature branch into `main`. First push the source branch, then create an annotated prerelease tag on the exact commit to test. The tag message must declare the source branch:

```bash
git fetch origin
git switch feature/my-change
git pull --ff-only
git tag -a dots-inventory-v4.1.0-preview.1 \\
  -m "Dots Inventory v4.1.0 Preview 1" \\
  -m "source-branch: feature/my-change"
git push origin dots-inventory-v4.1.0-preview.1
```

The workflow validates the Preview tag format, requires an annotated tag, verifies that the declared `feature/*`, `release/*` or `hotfix/*` branch exists on origin and contains the tagged commit, and publishes the GitHub Release with the prerelease flag. The manifest records both `release_channel: preview` and the exact declared `source_branch`; each source file remains pinned to the full commit SHA.

### Selecting a channel in Apps Script

Set `DI3_APP_CONFIG.GITHUB_RELEASE.RELEASE_CHANNEL` in `00_DI3_AppConfig.gs`:

- `"stable"` — only the latest non-prerelease release; this remains the default.
- `"preview"` — only the latest published `-preview.N` release.

The deployment manager rejects a manifest whose channel does not match the configured channel. Switching to Preview is an explicit config change; a Preview cannot silently replace Stable. Restore `"stable"` after testing.

Preview is intended for a disposable restored spreadsheet and a separate Apps Script Script ID. Do not install it into the production workbook. Code installation does not run setup, schema migration, FIFO rebuild or stock operations.

No tag or release is created by this implementation.
## Safety contract

- URLs are pinned to a full Git commit, never main or a moving branch.
- Future updater must validate manifest format, tag, file names/count, byte lengths, SHA-256, schema compatibility and updater version before any write.
- Apps Script API projects.updateContent replaces ALL project files. The updater must first call projects.getContent, preserve the actual appsscript manifest and explicitly unmanaged files, then construct the complete replacement set. Missing/unexpected files fail closed.
- The repository intentionally has no .clasp.json or appsscript.json. No Script ID or manifest is fabricated.
- Code update does not run setup, schema migration or FIFO rebuild. Code rollback is not a data rollback.
- Versioned deployments are not automatically advanced by replacing HEAD content; version creation and deployment update are separate explicit operations.

## Status

- D-01 release manifest contract: implemented.
- D-02 GitHub Actions release builder/publisher: Stable and feature-branch Preview channels implemented; first actual release awaits review, merge/release decision and a tag.
- D-03 in-project read-only release check and source comparison: implemented; live Apps Script/GitHub authorization acceptance pending.
- D-04 Apps Script source backup to Drive with read-back and SHA-256 verification: implemented; live Apps Script/Drive acceptance pending.
- D-05 confirmed install/post-write verification: implemented in source; runtime acceptance pending.
- D-06 code rollback: implemented in source; runtime acceptance pending.
- D-07 Apps Script runtime acceptance: pending.
- No live Apps Script project, Google Sheet, RC8 workbook or deployment was modified.


## D-03 / D-04 — read-only release inspection and code backup

The Apps Script menu adds **Система → GitHub и обновления**:

- **Проверить опубликованный релиз и сравнить код** calls GitHub Releases `/releases/latest`, downloads `release-manifest.json` and its detached checksum, verifies the checksum and manifest policy, then reads the current Apps Script project with `projects.getContent`. It compares each published `.gs` checksum against the current `SERVER_JS` file source. New and changed files are reported; local extra `SERVER_JS` files and all non-`SERVER_JS` files are reported as preserved. It does not fetch replacement source files or write to the project.
- **Создать резервную копию кода Apps Script** reads the complete Apps Script project content (including the required actual `appsscript.json` file; the operation stops if the API omits it), stores a JSON source snapshot in the existing Dots Inventory Drive backup folder, then reopens and verifies the payload and every per-file SHA-256 before reporting `VERIFIED`.

### Required setup and permissions

1. In the Google Cloud project associated with the Apps Script project, enable **Google Apps Script API**.
2. Ensure the actual Apps Script project manifest contains the OAuth scopes:
   - `https://www.googleapis.com/auth/script.projects.readonly` (read-only D-03/D-04)
   - `https://www.googleapis.com/auth/script.projects` (required only for the separately confirmed D-05 installer)
   - `https://www.googleapis.com/auth/script.external_request`
   - Existing Drive scope must permit creating and reading files in the configured backup folder.
3. Save the manifest in the actual Apps Script project. This repository deliberately does not contain a fabricated `appsscript.json`; do not replace the target manifest with a guessed one.
4. If the GitHub repository is private, create a fine-grained read-only token restricted to this repository with **Contents: read**, then store it in Script Properties as `DI3_GITHUB_READ_TOKEN`. Do not put the token in source code or spreadsheet cells. Script editors can read Script Properties, so only trusted editors should have project access. For a public repository no GitHub token is required.
5. Authorize the new scopes by running either menu command. If the API is unavailable or authorization is insufficient, the command fails closed and does not alter project code. GitHub's 404 response can mean either that no stable release exists yet or that a private repository has no valid token configured.

### Backup contents and limits

The source backup includes every file returned by `projects.getContent` (SERVER_JS, HTML, JSON and other supported project files), requires the actual `appsscript.json`, and stores exact file source, type, size and SHA-256. The envelope has its own SHA-256. The initial configured size ceiling is 10 MB; increase it only after checking Apps Script execution and Drive constraints. This is a code snapshot, not a backup of installable triggers, deployments, Script Properties or spreadsheet data. The existing full-spreadsheet backup remains a separate workflow.

### Safety boundaries

- D-03 is a read-only check. It never installs, deletes, renames or edits project files. GitHub asset redirects are restricted to GitHub-owned hosts; the repository token is not forwarded to the signed asset URL.
- D-04 creates a Drive file only; it never calls `projects.updateContent`.
- No schema migration, setup, FIFO rebuild, restore or stock operation is triggered.
- The actual target `appsscript.json` is included in the source snapshot and is never synthesized by this repository.
- No release installation or code rollback is implemented in this stage.


## D-05 staged phase — read-only installation preview

The first D-05 increment adds **Система → GitHub и обновления → Предварительно собрать обновление (без установки)**.

- Downloads each release .gs from its full-commit-pinned raw URL with redirects disabled.
- Rechecks source byte length and SHA-256 against the validated release manifest.
- Builds the complete Apps Script replacement set in memory, using Apps Script API file naming (SERVER_JS names without the .gs suffix for newly added files).
- Preserves the exact target appsscript.json, every non-SERVER_JS file (HTML/JSON and other types), and every unmanaged local SERVER_JS module absent from the release.
- Replaces matching release SERVER_JS files; appends missing release modules; reports additions, changes, unchanged modules and preserved local files.
- Fails closed on missing/duplicate manifest, duplicate project file identity, missing source, hash/size mismatch, file-type name collision or unexpected file set.
- Reports zero deletions and performs no Drive writes or Apps Script project writes.

**Hard boundary:** preview only. It does not call projects.updateContent, save a pending install payload, migrate schema, run setup, rebuild FIFO or alter spreadsheet data. Confirmed install and post-write verification remain unimplemented and require separate review and runtime acceptance.

Validation on PR #4: CI [45882939657](https://github.com/brusvv/dots_inventory-/actions/runs/45882939657) passed — 52/52 Apps Script syntax files, 151/151 existing regressions, 9/9 release-manifest tests and 16/16 deployment-manager tests (176/176 automated tests). This is source/Node CI, not Apps Script runtime acceptance.


## D-05 confirmed install increment

The menu adds **Система → GitHub и обновления → Установить релиз… (с подтверждением)**.

1. Rebuilds a fresh preview from the latest stable release and records a fingerprint of the complete current Apps Script project.
2. Reads the current project again and stops if its Script ID or complete file fingerprint changed since preview.
3. Creates the D-04 source backup, reads the exact Drive file back, validates its envelope and every file checksum, then requires its Script ID and complete source fingerprint to match the pre-install project.
4. Shows a separate YES/NO confirmation with release tag, commit, file counts, zero-deletion statement and the verified Drive backup link.
5. After YES, reads the project one last time and aborts if any source changed while the dialog was open.
6. Calls `projects.updateContent` with the complete prepared file set. This API replaces the project's complete content.
7. Reads the project again and compares every file's name, type and exact source. Only an exact match reports `INSTALLED_AND_VERIFIED`.

Cancel leaves the Apps Script project untouched (the verified source backup remains in Drive). A post-write verification mismatch or unavailable read-back reports the backup link and does not attempt an automatic rollback; an ambiguous update response is explicitly marked `UPDATE_RESULT_UNCERTAIN` and the user is told not to retry before checking the live project. Code rollback is a separate D-06 operation. The installer never creates or updates a versioned deployment and never runs setup, schema migration, FIFO rebuild or spreadsheet-data operations.

The actual target `appsscript.json` must already contain the write scope `https://www.googleapis.com/auth/script.projects` in addition to the read-only and external-request scopes. The repository does not fabricate or overwrite the target manifest. The live project must be tested separately before production use.


Validation for the confirmed installer increment: GitHub Actions run [45883549244](https://github.com/brusvv/dots_inventory-/actions/runs/45883549244) passed. It checked syntax for 53 Apps Script modules, all 151 existing regression cases, 9 release-manifest tests and 21 deployment-manager tests (181 automated tests total). The CI validates source and pure logic; it does not authorize or perform a live Apps Script installation.


Final D-05 installer CI after the guarded error-reporting fixes: [run 45883794490](https://github.com/brusvv/dots_inventory-/actions/runs/45883794490) passed — 53 Apps Script syntax files, 151 existing regression tests, 9 release-manifest tests and 21 deployment-manager tests (181 automated tests total). This does not replace live Apps Script runtime acceptance.


## D-06 verified code rollback

The menu adds **Система → GitHub и обновления → Откатить код из резервной копии…**.

- Prompts for the Drive file ID of a verified D-04 Apps Script source backup.
- Accepts only files with the configured source-backup filename prefix, VERIFIED description metadata, matching Script ID, matching payload checksum and membership in the Dots Inventory backup folder.
- Reopens and verifies the full backup envelope and every per-file SHA-256/byte length before preparing rollback.
- Restores the exact backed-up project files but deliberately preserves the current target `appsscript.json` so the currently authorized OAuth scopes and runtime manifest are not silently downgraded.
- Creates and verifies a second source backup of the current project before showing a separate YES/NO confirmation.
- Rechecks the current project fingerprint immediately before writing, calls `projects.updateContent` only after YES, then reads the project back and compares every file exactly.
- Reports `ROLLED_BACK_AND_VERIFIED` only after exact verification. Ambiguous write/read-back outcomes include the backup of the pre-rollback state; no automatic retry or nested rollback occurs.
- This restores Apps Script source files only. It does not restore spreadsheet data, triggers, Script Properties, versioned deployments or deployment pointers.


D-06 source/Node CI: [run 45884074434](https://github.com/brusvv/dots_inventory-/actions/runs/45884074434) passed — 54 Apps Script syntax files, 151 existing regression tests, 9 release-manifest tests and 24 deployment-manager tests (184 automated tests total). Live Drive backup selection and Apps Script write/read-back still require acceptance in a disposable test project.
