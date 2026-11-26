#!/usr/bin/env node
"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const sourcePath = path.join(__dirname, "..", "bootstrap", "DI3_GitHubBootstrap.gs");
const source = fs.readFileSync(sourcePath, "utf8");
let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  process.stdout.write("PASS " + name + "\n");
}

test("bootstrap is pinned to the reviewed immutable commit", () => {
  assert.match(source, /COMMIT:\s*"2631969aa256fbf077e9f5356f35d45a9f647a76"/);
  assert.match(source, /EXPECTED_FILE_COUNT:\s*47/);
  assert.match(source, /\/git\/trees\/.*config\.COMMIT/);
  assert.match(source, /raw\.githubusercontent\.com\/.*config\.COMMIT/);
  assert.doesNotMatch(source, /raw\.githubusercontent\.com\/.+\/main\//);
});

test("bootstrap rejects non-empty or unexpected Apps Script projects", () => {
  assert.match(source, /function di3BootstrapAssertBlankProject_/);
  assert.match(source, /file\.name === "DI3_GitHubBootstrap"/);
  assert.match(source, /file\.name === "Code" && !String\(file\.source\)\.trim\(\)/);
  assert.match(source, /unexpected\.length/);
});

test("bootstrap preserves the target manifest and its timezone/scopes", () => {
  assert.match(source, /file\.name === "appsscript"/);
  assert.match(source, /manifest\.timeZone !== DI3_GITHUB_BOOTSTRAP_CONFIG\.TIME_ZONE/);
  for (const scope of [
    "script.projects",
    "script.projects.readonly",
    "script.external_request",
    "drive",
    "spreadsheets",
    "script.container.ui",
    "script.scriptapp"
  ]) assert.ok(source.includes("https://www.googleapis.com/auth/" + scope), "missing OAuth scope " + scope);
});

test("every downloaded source is checked against Git tree size and Git blob SHA-1", () => {
  assert.match(source, /tree\.truncated === true/);
  assert.match(source, /byteLength !== Number\(entry\.size\)/);
  assert.match(source, /di3BootstrapGitBlobSha1_\(source\)/);
  assert.match(source, /"blob " \+ size \+ "\\u0000" \+ source/);
});

test("backup is written and read back before project update", () => {
  const backupAt = source.indexOf("var backup = di3BootstrapCreateVerifiedBackup_");
  const confirmAt = source.indexOf("ui.alert(\"Dots Inventory · первоначальная установка\"");
  const updateAt = source.indexOf("di3BootstrapUpdateProject_(project.script_id, targetFiles)");
  assert.ok(backupAt >= 0 && confirmAt > backupAt && updateAt > confirmAt);
  assert.match(source, /dots-inventory-appsscript-source-backup\/v1/);
  assert.match(source, /DI3_APPS_SCRIPT_SOURCE_BACKUP_V1:/);
  assert.match(source, /saved\.payload_sha256 !== di3BootstrapSha256_\(JSON\.stringify\(saved\.payload\)\)/);
});

test("write is guarded by a fresh source fingerprint and verified after write", () => {
  assert.match(source, /di3BootstrapFingerprint_\(immediatelyBeforeWrite\.content\.files\) !== sourceFingerprint/);
  assert.match(source, /var after = di3BootstrapGetProjectContent_\(\)/);
  assert.match(source, /actualFingerprint !== expectedFingerprint/);
  assert.match(source, /INSTALLED_AND_VERIFIED/);
});

test("bootstrap does not run setup, migrations or stock mutations", () => {
  assert.doesNotMatch(source, /di3RunCleanStart|di3RunMigration|di3RebuildFifo|di3CreateSupply|di3CreateOrder/);
});

process.stdout.write("\\n" + passed + " browser-bootstrap policy tests passed.\\n");
