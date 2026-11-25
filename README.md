# Dots Inventory v3 — RC8

This repository is initialized for the Dots Inventory v3 RC8 source snapshot dated 2026-11-24.

> **Import status:** the source archive has not yet been imported into this repository. The only committed file currently present is this README.

## Import the supplied archive

1. Download `DI3_RC8_Repository_2026-11-24(1).zip` from the ChatGPT conversation.
2. Extract it. The archive contains a top-level folder named `DI3_RC8_Repository`.
3. Clone this repository and copy the *contents* of that folder into the clone root (not the folder itself).
4. Review the staged files, then commit and push:

```powershell
git clone https://github.com/brusvv/dots_inventory-.git
cd dots_inventory-

# Replace this path with the folder where you extracted the archive.
Copy-Item "C:\PATH\TO\DI3_RC8_Repository\*" . -Recurse -Force

git status --short
git add .
git commit -m "Import Dots Inventory v3 RC8 source snapshot (2026-11-24)"
git push origin main
```

The archive's `.gitignore` excludes `.clasp.json`. Do not add local Apps Script bindings, script IDs, credentials, or secrets.

## Source snapshot notes

The archive preserves 39 Apps Script modules in `src/apps_script/`, seven runtime probes in `runtime/probes/`, project documentation, source inventory, checksums, and static-validation evidence. It deliberately does not include `appsscript.json`, `.clasp.json`, a complete Node regression harness, or original repository history.

See `PROJECT_CONTEXT_FOR_NEW_CHAT.md` in the imported archive for architecture, known runtime status, roadmap, and operating safeguards.

The repository is currently **public**.