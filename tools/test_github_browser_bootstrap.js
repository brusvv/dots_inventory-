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
  assert.match(source, /COMMIT:\s*"39ae1b1af9753a31ab3c92175d5fe6d33ef92f16"/);
  assert.match(source, /EXPECTED_FILE_COUNT:\s*47/);
  assert.match(source, /TIME_ZONE:\s*"Europe\/Moscow"/);
  assert.match(source, /\/git\/commits\/.*config\.COMMIT/);
  assert.match(source, /\/git\/trees\/.*commit\.tree\.sha/);
  assert.match(source, /tree\.sha !== commit\.tree\.sha/);
  assert.match(source, /raw\.githubusercontent\.com\/.*config\.COMMIT/);
  assert.doesNotMatch(source, /raw\.githubusercontent\.com\/.+\/main\//);
});

test("GitHub API uses an operator-supplied token without persisting or leaking it", () => {
  assert.match(source, /function di3BootstrapPromptGitHubToken_/);
  assert.match(source, /ui\.prompt\(/);
  assert.match(source, /github_pat_/);
  assert.match(source, /Contents: Read-only/);
  assert.match(source, /Bearer /);
  assert.match(source, /api\\\.github\\\.com/);
  assert.match(source, /replace\(token, "\\[REDACTED\\]"\)/);
  assert.match(source, /function di3BootstrapDownloadPinnedSources_\(githubToken\)/);
  assert.match(source, /rawUrl, "text\/plain"\);/);
  assert.doesNotMatch(source, /PropertiesService|ScriptProperties|UserProperties|DocumentProperties/);
});

test("GitHub fetch safely follows same-host redirects and exposes real HTTP diagnostics", () => {
  assert.match(source, /"User-Agent": "DotsInventoryBrowserBootstrap\/1\.0"/);
  assert.match(source, /followRedirects: false/);
  assert.match(source, /\[301, 302, 303, 307, 308\]/);
  assert.match(source, /maxRedirects = 5/);
  assert.match(source, /getAllHeaders/);
  assert.match(source, /x-ratelimit-remaining/);
  assert.match(source, /Ответ GitHub:/);
  assert.match(source, /недоверенный адрес/);
  assert.doesNotMatch(source, /Перенаправления не принимаются/);
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
  assert.match(source, /BACKUP_PREFIX:\s*"DotsInventory_AppsScript_Source_"/);
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

process.stdout.write("\n" + passed + " browser-bootstrap policy tests passed.\n");
