#!/usr/bin/env node
"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const crypto = require("node:crypto");
const root = path.resolve(__dirname, "..");
const context = vm.createContext({
  console, Date, JSON, Math, Number, String, Object, Array, RegExp, Error, isNaN,
  parseInt, parseFloat, Utilities: {
    DigestAlgorithm: { SHA_256: "SHA-256" },
    Charset: { UTF_8: "UTF-8" },
    computeDigest: (_algorithm, value) => Array.from(crypto.createHash("sha256").update(String(value), "utf8").digest()).map((b) => b > 127 ? b - 256 : b),
    newBlob: (value) => ({ getBytes: () => Array.from(Buffer.from(String(value), "utf8")).map((b) => b > 127 ? b - 256 : b) })
  },
  DI3_APP_CONFIG: { GITHUB_RELEASE: { REPOSITORY: "brusvv/dots_inventory-" } }
});
for (const file of ["43_DI3_GitHubDeploymentManager.gs", "44_DI3_GitHubInstallPreview.gs"]) {
  const source = fs.readFileSync(path.join(root, "src/apps_script", file), "utf8");
  vm.runInContext(source, context, { filename: file, timeout: 5000 });
}
let passed = 0;
function test(name, fn) { fn(); passed++; console.log("PASS " + name); }
function validManifest() {
  const code = "function alpha() { return 1; }\n";
  const hash = crypto.createHash("sha256").update(code).digest("hex");
  return {
    format: "dots-inventory-release/v1", git_tag: "dots-inventory-v4.0.0",
    git_commit: "a".repeat(40), target_schema_version: 4, application_time_zone: "Europe/Helsinki",
    manifest_policy: "PRESERVE_TARGET_PROJECT_MANIFEST", source_policy: "PINNED_COMMIT_RAW_FILES",
    files: [{ name: "01_Module.gs", type: "SERVER_JS", source_path: "src/apps_script/01_Module.gs",
      raw_url: "https://raw.githubusercontent.com/brusvv/dots_inventory-/" + "a".repeat(40) + "/src/apps_script/01_Module.gs",
      size_bytes: Buffer.byteLength(code), sha256: hash }]
  };
}
test("allows only GitHub-owned asset redirect hosts", () => {
  assert.equal(vm.runInContext("di3IsSafeGitHubAssetRedirect_('https://release-assets.githubusercontent.com/file')", context), true);
  assert.equal(vm.runInContext("di3IsSafeGitHubAssetRedirect_('https://objects.githubusercontent.com/file')", context), true);
  assert.equal(vm.runInContext("di3IsSafeGitHubAssetRedirect_('https://evil.example/file')", context), false);
  assert.equal(vm.runInContext("di3IsSafeGitHubAssetRedirect_('http://release-assets.githubusercontent.com/file')", context), false);
});
test("accepts valid pinned release manifest", () => {
  const m = validManifest();
  const r = vm.runInContext("di3ValidateGitHubReleaseManifest_(" + JSON.stringify(m) + ", 'dots-inventory-v4.0.0')", context);
  assert.equal(r.status, "VALID");
  assert.equal(r.file_count, 1);
});
test("rejects release tag mismatch", () => {
  const m = validManifest();
  assert.throws(() => vm.runInContext("di3ValidateGitHubReleaseManifest_(" + JSON.stringify(m) + ", 'dots-inventory-v4.0.1')", context), /git_tag манифеста/);
});
test("rejects unpinned or foreign source URL", () => {
  const m = validManifest(); m.files[0].raw_url = "https://example.com/evil.gs";
  assert.throws(() => vm.runInContext("di3ValidateGitHubReleaseManifest_(" + JSON.stringify(m) + ", 'dots-inventory-v4.0.0')", context), /URL не закреплён/);
});
test("rejects duplicate file names", () => {
  const m = validManifest(); m.files.push({ ...m.files[0] });
  assert.throws(() => vm.runInContext("di3ValidateGitHubReleaseManifest_(" + JSON.stringify(m) + ", 'dots-inventory-v4.0.0')", context), /Дублирующееся имя/);
});
test("compares API SERVER_JS names with .gs suffix normalization", () => {
  const m = validManifest();
  const files = [{ name: "01_Module", type: "SERVER_JS", source: "function alpha() { return 1; }\n" },
    { name: "appsscript", type: "JSON", source: '{"timeZone":"Europe/Helsinki"}' }];
  const r = vm.runInContext("di3BuildGitHubSourceDiff_(" + JSON.stringify(m) + ", " + JSON.stringify(files) + ")", context);
  assert.equal(r.summary.unchanged, 1);
  assert.equal(r.manifest_preserved, true);
  assert.equal(r.summary.added, 0);
});
test("reports added and changed modules without deleting local extras", () => {
  const m = validManifest();
  m.files.push({ ...m.files[0], name: "02_New.gs", source_path: "src/apps_script/02_New.gs",
    raw_url: m.files[0].raw_url.replace("01_Module.gs", "02_New.gs"), sha256: "b".repeat(64) });
  const files = [{ name: "01_Module", type: "SERVER_JS", source: "function changed() {}\n" },
    { name: "LocalHelper", type: "SERVER_JS", source: "function local() {}\n" }];
  const r = vm.runInContext("di3BuildGitHubSourceDiff_(" + JSON.stringify(m) + ", " + JSON.stringify(files) + ")", context);
  assert.equal(r.summary.changed, 1);
  assert.equal(r.summary.added, 1);
  assert.deepEqual(Array.from(r.preserved_unmanaged_server_js), ["LocalHelper.gs"]);
});
test("refuses to back up an incomplete project without appsscript.json", () => {
  const project = { script_id: "script-123", content: { files: [
    { name: "Code", type: "SERVER_JS", source: "function x() {}\\n" }
  ] } };
  assert.throws(() => vm.runInContext("di3BuildAppsScriptSourceBackupEnvelope_(" + JSON.stringify(project) + ", '', '2026-11-26T00:00:00.000Z')", context), /отсутствует appsscript.json/);
});
test("builds and verifies a source backup including appsscript.json", () => {
  const project = { script_id: "script-123", content: { files: [
    { name: "Code", type: "SERVER_JS", source: "function x() {}\n" },
    { name: "appsscript", type: "JSON", source: '{"timeZone":"Europe/Helsinki"}' }
  ] } };
  const envelope = vm.runInContext("di3BuildAppsScriptSourceBackupEnvelope_(" + JSON.stringify(project) + ", 'sheet-123', '2026-11-26T00:00:00.000Z')", context);
  const verified = vm.runInContext("di3VerifyAppsScriptSourceBackupEnvelope_(" + JSON.stringify(envelope) + ")", context);
  assert.equal(verified.status, "VERIFIED");
  assert.equal(verified.file_count, 2);
});
test("detects tampered source backup payload", () => {
  const project = { script_id: "script-123", content: { files: [
    { name: "Code", type: "SERVER_JS", source: "function x() {}\n" },
    { name: "appsscript", type: "JSON", source: '{"timeZone":"Europe/Helsinki"}' }
  ] } };
  const envelope = vm.runInContext("di3BuildAppsScriptSourceBackupEnvelope_(" + JSON.stringify(project) + ", '', '2026-11-26T00:00:00.000Z')", context);
  envelope.payload.files[0].source = "function evil() {}\n";
  assert.throws(() => vm.runInContext("di3VerifyAppsScriptSourceBackupEnvelope_(" + JSON.stringify(envelope) + ")", context), /payload.*не совпадает/);
});
test("detects file-level corruption even when payload checksum is recomputed", () => {
  const project = { script_id: "script-123", content: { files: [
    { name: "Code", type: "SERVER_JS", source: "function x() {}\n" },
    { name: "appsscript", type: "JSON", source: '{"timeZone":"Europe/Helsinki"}' }
  ] } };
  const envelope = vm.runInContext("di3BuildAppsScriptSourceBackupEnvelope_(" + JSON.stringify(project) + ", '', '2026-11-26T00:00:00.000Z')", context);
  envelope.payload.files[0].source = "function evil() {}\n";
  envelope.payload_sha256 = crypto.createHash("sha256").update(JSON.stringify(envelope.payload)).digest("hex");
  assert.throws(() => vm.runInContext("di3VerifyAppsScriptSourceBackupEnvelope_(" + JSON.stringify(envelope) + ")", context), /SHA-256\/размера файла/);
});

function installManifest(code) {
  const m = validManifest();
  m.files[0].size_bytes = Buffer.byteLength(code);
  m.files[0].sha256 = crypto.createHash("sha256").update(code).digest("hex");
  return m;
}
function installFile(name, type, source) { return { name, type, source }; }
test("builds a complete preview preserving manifest, non-server files and unmanaged modules", () => {
  const oldCode = "function oldVersion() {}\\n", newCode = "function alpha() { return 2; }\\n";
  const m = installManifest(newCode);
  m.files.push({ ...m.files[0], name: "02_New.gs", source_path: "src/apps_script/02_New.gs",
    raw_url: m.files[0].raw_url.replace("01_Module.gs", "02_New.gs") });
  const files = [installFile("01_Module", "SERVER_JS", oldCode), installFile("LocalOnly", "SERVER_JS", "function localOnly() {}\\n"),
    installFile("appsscript", "JSON", '{"timeZone":"Europe/Helsinki"}'), installFile("Index", "HTML", '<div>local</div>')];
  const downloaded = [{ name: "01_Module.gs", source: newCode }, { name: "02_New.gs", source: newCode }];
  const preview = vm.runInContext("di3BuildGitHubInstallPreview_(" + JSON.stringify(m) + ", " + JSON.stringify(files) + ", " + JSON.stringify(downloaded) + ")", context);
  assert.equal(preview.status, "PREVIEW_READY");
  assert.equal(preview.write_performed, false);
  assert.equal(preview.update_content_called, false);
  assert.equal(preview.summary.added, 1);
  assert.equal(preview.summary.changed, 1);
  assert.equal(preview.summary.preserved_unmanaged, 1);
  assert.equal(preview.summary.preserved_non_server, 2);
  assert.equal(preview.summary.removed, 0);
  assert.equal(preview.target_files.find(f => f.name === "01_Module").source, newCode);
  assert.equal(preview.target_files.find(f => f.name === "02_New").source, newCode);
  assert.equal(preview.target_files.find(f => f.name === "LocalOnly").source, "function localOnly() {}\\n");
  assert.equal(preview.target_files.find(f => f.name === "appsscript").source, '{"timeZone":"Europe/Helsinki"}');
});
test("refuses install preview without actual appsscript manifest", () => {
  const code = "function alpha() {}\\n", m = installManifest(code);
  const files = [installFile("Code", "SERVER_JS", "function x() {}\\n")], downloaded = [{ name: "01_Module.gs", source: code }];
  assert.throws(() => vm.runInContext("di3BuildGitHubInstallPreview_(" + JSON.stringify(m) + ", " + JSON.stringify(files) + ", " + JSON.stringify(downloaded) + ")", context), /ровно один фактический appsscript.json/);
});
test("rejects tampered downloaded source during install preview", () => {
  const code = "function alpha() {}\\n", m = installManifest(code);
  const files = [installFile("appsscript", "JSON", '{}')], downloaded = [{ name: "01_Module.gs", source: "function evil() {}\\n" }];
  assert.throws(() => vm.runInContext("di3BuildGitHubInstallPreview_(" + JSON.stringify(m) + ", " + JSON.stringify(files) + ", " + JSON.stringify(downloaded) + ")", context), /проверка нового исходника не пройдена/);
});
test("rejects release module name collision with a non-server file", () => {
  const code = "function alpha() {}\\n", m = installManifest(code);
  const files = [installFile("appsscript", "JSON", '{}'), installFile("01_Module", "HTML", '<p>x</p>')], downloaded = [{ name: "01_Module.gs", source: code }];
  assert.throws(() => vm.runInContext("di3BuildGitHubInstallPreview_(" + JSON.stringify(m) + ", " + JSON.stringify(files) + ", " + JSON.stringify(downloaded) + ")", context), /имя 01_Module уже занято/);
});

console.log("\n" + passed + " GitHub deployment-manager tests passed.");
