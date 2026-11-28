# Dots Inventory — GitHub release pipeline (D-01 / D-02)

## Scope

This section documents the D-01/D-02 release contract and GitHub Actions packaging. It does not itself install code or change a spreadsheet/deployment; installation is handled by the separate D-03–D-06 Deployment Manager described below.

The in-project Deployment Manager reads a published manifest, fetches files from immutable commit URLs, verifies SHA-256, preserves the target project's actual appsscript.json, backs up current code, and requires separate confirmation before updating.

## Release contract: dots-inventory-release/v1

The manifest contains product/version/tag/full commit, target schema version read from DI3_SCHEMA_VERSION, timezone read from DI3_APP_CONFIG.TIME_ZONE, minimum updater version, manifest policy PRESERVE_TARGET_PROJECT_MANIFEST, source policy PINNED_COMMIT_RAW_FILES, and sorted files with name, SERVER_JS type, source path, immutable raw URL, byte length and SHA-256.

Only .gs files directly under src/apps_script are included. Runtime probes, test tooling, docs and repository metadata are excluded from the Apps Script file set.

The manifest has a detached SHA-256 sidecar. Source checksums are in SHA256SUMS.txt. The release ZIP contains the same manifest and all source modules.

## Release tag policy implementation

The tag gate is implemented in `tools/validate_release_tag.sh` and is shared by the tag-push workflow. CI runs `tools/test_release_tag_policy.sh` against temporary local Git repositories. The tests cover Stable from main, Preview from its declared feature branch, missing source branch, a commit outside the declared branch, lightweight tags, Stable commits outside main, and unsupported prerelease suffixes. The test harness writes only inside its temporary directory.

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

### Mandatory compatibility gates before installation

Before downloading release source files or creating a Drive backup, the updater checks that:
- the release `minimum_updater_version` is valid strict MAJOR.MINOR.PATCH and does not exceed the running updater version (`0.2.0`);
- the workbook's `_AppMeta.schema_version`, the currently installed code's `DI3_SCHEMA_VERSION`, and the release `target_schema_version` are identical;
- `DI3_APP_CONFIG.TIME_ZONE`, the actual target `appsscript.json` `timeZone`, `Session.getScriptTimeZone()`, the spreadsheet timezone, and the release `application_time_zone` are identical.

The schema/timezone check is read-only and is repeated immediately before `projects.updateContent`. Any missing value or mismatch blocks installation. The updater never migrates schema or changes timezone settings. Align timezone settings deliberately before installing; do not rewrite existing dates or timestamps as part of this operation.

**One-time updater bootstrap:** versions older than `0.2.0` do not know how to enforce `minimum_updater_version`. Before relying on this gate, manually update the updater modules (`00_DI3_AppConfig.gs`, `43_DI3_GitHubDeploymentManager.gs`, `44_DI3_GitHubInstallPreview.gs`, `45_DI3_GitHubConfirmedInstaller.gs`) in a disposable Apps Script project while preserving its actual `appsscript.json`. Then verify the actual manifest and spreadsheet timezone are already `Europe/Moscow`. Do not use an older updater to bootstrap this release into a production project.

No tag or release is created by this implementation.
## Safety contract

- URLs are pinned to a full Git commit, never main or a moving branch.
- The updater validates manifest format, tag, file names/count, byte lengths, SHA-256, minimum updater version, schema compatibility and timezone compatibility before any write.
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
- D-05 confirmed installation and D-06 code rollback are implemented in source; live Apps Script runtime acceptance remains pending.


## D-05 staged phase — read-only installation preview

The first D-05 increment adds **Система → GitHub и обновления → Предварительно собрать обновление (без установки)**.

- Downloads each release .gs from its full-commit-pinned raw URL with redirects disabled.
- Rechecks source byte length and SHA-256 against the validated release manifest.
- Builds the complete Apps Script replacement set in memory, using Apps Script API file naming (SERVER_JS names without the .gs suffix for newly added files).
- Preserves the exact target appsscript.json, every non-SERVER_JS file (HTML/JSON and other types), and every unmanaged local SERVER_JS module absent from the release.
- Replaces matching release SERVER_JS files; appends missing release modules; reports additions, changes, unchanged modules and preserved local files.
- Fails closed on missing/duplicate manifest, duplicate project file identity, missing source, hash/size mismatch, file-type name collision or unexpected file set.
- Reports zero deletions and performs no Drive writes or Apps Script project writes.

**Hard boundary:** preview only. It does not call projects.updateContent, save a pending install payload, migrate schema, run setup, rebuild FIFO or alter spreadsheet data. The read-only preview is followed by the separately implemented confirmed installer described below; live Apps Script runtime acceptance is still required.

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

## Direct branch selection (operator-selected source)

The Apps Script menu now supports selecting a supported source branch directly, without creating an annotated Preview tag or publishing a GitHub Release.

1. **Выбрать ветку GitHub для обновления…** lists supported `feature/*`, `release/*` and `hotfix/*` branches and asks for the exact branch name.
2. The updater resolves that branch to its current full commit SHA, reads the Git tree and fetches only direct `.gs` modules under `src/apps_script/`.
3. It derives the target schema from `DI3_SCHEMA_VERSION` and timezone from `DI3_APP_CONFIG.TIME_ZONE`, computes each file's SHA-256/byte length, and builds an in-memory branch snapshot manifest.
4. Every source URL is pinned to the resolved 40-character commit SHA. The branch name is never used as a moving source URL during preview or installation. The selected commit SHA is persisted with the branch name, so moving the branch later does not silently change the pending source. Each fetched source is also checked against the Git tree's Git blob SHA-1, in addition to the generated SHA-256 and byte length.
5. The normal compatibility gate, read-only diff, verified Drive source backup, explicit YES/NO install confirmation, concurrency check and post-write verification remain mandatory.
6. **Сбросить выбор ветки (Stable / Preview)** clears the selected branch. The configured Stable or Preview release channel is then used again.

Branch snapshots are labeled **BRANCH**, not Stable or published Preview. They are not GitHub Releases and do not imply that CI has passed. Branch selection is stored in Script Properties for the current Apps Script project. The selector rejects branch names outside the supported prefixes, incomplete Git trees, missing schema/timezone metadata, malformed commits and updater downgrades. A branch with an older updater module is blocked rather than silently downgrading the update manager.

This feature changes source selection only. It does not run setup, schema migration, FIFO rebuild, stock operations, deployment creation or deployment-pointer updates. Use it only on a restored disposable workbook and a separate Apps Script Script ID until D-07 runtime acceptance is complete.

Branch selection also performs a Git-tree preflight before downloading any source: only regular blob files (modes `100644` / `100755`) are accepted; duplicate/case-colliding names, malformed blob SHA/size metadata, more than 200 root `.gs` files, or a combined source size above 10 MB are rejected. A stored branch selection without its full 40-character commit SHA fails closed and must be reset/reselected. Schema/timezone metadata is read only from the canonical `DI3_APP_CONFIG` and `DI3_SCHEMA_VERSION` declarations, not loose text matches.
