# Dots Inventory — GitHub release pipeline (D-01 / D-02)

## Scope

This adds the release contract and GitHub Actions packaging. It does not install code into Apps Script and does not change any spreadsheet or deployment.

The future in-project Deployment Manager will read a published manifest, fetch files from immutable commit URLs, verify SHA-256, preserve the target project's actual appsscript.json, back up current code, and require separate confirmation before updating.

## Release contract: dots-inventory-release/v1

The manifest contains product/version/tag/full commit, target schema version read from DI3_SCHEMA_VERSION, timezone read from DI3_APP_CONFIG.TIME_ZONE, minimum updater version, manifest policy PRESERVE_TARGET_PROJECT_MANIFEST, source policy PINNED_COMMIT_RAW_FILES, and sorted files with name, SERVER_JS type, source path, immutable raw URL, byte length and SHA-256.

Only .gs files directly under src/apps_script are included. Runtime probes, test tooling, docs and repository metadata are excluded from the Apps Script file set.

The manifest has a detached SHA-256 sidecar. Source checksums are in SHA256SUMS.txt. The release ZIP contains the same manifest and all source modules.

## Publishing

1. Merge the clean-final-baseline work into main only after its own review and runtime acceptance.
2. Create and push an annotated tag on a commit already reachable from main:
   git tag -a dots-inventory-v4.0.0 -m "Dots Inventory v4.0.0"
   git push origin dots-inventory-v4.0.0
3. GitHub Actions validates tag format, annotated-tag status and ancestry to main, runs manifest tests, builds the package and publishes a GitHub Release.

No release tag is created by this change. Draft/feature branch commits cannot publish.

## Safety contract

- URLs are pinned to a full Git commit, never main or a moving branch.
- Future updater must validate manifest format, tag, file names/count, byte lengths, SHA-256, schema compatibility and updater version before any write.
- Apps Script API projects.updateContent replaces ALL project files. The updater must first call projects.getContent, preserve the actual appsscript manifest and explicitly unmanaged files, then construct the complete replacement set. Missing/unexpected files fail closed.
- The repository intentionally has no .clasp.json or appsscript.json. No Script ID or manifest is fabricated.
- Code update does not run setup, schema migration or FIFO rebuild. Code rollback is not a data rollback.
- Versioned deployments are not automatically advanced by replacing HEAD content; version creation and deployment update are separate explicit operations.

## Status

- D-01 release manifest contract: implemented.
- D-02 GitHub Actions release builder/publisher: implemented; first actual release awaits merge to main and a tag.
- D-03 in-project update check/diff UI: not implemented.
- D-04 Apps Script source backup: not implemented.
- D-05 confirmed install/post-write verification: not implemented.
- D-06 code rollback: not implemented.
- D-07 Apps Script runtime acceptance: pending.
- No live Apps Script project, Google Sheet, RC8 workbook or deployment was modified.
