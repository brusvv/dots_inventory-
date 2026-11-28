#!/usr/bin/env node
"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const crypto = require("node:crypto");
const root = path.resolve(__dirname, "..");
const runtimeState = {
  workbook_schema_version: 4,
  config_time_zone: "Europe/Moscow",
  script_time_zone: "Europe/Moscow",
  spreadsheet_time_zone: "Europe/Moscow"
};
const context = vm.createContext({
  console, Date, JSON, Math, Number, String, Object, Array, RegExp, Error, isNaN,
  parseInt, parseFloat, Utilities: {
    DigestAlgorithm: { SHA_256: "SHA-256", SHA_1: "SHA-1" },
    Charset: { UTF_8: "UTF-8" },
    computeDigest: (algorithm, value) => Array.from(crypto.createHash(algorithm === "SHA-1" ? "sha1" : "sha256").update(String(value), "utf8").digest()).map((b) => b > 127 ? b - 256 : b),
    newBlob: (value) => ({ getBytes: () => Array.from(Buffer.from(String(value), "utf8")).map((b) => b > 127 ? b - 256 : b) })
  },
  DI3_APP_CONFIG: { TIME_ZONE: "Europe/Moscow", GITHUB_RELEASE: { REPOSITORY: "brusvv/dots_inventory-" } },
  DI3_SCHEMA_VERSION: 4,
  di3GetSchemaVersion_: () => runtimeState.workbook_schema_version,
  di3GetConfiguredTimeZone_: () => runtimeState.config_time_zone,
  di3GetScriptTimeZone_: () => runtimeState.script_time_zone,
  di3GetSpreadsheet_: () => ({ getSpreadsheetTimeZone: () => runtimeState.spreadsheet_time_zone })
});
for (const file of ["43_DI3_GitHubDeploymentManager.gs", "44_DI3_GitHubInstallPreview.gs", "45_DI3_GitHubConfirmedInstaller.gs", "46_DI3_GitHubCodeRollback.gs"]) {
  const source = fs.readFileSync(path.join(root, "src/apps_script", file), "utf8");
  vm.runInContext(source, context, { filename: file, timeout: 5000 });
}
let passed = 0;
function test(name, fn) { fn(); passed++; console.log("PASS " + name); }
function validManifest() {
  const code = "function alpha() { return 1; }\n";
  const hash = crypto.createHash("sha256").update(code).digest("hex");
  return {
    format: "dots-inventory-release/v1", git_tag: "dots-inventory-v4.0.0", release_channel: "stable", source_branch: "main",
    git_commit: "a".repeat(40), target_schema_version: 4, application_time_zone: "Europe/Moscow", minimum_updater_version: "0.2.0",
    manifest_policy: "PRESERVE_TARGET_PROJECT_MANIFEST", source_policy: "PINNED_COMMIT_RAW_FILES",
    files: [{ name: "01_Module.gs", type: "SERVER_JS", source_path: "src/apps_script/01_Module.gs",
      raw_url: "https://raw.githubusercontent.com/brusvv/dots_inventory-/" + "a".repeat(40) + "/src/apps_script/01_Module.gs",
      size_bytes: Buffer.byteLength(code), sha256: hash }]
  };
}
test("compares strict updater semantic versions", () => {
  assert.equal(vm.runInContext("di3CompareUpdaterVersions_('0.2.0', '0.1.9')", context), 1);
  assert.equal(vm.runInContext("di3CompareUpdaterVersions_('1.0.0', '1.0.0')", context), 0);
  assert.equal(vm.runInContext("di3CompareUpdaterVersions_('0.1.9', '0.2.0')", context), -1);
  assert.throws(() => vm.runInContext("di3CompareUpdaterVersions_('0.2', '0.1.0')", context), /Некорректная версия updater/);
});
test("rejects noncanonical Stable tag suffixes", () => {
  const m = validManifest(); m.git_tag = "dots-inventory-v4.0.0-beta.1";
  assert.throws(() => vm.runInContext("di3ValidateGitHubReleaseManifest_(" + JSON.stringify(m) + ", " + JSON.stringify(m.git_tag) + ")", context), /стабильный тег|Некорректный GitHub release tag/);
});
test("rejects Preview from unsupported source branches and noncanonical tags", () => {
  const oldChannel = context.DI3_APP_CONFIG.GITHUB_RELEASE.RELEASE_CHANNEL;
  context.DI3_APP_CONFIG.GITHUB_RELEASE.RELEASE_CHANNEL = "preview";
  try {
    const m = validManifest(); m.release_channel = "preview"; m.source_branch = "bugfix/new-feature";
    m.git_tag = "dots-inventory-v4.1.0-preview.1";
    assert.throws(() => vm.runInContext("di3ValidateGitHubReleaseManifest_(" + JSON.stringify(m) + ", " + JSON.stringify(m.git_tag) + ")", context), /Preview должен иметь тег/);
    m.source_branch = "feature/new-feature"; m.git_tag = "dots-inventory-v4.1.0-beta.1";
    assert.throws(() => vm.runInContext("di3ValidateGitHubReleaseManifest_(" + JSON.stringify(m) + ", " + JSON.stringify(m.git_tag) + ")", context), /Некорректный GitHub release tag|Preview должен/);
  } finally {
    context.DI3_APP_CONFIG.GITHUB_RELEASE.RELEASE_CHANNEL = oldChannel;
  }
});
test("rejects a release requiring a newer updater", () => {
  const m = validManifest(); m.minimum_updater_version = "0.2.1";
  assert.throws(() => vm.runInContext("di3ValidateGitHubReleaseManifest_(" + JSON.stringify(m) + ", 'dots-inventory-v4.0.0')", context), /минимальную версию updater/);
});
test("rejects missing minimum updater version", () => {
  const m = validManifest(); delete m.minimum_updater_version;
  assert.throws(() => vm.runInContext("di3ValidateGitHubReleaseManifest_(" + JSON.stringify(m) + ", 'dots-inventory-v4.0.0')", context), /minimum_updater_version/);
});
test("schema and all four timezone sources must match the release before install", () => {
  const manifest = { target_schema_version: 4, application_time_zone: "Europe/Moscow" };
  const baseline = { workbook_schema_version: 4, code_schema_version: 4, config_time_zone: "Europe/Moscow", manifest_time_zone: "Europe/Moscow", script_time_zone: "Europe/Moscow", spreadsheet_time_zone: "Europe/Moscow" };
  const ready = vm.runInContext("di3BuildGitHubInstallCompatibilityReport_(" + JSON.stringify(manifest) + ", " + JSON.stringify(baseline) + ")", context);
  assert.equal(ready.status, "READY");
  for (const [key, value] of [["workbook_schema_version", 3], ["code_schema_version", 3], ["config_time_zone", "Europe/Helsinki"], ["manifest_time_zone", "Europe/Helsinki"], ["script_time_zone", "Europe/Helsinki"], ["spreadsheet_time_zone", "Europe/Helsinki"]]) {
    const report = vm.runInContext("di3BuildGitHubInstallCompatibilityReport_(" + JSON.stringify(manifest) + ", " + JSON.stringify({ ...baseline, [key]: value }) + ")", context);
    assert.equal(report.status, "BLOCKED", key + " must block install"); assert.ok(report.issues.length > 0);
  }
});
test("reads the actual Apps Script manifest and runtime timezone sources", () => {
  const manifest = { target_schema_version: 4, application_time_zone: "Europe/Moscow" };
  const projectFiles = [{ name: "appsscript", type: "JSON", source: JSON.stringify({ timeZone: "Europe/Moscow" }) }];
  const ready = vm.runInContext("di3GetGitHubInstallCompatibilityReport_(" + JSON.stringify(manifest) + ", " + JSON.stringify(projectFiles) + ")", context);
  assert.equal(ready.status, "READY");
  assert.deepEqual(JSON.parse(JSON.stringify(ready.time_zones)), {
    app_config: "Europe/Moscow", appsscript_manifest: "Europe/Moscow",
    script_runtime: "Europe/Moscow", spreadsheet: "Europe/Moscow"
  });
});
test("actual integration blocks missing manifest and runtime timezone drift", () => {
  const manifest = { target_schema_version: 4, application_time_zone: "Europe/Moscow" };
  const projectFiles = [{ name: "appsscript", type: "JSON", source: JSON.stringify({ timeZone: "Europe/Moscow" }) }];
  const oldScriptZone = runtimeState.script_time_zone;
  try {
    runtimeState.script_time_zone = "Europe/Helsinki";
    const mismatch = vm.runInContext("di3GetGitHubInstallCompatibilityReport_(" + JSON.stringify(manifest) + ", " + JSON.stringify(projectFiles) + ")", context);
    assert.equal(mismatch.status, "BLOCKED");
    assert.ok(mismatch.issues.some((issue) => issue.includes("Session.getScriptTimeZone()")));
    runtimeState.script_time_zone = oldScriptZone;
    const missing = vm.runInContext("di3GetGitHubInstallCompatibilityReport_(" + JSON.stringify(manifest) + ", [])", context);
    assert.equal(missing.status, "BLOCKED");
    assert.ok(missing.issues.some((issue) => issue.includes("appsscript.json")));
  } finally {
    runtimeState.script_time_zone = oldScriptZone;
  }
});
test("unknown workbook schema or timezone is fail-closed", () => {
  const manifest = { target_schema_version: 4, application_time_zone: "Europe/Moscow" };
  const data = { workbook_schema_version: null, code_schema_version: 4, config_time_zone: "Europe/Moscow", manifest_time_zone: "", script_time_zone: "Europe/Moscow", spreadsheet_time_zone: "Europe/Moscow" };
  const report = vm.runInContext("di3BuildGitHubInstallCompatibilityReport_(" + JSON.stringify(manifest) + ", " + JSON.stringify(data) + ")", context);
  assert.equal(report.status, "BLOCKED"); assert.ok(report.issues.length >= 2);
});
test("allows only GitHub-owned asset redirect hosts", () => {
  assert.equal(vm.runInContext("di3IsSafeGitHubAssetRedirect_('https://release-assets.githubusercontent.com/file')", context), true);
  assert.equal(vm.runInContext("di3IsSafeGitHubAssetRedirect_('https://objects.githubusercontent.com/file')", context), true);
  assert.equal(vm.runInContext("di3IsSafeGitHubAssetRedirect_('https://evil.example/file')", context), false);
  assert.equal(vm.runInContext("di3IsSafeGitHubAssetRedirect_('http://release-assets.githubusercontent.com/file')", context), false);
});

test("validates every signed asset redirect hop and never follows redirects automatically", () => {
  const calls = [];
  const responses = [
    { code: 302, headers: { Location: "https://release-assets.githubusercontent.com/signed" } },
    { code: 302, headers: { Location: "https://evil.example/steal" } }
  ];
  context.UrlFetchApp = { fetch: (url, options) => {
    calls.push({ url, options });
    const next = responses.shift();
    return { getResponseCode: () => next.code, getContentText: () => "",
      getAllHeaders: () => next.headers };
  } };
  const asset = { id: 123, url: "https://api.github.com/repos/brusvv/dots_inventory-/releases/assets/123" };
  try {
    assert.throws(() => vm.runInContext("di3FetchGitHubAsset_(" + JSON.stringify(asset) + ", 'test.zip')", context),
      /недоверенный адрес/);
    assert.equal(calls.length, 2);
    assert.ok(calls.every(call => call.options.followRedirects === false));
    assert.equal(calls[1].url, "https://release-assets.githubusercontent.com/signed");
  } finally {
    delete context.UrlFetchApp;
  }
});

test("GitHub API requests do not automatically follow redirects", () => {
  let observed;
  context.UrlFetchApp = { fetch: (_url, options) => {
    observed = options;
    return { getResponseCode: () => 302, getContentText: () => "", getAllHeaders: () => ({ Location: "https://evil.example/" }) };
  } };
  try {
    const response = vm.runInContext("di3FetchGitHubResponse_('https://api.github.com/repos/brusvv/dots_inventory-', null, true)", context);
    assert.equal(response.code, 302);
    assert.equal(observed.followRedirects, false);
  } finally {
    delete context.UrlFetchApp;
  }
});
test("accepts valid pinned release manifest", () => {
  const m = validManifest();
  const r = vm.runInContext("di3ValidateGitHubReleaseManifest_(" + JSON.stringify(m) + ", 'dots-inventory-v4.0.0')", context);
  assert.equal(r.status, "VALID");
  assert.equal(r.file_count, 1);
});
test("rejects Preview manifest when Stable channel is selected", () => {
  const m = validManifest(); m.git_tag = "dots-inventory-v4.1.0-preview.1";
  m.release_channel = "preview"; m.source_branch = "feature/work";
  assert.throws(() => vm.runInContext("di3ValidateGitHubReleaseManifest_(" + JSON.stringify(m) + ", 'dots-inventory-v4.1.0-preview.1')", context), /не совпадает с выбранным каналом/);
});
test("accepts a feature-branch Preview manifest when Preview channel is selected", () => {
  const m = validManifest(); m.git_tag = "dots-inventory-v4.1.0-preview.1";
  m.release_channel = "preview"; m.source_branch = "feature/work";
  context.DI3_APP_CONFIG.GITHUB_RELEASE.RELEASE_CHANNEL = "preview";
  const result = vm.runInContext("di3ValidateGitHubReleaseManifest_(" + JSON.stringify(m) + ", 'dots-inventory-v4.1.0-preview.1')", context);
  assert.equal(result.status, "VALID");
  context.DI3_APP_CONFIG.GITHUB_RELEASE.RELEASE_CHANNEL = "stable";
});
test("rejects Preview claiming main as its source branch", () => {
  const m = validManifest(); m.git_tag = "dots-inventory-v4.1.0-preview.1";
  m.release_channel = "preview"; m.source_branch = "main";
  context.DI3_APP_CONFIG.GITHUB_RELEASE.RELEASE_CHANNEL = "preview";
  assert.throws(() => vm.runInContext("di3ValidateGitHubReleaseManifest_(" + JSON.stringify(m) + ", 'dots-inventory-v4.1.0-preview.1')", context), /Preview должен иметь тег/);
  context.DI3_APP_CONFIG.GITHUB_RELEASE.RELEASE_CHANNEL = "stable";
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
    { name: "appsscript", type: "JSON", source: '{"timeZone":"Europe/Moscow"}' }];
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
    { name: "appsscript", type: "JSON", source: '{"timeZone":"Europe/Moscow"}' }
  ] } };
  const envelope = vm.runInContext("di3BuildAppsScriptSourceBackupEnvelope_(" + JSON.stringify(project) + ", 'sheet-123', '2026-11-26T00:00:00.000Z')", context);
  const verified = vm.runInContext("di3VerifyAppsScriptSourceBackupEnvelope_(" + JSON.stringify(envelope) + ")", context);
  assert.equal(verified.status, "VERIFIED");
  assert.equal(verified.file_count, 2);
});
test("detects tampered source backup payload", () => {
  const project = { script_id: "script-123", content: { files: [
    { name: "Code", type: "SERVER_JS", source: "function x() {}\n" },
    { name: "appsscript", type: "JSON", source: '{"timeZone":"Europe/Moscow"}' }
  ] } };
  const envelope = vm.runInContext("di3BuildAppsScriptSourceBackupEnvelope_(" + JSON.stringify(project) + ", '', '2026-11-26T00:00:00.000Z')", context);
  envelope.payload.files[0].source = "function evil() {}\n";
  assert.throws(() => vm.runInContext("di3VerifyAppsScriptSourceBackupEnvelope_(" + JSON.stringify(envelope) + ")", context), /payload.*не совпадает/);
});
test("detects file-level corruption even when payload checksum is recomputed", () => {
  const project = { script_id: "script-123", content: { files: [
    { name: "Code", type: "SERVER_JS", source: "function x() {}\n" },
    { name: "appsscript", type: "JSON", source: '{"timeZone":"Europe/Moscow"}' }
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
    installFile("appsscript", "JSON", '{"timeZone":"Europe/Moscow"}'), installFile("Index", "HTML", '<div>local</div>')];
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
  assert.equal(preview.target_files.find(f => f.name === "appsscript").source, '{"timeZone":"Europe/Moscow"}');
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


test("refuses redirects while downloading a pinned release source", () => {
  const code = "function alpha() {}\\n";
  const m = installManifest(code);
  context.UrlFetchApp = { fetch: () => ({ getResponseCode: () => 302, getContentText: () => "" }) };
  assert.throws(() => vm.runInContext("di3FetchPinnedGitHubSource_(" + JSON.stringify(m.files[0]) + ")", context), /Перенаправления не принимаются/);
  delete context.UrlFetchApp;
});


test("fingerprints complete Apps Script files independent of API order", () => {
  const a = [installFile("Code", "SERVER_JS", "function a() {}\\n"), installFile("appsscript", "JSON", '{"timeZone":"Europe/Moscow"}')];
  const b = [a[1], a[0]];
  const left = vm.runInContext("di3AppsScriptFilesFingerprint_(" + JSON.stringify(a) + ")", context);
  const right = vm.runInContext("di3AppsScriptFilesFingerprint_(" + JSON.stringify(b) + ")", context);
  assert.equal(left, right);
});
test("fingerprint changes when any project source or manifest changes", () => {
  const a = [installFile("Code", "SERVER_JS", "function a() {}\\n"), installFile("appsscript", "JSON", '{}')];
  const b = [installFile("Code", "SERVER_JS", "function b() {}\\n"), installFile("appsscript", "JSON", '{}')];
  assert.notEqual(vm.runInContext("di3AppsScriptFilesFingerprint_(" + JSON.stringify(a) + ")", context),
    vm.runInContext("di3AppsScriptFilesFingerprint_(" + JSON.stringify(b) + ")", context));
});
test("refuses duplicate project files when fingerprinting", () => {
  const files = [installFile("Code", "SERVER_JS", "a"), installFile("Code", "SERVER_JS", "b")];
  assert.throws(() => vm.runInContext("di3AppsScriptFilesFingerprint_(" + JSON.stringify(files) + ")", context), /дублирующееся имя файла/);
});
test("requires the verified source backup to match the exact pre-install project", () => {
  const project = { script_id: "script-123", content: { files: [
    { name: "Code", type: "SERVER_JS", source: "function x() {}\\n" },
    { name: "appsscript", type: "JSON", source: '{"timeZone":"Europe/Moscow"}' }
  ] } };
  const envelope = vm.runInContext("di3BuildAppsScriptSourceBackupEnvelope_(" + JSON.stringify(project) + ", '', '2026-11-26T00:00:00.000Z')", context);
  const fingerprint = vm.runInContext("di3AppsScriptFilesFingerprint_(" + JSON.stringify(project.content.files) + ")", context);
  const verified = vm.runInContext("di3VerifyInstallBackupMatches_(" + JSON.stringify(envelope) + ", 'script-123', '" + fingerprint + "')", context);
  assert.equal(verified.status, "VERIFIED");
  assert.throws(() => vm.runInContext("di3VerifyInstallBackupMatches_(" + JSON.stringify(envelope) + ", 'other-script', '" + fingerprint + "')", context), /другому Script ID/);
  assert.throws(() => vm.runInContext("di3VerifyInstallBackupMatches_(" + JSON.stringify(envelope) + ", 'script-123', '" + "0".repeat(64) + "')", context), /не совпадает с исходным проектом/);
});
test("post-write verification accepts only an exact complete file set", () => {
  const expected = [installFile("Code", "SERVER_JS", "function x() {}\\n"), installFile("appsscript", "JSON", '{}')];
  assert.equal(vm.runInContext("di3AssertAppsScriptContentMatches_(" + JSON.stringify(expected) + ", " + JSON.stringify(expected) + ")", context).status, "VERIFIED");
  const changed = [expected[0], installFile("appsscript", "JSON", '{"timeZone":"UTC"}')];
  assert.throws(() => vm.runInContext("di3AssertAppsScriptContentMatches_(" + JSON.stringify(expected) + ", " + JSON.stringify(changed) + ")", context), /отличается от подготовленного/);
});


test("rollback restores the verified snapshot while preserving the current target manifest", () => {
  const backupProject = { script_id: "script-123", content: { files: [
    { name: "Code", type: "SERVER_JS", source: "function oldCode() {}\\n" },
    { name: "Index", type: "HTML", source: "<p>old</p>" },
    { name: "appsscript", type: "JSON", source: '{"timeZone":"Europe/Moscow","oauthScopes":["old"]}' }
  ] } };
  const currentProject = { script_id: "script-123", content: { files: [
    { name: "Code", type: "SERVER_JS", source: "function newCode() {}\\n" },
    { name: "Index", type: "HTML", source: "<p>new</p>" },
    { name: "appsscript", type: "JSON", source: '{"timeZone":"Europe/Berlin","oauthScopes":["current"]}' }
  ] } };
  const envelope = vm.runInContext("di3BuildAppsScriptSourceBackupEnvelope_(" + JSON.stringify(backupProject) + ", '', '2026-11-26T00:00:00.000Z')", context);
  const preview = vm.runInContext("di3BuildRollbackTargetFiles_(" + JSON.stringify(envelope) + ", " + JSON.stringify(currentProject) + ")", context);
  assert.equal(preview.status, "ROLLBACK_PREVIEW_READY");
  assert.equal(preview.preserved_current_manifest, true);
  assert.equal(preview.target_files.find(f => f.name === "Code").source, "function oldCode() {}\\n");
  assert.equal(preview.target_files.find(f => f.name === "Index").source, "<p>old</p>");
  assert.equal(preview.target_files.find(f => f.name === "appsscript").source, '{"timeZone":"Europe/Berlin","oauthScopes":["current"]}');
});
test("rollback refuses a backup from a different Apps Script project", () => {
  const backupProject = { script_id: "other-script", content: { files: [
    { name: "Code", type: "SERVER_JS", source: "function oldCode() {}\\n" },
    { name: "appsscript", type: "JSON", source: '{}' }
  ] } };
  const envelope = vm.runInContext("di3BuildAppsScriptSourceBackupEnvelope_(" + JSON.stringify(backupProject) + ", '', '2026-11-26T00:00:00.000Z')", context);
  const currentProject = { script_id: "script-123", content: { files: [
    { name: "Code", type: "SERVER_JS", source: "function newCode() {}\\n" },
    { name: "appsscript", type: "JSON", source: '{}' }
  ] } };
  assert.throws(() => vm.runInContext("di3BuildRollbackTargetFiles_(" + JSON.stringify(envelope) + ", " + JSON.stringify(currentProject) + ")", context), /другому Script ID/);
});
test("rollback refuses a backup without appsscript manifest", () => {
  const project = { script_id: "script-123", content: { files: [
    { name: "Code", type: "SERVER_JS", source: "function oldCode() {}\\n" },
    { name: "appsscript", type: "JSON", source: '{}' }
  ] } };
  const envelope = vm.runInContext("di3BuildAppsScriptSourceBackupEnvelope_(" + JSON.stringify(project) + ", '', '2026-11-26T00:00:00.000Z')", context);
  envelope.payload.files = envelope.payload.files.filter(f => !(f.type === "JSON" && f.name === "appsscript"));
  envelope.payload.file_count = envelope.payload.files.length;
  envelope.payload_sha256 = crypto.createHash("sha256").update(JSON.stringify(envelope.payload)).digest("hex");
  const currentProject = { script_id: "script-123", content: { files: [
    { name: "Code", type: "SERVER_JS", source: "function currentCode() {}\\n" },
    { name: "appsscript", type: "JSON", source: '{}' }
  ] } };
  assert.throws(() => vm.runInContext("di3BuildRollbackTargetFiles_(" + JSON.stringify(envelope) + ", " + JSON.stringify(currentProject) + ")", context), /backup и целевом проекте/);
});


test("Apps Script projects.getContent does not automatically forward OAuth redirects", () => {
  let observed;
  context.ScriptApp = { getScriptId: () => "script-123", getOAuthToken: () => "oauth-secret" };
  context.UrlFetchApp = { fetch: (_url, options) => {
    observed = options;
    return { getResponseCode: () => 302, getContentText: () => "redirect" };
  } };
  try {
    assert.throws(() => vm.runInContext("di3GetAppsScriptProjectContent_()", context), /HTTP 302/);
    assert.equal(observed.followRedirects, false);
    assert.equal(observed.headers.Authorization, "Bearer oauth-secret");
  } finally {
    delete context.ScriptApp;
    delete context.UrlFetchApp;
  }
});

test("Apps Script projects.updateContent does not automatically forward OAuth redirects", () => {
  let observed;
  context.ScriptApp = { getOAuthToken: () => "oauth-secret" };
  context.UrlFetchApp = { fetch: (_url, options) => {
    observed = options;
    return { getResponseCode: () => 302, getContentText: () => "redirect" };
  } };
  try {
    assert.throws(() => vm.runInContext(
      "di3UpdateAppsScriptProjectContent_('script-123', [{name:'Code',type:'SERVER_JS',source:'x'}])",
      context), /HTTP 302/);
    assert.equal(observed.followRedirects, false);
    assert.equal(observed.headers.Authorization, "Bearer oauth-secret");
  } finally {
    delete context.ScriptApp;
    delete context.UrlFetchApp;
  }
});


test("fingerprint rejects duplicate project names across file types", () => {
  const files = [installFile("Shared", "SERVER_JS", "a"), installFile("shared", "HTML", "b")];
  assert.throws(() => vm.runInContext("di3AppsScriptFilesFingerprint_(" + JSON.stringify(files) + ")", context),
    /дублирующееся имя файла между типами/);
});

test("source backup rejects duplicate names across file types", () => {
  const project = { script_id: "script-123", content: { files: [
    { name: "Shared", type: "SERVER_JS", source: "a" },
    { name: "shared", type: "HTML", source: "b" },
    { name: "appsscript", type: "JSON", source: "{}" }
  ] } };
  assert.throws(() => vm.runInContext(
    "di3BuildAppsScriptSourceBackupEnvelope_(" + JSON.stringify(project) + ", '', '2026-11-26T00:00:00.000Z')",
    context), /дублирующееся имя файла между типами/);
});

test("install preview rejects existing cross-type duplicate project names", () => {
  const code = "function alpha() {}\\n", m = installManifest(code);
  const files = [installFile("01_Module", "SERVER_JS", code),
    installFile("01_Module", "HTML", "<p>collision</p>"),
    installFile("appsscript", "JSON", "{}")];
  const downloaded = [{ name: "01_Module.gs", source: code }];
  assert.throws(() => vm.runInContext(
    "di3BuildGitHubInstallPreview_(" + JSON.stringify(m) + ", " + JSON.stringify(files) + ", " + JSON.stringify(downloaded) + ")",
    context), /дублирующееся имя файла проекта между типами/);
});


function configureInstallerHarness(answer, outcome) {
  const files = [
    installFile("Code", "SERVER_JS", "function current() {}\n"),
    installFile("appsscript", "JSON", '{"timeZone":"Europe/Moscow"}')
  ];
  const project = { script_id: "script-123", content: { files } };
  const fingerprint = vm.runInContext("di3AppsScriptFilesFingerprint_(" + JSON.stringify(files) + ")", context);
  const envelope = vm.runInContext("di3BuildAppsScriptSourceBackupEnvelope_(" + JSON.stringify(project) + ", 'sheet-123', '2026-11-28T00:00:00.000Z')", context);
  const backup = { status: "VERIFIED", file_id: "backup-file-123456", file_name: "DotsInventory_AppsScript_Source_test.json" };
  const verifiedFile = {
    getBlob: () => ({ getDataAsString: () => JSON.stringify(envelope) }),
    getName: () => backup.file_name,
    getDescription: () => "DI3_APPS_SCRIPT_SOURCE_BACKUP_V1:" + JSON.stringify({ status: "VERIFIED", script_id: "script-123", file_count: envelope.payload.file_count, payload_sha256: outcome === "metadata-mismatch" ? "0".repeat(64) : envelope.payload_sha256 }),
    getParents: () => { let consumed = false; return { hasNext: () => !consumed, next: () => { consumed = true; return { getId: () => outcome === "wrong-folder" ? "unexpected-folder" : "backup-folder-123" }; } }; },
    getUrl: () => "https://drive.google.com/file/d/backup-file-123456/view"
  };
  const targetFiles = [
    installFile("Code", "SERVER_JS", "function released() {}\n"),
    files[1]
  ];
  let readCount = 0, updateCalls = 0, alerts = [];
  let selectedBackupReadCount = 0, selectedBackupMode = "normal";
  context.di3PrepareGitHubInstallPreview = () => ({
    status: "PREVIEW_READY", summary: { removed: 0, target_file_count: 2, added: 0, changed: 1, unchanged: 1, preserved_unmanaged: 0, preserved_non_server: 1 },
    project_id: "script-123", source_project_fingerprint: fingerprint,
    release_channel: "stable", release_tag: "dots-inventory-v4.0.0", commit: "a".repeat(40),
    diff: { added: [], changed: ["Code.gs"] }, target_files: targetFiles,
    target_schema_version: 4, target_time_zone: "Europe/Moscow"
  });
  context.di3GetAppsScriptProjectContent_ = () => {
    readCount++;
    if (outcome === "concurrent-change" && readCount >= 2) return { script_id: "script-123", content: { files: [installFile("Code", "SERVER_JS", "function concurrentEdit() {}\\n"), files[1]] } };
    if (outcome === "readback-unavailable" && readCount >= 3) throw new Error("read-back unavailable");
    if (outcome === "readback-mismatch" && readCount >= 3) {
      return { script_id: "script-123", content: { files: [installFile("Code", "SERVER_JS", "function wrong() {}\n"), files[1]] } };
    }
    return project;
  };
  context.di3CreateAppsScriptSourceBackup = () => backup;
  context.DriveApp = { getFileById: () => verifiedFile };
  context.di3GetBackupFolder_ = () => ({ getId: () => "backup-folder-123" });
  context.SpreadsheetApp = { getUi: () => ({
    alert: (...args) => { alerts.push(args); return answer; },
    Button: { YES: "YES", NO: "NO", OK: "OK" },
    ButtonSet: { YES_NO: "YES_NO", OK: "OK" }
  }) };
  context.di3GetGitHubInstallCompatibilityReport_ = () => ({ status: "READY", issues: [] });
  context.di3UpdateAppsScriptProjectContent_ = () => {
    updateCalls++;
    if (outcome === "update-uncertain") throw new Error("simulated transport timeout");
    return { updateTime: "2026-11-28T00:00:00Z" };
  };
  context.PropertiesService = { getScriptProperties: () => ({ setProperty: () => {} }) };
  return { get readCount() { return readCount; }, get updateCalls() { return updateCalls; }, alerts, backup };
}

test("installer NO cancellation preserves verified backup and never calls updateContent", () => {
  const h = configureInstallerHarness("NO", "normal");
  try {
    const result = vm.runInContext("di3InstallLatestGitHubReleaseWithConfirmation()", context);
    assert.equal(result.status, "CANCELLED");
    assert.equal(result.write_performed, false);
    assert.equal(result.backup.file_id, h.backup.file_id);
    assert.equal(h.updateCalls, 0);
    assert.equal(h.readCount, 1);
  } finally {
    for (const key of ["di3PrepareGitHubInstallPreview", "di3GetAppsScriptProjectContent_", "di3CreateAppsScriptSourceBackup", "DriveApp", "SpreadsheetApp", "di3GetGitHubInstallCompatibilityReport_", "di3UpdateAppsScriptProjectContent_", "PropertiesService"]) delete context[key];
  }
});

test("installer classifies uncertain update result and does not retry", () => {
  const h = configureInstallerHarness("YES", "update-uncertain");
  try {
    const result = vm.runInContext("di3InstallLatestGitHubReleaseWithConfirmation()", context);
    assert.equal(result.status, "UPDATE_RESULT_UNCERTAIN");
    assert.equal(result.write_performed, "UNKNOWN");
    assert.equal(h.updateCalls, 1);
    assert.equal(h.readCount, 2);
  } finally {
    for (const key of ["di3PrepareGitHubInstallPreview", "di3GetAppsScriptProjectContent_", "di3CreateAppsScriptSourceBackup", "DriveApp", "SpreadsheetApp", "di3GetGitHubInstallCompatibilityReport_", "di3UpdateAppsScriptProjectContent_", "PropertiesService"]) delete context[key];
  }
});

test("installer distinguishes accepted write with unavailable post-write read-back", () => {
  const h = configureInstallerHarness("YES", "readback-unavailable");
  try {
    const result = vm.runInContext("di3InstallLatestGitHubReleaseWithConfirmation()", context);
    assert.equal(result.status, "POST_WRITE_VERIFICATION_UNAVAILABLE");
    assert.equal(result.write_performed, true);
    assert.equal(h.updateCalls, 1);
    assert.equal(h.readCount, 3);
  } finally {
    for (const key of ["di3PrepareGitHubInstallPreview", "di3GetAppsScriptProjectContent_", "di3CreateAppsScriptSourceBackup", "DriveApp", "SpreadsheetApp", "di3GetGitHubInstallCompatibilityReport_", "di3UpdateAppsScriptProjectContent_", "PropertiesService"]) delete context[key];
  }
});

test("installer distinguishes accepted write with mismatched post-write files", () => {
  const h = configureInstallerHarness("YES", "readback-mismatch");
  try {
    const result = vm.runInContext("di3InstallLatestGitHubReleaseWithConfirmation()", context);
    assert.equal(result.status, "POST_WRITE_VERIFICATION_FAILED");
    assert.equal(result.write_performed, true);
    assert.match(result.error, /отличается от подготовленного/);
    assert.equal(h.updateCalls, 1);
    assert.equal(h.readCount, 3);
  } finally {
    for (const key of ["di3PrepareGitHubInstallPreview", "di3GetAppsScriptProjectContent_", "di3CreateAppsScriptSourceBackup", "DriveApp", "SpreadsheetApp", "di3GetGitHubInstallCompatibilityReport_", "di3UpdateAppsScriptProjectContent_", "PropertiesService"]) delete context[key];
  }
});

function configureRollbackHarness(answer, outcome) {
  const currentFiles = [installFile("Code", "SERVER_JS", "function current() {}\n"), installFile("appsscript", "JSON", '{"timeZone":"Europe/Moscow"}')];
  const baseline = { script_id: "script-123", content: { files: currentFiles } };
  const oldProject = { script_id: "script-123", content: { files: [installFile("Code", "SERVER_JS", "function old() {}\n"), installFile("appsscript", "JSON", '{"timeZone":"UTC"}')] } };
  const selectedEnvelope = vm.runInContext("di3BuildAppsScriptSourceBackupEnvelope_(" + JSON.stringify(oldProject) + ", 'sheet-123', '2026-11-27T00:00:00.000Z')", context);
  const currentEnvelope = vm.runInContext("di3BuildAppsScriptSourceBackupEnvelope_(" + JSON.stringify(baseline) + ", 'sheet-123', '2026-11-28T00:00:00.000Z')", context);
  let readCount = 0, updateCalls = 0, alerts = [], selectedBackupReadCount = 0,
    selectedBackupMode = "normal";
  context.SpreadsheetApp = { getUi: () => ({
    Button: { OK: "OK", CANCEL: "CANCEL", YES: "YES", NO: "NO" },
    ButtonSet: { OK_CANCEL: "OK_CANCEL", YES_NO: "YES_NO", OK: "OK" },
    prompt: () => ({ getSelectedButton: () => "OK", getResponseText: () => "selected-backup-123456" }),
    alert: (...args) => { alerts.push(args); return answer; }
  }) };
  context.di3GetAppsScriptProjectContent_ = () => {
    readCount++;
    if (outcome === "concurrent-change" && readCount >= 2) return { script_id: "script-123", content: { files: [installFile("Code", "SERVER_JS", "function concurrentEdit() {}\\n"), currentFiles[1]] } };
    if (outcome === "readback-unavailable" && readCount >= 3) throw new Error("rollback read-back unavailable");
    if (outcome === "readback-mismatch" && readCount >= 3) return { script_id: "script-123", content: { files: [installFile("Code", "SERVER_JS", "function wrong() {}\n"), currentFiles[1]] } };
    if (outcome === "restore-expected" && readCount >= 3) return { script_id: "script-123", content: { files: [installFile("Code", "SERVER_JS", "function old() {}\n"), installFile("appsscript", "JSON", '{"timeZone":"Europe/Moscow"}')] } };
    if (readCount >= 3) return { script_id: "script-123", content: { files: [installFile("Code", "SERVER_JS", "function old() {}\n"), installFile("appsscript", "JSON", '{"timeZone":"Europe/Moscow"}')] } };
    return baseline;
  };
  context.di3ReadVerifiedRollbackBackup_ = () => {
    selectedBackupReadCount++;
    if (selectedBackupMode === "deleted-after-confirmation" && selectedBackupReadCount >= 2) {
      throw new Error("selected source backup not found");
    }
    return { file_id: "selected-backup-123456", file_name: "DI3_SOURCE_BACKUP_old.json",
      created_at_utc: "2026-11-27T00:00:00Z", envelope: selectedEnvelope,
      payload_sha256: selectedEnvelope.payload_sha256, verification:{script_id:"script-123"},
      url: "https://drive.google.com/selected" };
  };
  context.di3CreateAppsScriptSourceBackup = () => ({ status: "VERIFIED", file_id: "current-backup-123456", file_name: "DI3_SOURCE_BACKUP_current.json" });
  context.di3ReadAndVerifyInstallBackup_ = () => ({ file_id: "current-backup-123456", file_name: "DI3_SOURCE_BACKUP_current.json", url: "https://drive.google.com/current" });
  context.di3UpdateAppsScriptProjectContent_ = () => { updateCalls++; if (outcome === "update-uncertain") throw new Error("simulated rollback transport timeout"); return { updateTime: "2026-11-28T00:00:00Z" }; };
  context.PropertiesService = { getScriptProperties: () => ({ deleteProperty: () => {} }) };
  return { get readCount() { return readCount; }, get updateCalls() { return updateCalls; },
    get selectedBackupReadCount() { return selectedBackupReadCount; }, set selectedBackupMode(value) { selectedBackupMode = value; }, alerts };
}

test("rollback NO cancellation never calls updateContent", () => {
  const h = configureRollbackHarness("NO", "normal");
  try { const result = vm.runInContext("di3RollbackAppsScriptCodeWithConfirmation()", context); assert.equal(result.status, "CANCELLED"); assert.equal(result.write_performed, false); assert.equal(h.updateCalls, 0); assert.equal(h.readCount, 1); }
  finally { for (const key of ["SpreadsheetApp", "di3GetAppsScriptProjectContent_", "di3ReadVerifiedRollbackBackup_", "di3CreateAppsScriptSourceBackup", "di3ReadAndVerifyInstallBackup_", "di3UpdateAppsScriptProjectContent_", "PropertiesService"]) delete context[key]; }
});

test("rollback classifies uncertain update and does not retry", () => {
  const h = configureRollbackHarness("YES", "update-uncertain");
  try { const result = vm.runInContext("di3RollbackAppsScriptCodeWithConfirmation()", context); assert.equal(result.status, "ROLLBACK_RESULT_UNCERTAIN"); assert.equal(result.write_performed, "UNKNOWN"); assert.equal(h.updateCalls, 1); assert.equal(h.readCount, 2); }
  finally { for (const key of ["SpreadsheetApp", "di3GetAppsScriptProjectContent_", "di3ReadVerifiedRollbackBackup_", "di3CreateAppsScriptSourceBackup", "di3ReadAndVerifyInstallBackup_", "di3UpdateAppsScriptProjectContent_", "PropertiesService"]) delete context[key]; }
});

test("rollback distinguishes unavailable post-write verification", () => {
  const h = configureRollbackHarness("YES", "readback-unavailable");
  try { const result = vm.runInContext("di3RollbackAppsScriptCodeWithConfirmation()", context); assert.equal(result.status, "ROLLBACK_VERIFICATION_UNAVAILABLE"); assert.equal(result.write_performed, true); assert.equal(h.updateCalls, 1); assert.equal(h.readCount, 3); }
  finally { for (const key of ["SpreadsheetApp", "di3GetAppsScriptProjectContent_", "di3ReadVerifiedRollbackBackup_", "di3CreateAppsScriptSourceBackup", "di3ReadAndVerifyInstallBackup_", "di3UpdateAppsScriptProjectContent_", "PropertiesService"]) delete context[key]; }
});

test("rollback distinguishes mismatched post-write file set", () => {
  const h = configureRollbackHarness("YES", "readback-mismatch");
  try { const result = vm.runInContext("di3RollbackAppsScriptCodeWithConfirmation()", context); assert.equal(result.status, "ROLLBACK_VERIFICATION_FAILED"); assert.equal(result.write_performed, true); assert.match(result.error, /отличается от подготовленного/); assert.equal(h.updateCalls, 1); assert.equal(h.readCount, 3); }
  finally { for (const key of ["SpreadsheetApp", "di3GetAppsScriptProjectContent_", "di3ReadVerifiedRollbackBackup_", "di3CreateAppsScriptSourceBackup", "di3ReadAndVerifyInstallBackup_", "di3UpdateAppsScriptProjectContent_", "PropertiesService"]) delete context[key]; }
});

test("installer final fingerprint guard blocks concurrent project edits", () => {
  const h = configureInstallerHarness("YES", "concurrent-change");
  try { assert.throws(() => vm.runInContext("di3InstallLatestGitHubReleaseWithConfirmation()", context), /проект изменился после подтверждения/); assert.equal(h.updateCalls, 0); assert.equal(h.readCount, 2); }
  finally { for (const key of ["di3PrepareGitHubInstallPreview", "di3GetAppsScriptProjectContent_", "di3CreateAppsScriptSourceBackup", "DriveApp", "SpreadsheetApp", "di3GetGitHubInstallCompatibilityReport_", "di3UpdateAppsScriptProjectContent_", "PropertiesService"]) delete context[key]; }
});

test("rollback final fingerprint guard blocks concurrent project edits", () => {
  const h = configureRollbackHarness("YES", "concurrent-change");
  try { assert.throws(() => vm.runInContext("di3RollbackAppsScriptCodeWithConfirmation()", context), /проект изменился после создания резервной копии/); assert.equal(h.updateCalls, 0); assert.equal(h.readCount, 2); }
  finally { for (const key of ["SpreadsheetApp", "di3GetAppsScriptProjectContent_", "di3ReadVerifiedRollbackBackup_", "di3CreateAppsScriptSourceBackup", "di3ReadAndVerifyInstallBackup_", "di3UpdateAppsScriptProjectContent_", "PropertiesService"]) delete context[key]; }
});

test("installer rejects Drive backup metadata that differs from verified payload", () => {
  const h = configureInstallerHarness("NO", "metadata-mismatch");
  try { assert.throws(() => vm.runInContext("di3InstallLatestGitHubReleaseWithConfirmation()", context), /метаданные Drive source backup не совпадают/i); assert.equal(h.updateCalls, 0); }
  finally { for (const key of ["di3PrepareGitHubInstallPreview", "di3GetAppsScriptProjectContent_", "di3CreateAppsScriptSourceBackup", "DriveApp", "di3GetBackupFolder_", "SpreadsheetApp", "di3GetGitHubInstallCompatibilityReport_", "di3UpdateAppsScriptProjectContent_", "PropertiesService"]) delete context[key]; }
});

test("installer rejects source backup moved outside configured backup folder", () => {
  const h = configureInstallerHarness("NO", "wrong-folder");
  try { assert.throws(() => vm.runInContext("di3InstallLatestGitHubReleaseWithConfirmation()", context), /находится вне папки резервных копий/); assert.equal(h.updateCalls, 0); }
  finally { for (const key of ["di3PrepareGitHubInstallPreview", "di3GetAppsScriptProjectContent_", "di3CreateAppsScriptSourceBackup", "DriveApp", "di3GetBackupFolder_", "SpreadsheetApp", "di3GetGitHubInstallCompatibilityReport_", "di3UpdateAppsScriptProjectContent_", "PropertiesService"]) delete context[key]; }
});

test("rollback reopens the selected backup after YES before updateContent", () => {
  const h = configureRollbackHarness("YES", "restore-expected");
  try {
    const result = vm.runInContext("di3RollbackAppsScriptCodeWithConfirmation()", context);
    assert.equal(result.status, "ROLLED_BACK_AND_VERIFIED");
    assert.equal(h.selectedBackupReadCount, 2);
    assert.equal(h.updateCalls, 1);
  } finally {
    for (const key of ["SpreadsheetApp", "di3GetAppsScriptProjectContent_", "di3ReadVerifiedRollbackBackup_", "di3CreateAppsScriptSourceBackup", "di3ReadAndVerifyInstallBackup_", "di3UpdateAppsScriptProjectContent_", "PropertiesService"]) delete context[key];
  }
});

test("rollback fails closed if selected backup becomes unavailable after YES", () => {
  const h = configureRollbackHarness("YES", "normal");
  h.selectedBackupMode = "deleted-after-confirmation";
  try {
    assert.throws(() => vm.runInContext("di3RollbackAppsScriptCodeWithConfirmation()", context), /selected source backup not found/);
    assert.equal(h.selectedBackupReadCount, 2);
    assert.equal(h.updateCalls, 0);
  } finally {
    for (const key of ["SpreadsheetApp", "di3GetAppsScriptProjectContent_", "di3ReadVerifiedRollbackBackup_", "di3CreateAppsScriptSourceBackup", "di3ReadAndVerifyInstallBackup_", "di3UpdateAppsScriptProjectContent_", "PropertiesService"]) delete context[key];
  }
});


test("validates safe GitHub branch names and rejects unsafe refs", () => {
  assert.equal(vm.runInContext("di3ValidateGitHubBranchName_('feature/my-change')", context), "feature/my-change");
  assert.equal(vm.runInContext("di3ValidateGitHubBranchName_('release/v4.1')", context), "release/v4.1");
  assert.equal(vm.runInContext("di3ValidateGitHubBranchName_('main')", context), "main");
  assert.equal(vm.runInContext("di3ValidateGitHubBranchName_('bugfix/branch-selector')", context), "bugfix/branch-selector");
  assert.throws(() => vm.runInContext("di3ValidateGitHubBranchName_('feature/.hidden')", context), /Недопустимое имя GitHub-ветки/);
  assert.throws(() => vm.runInContext("di3ValidateGitHubBranchName_('feature/../main')", context), /Недопустимое имя GitHub-ветки/);
  assert.throws(() => vm.runInContext("di3ValidateGitHubBranchName_('feature//nested')", context), /Недопустимое имя GitHub-ветки/);
  assert.throws(() => vm.runInContext("di3ValidateGitHubBranchName_('feature/branch.lock')", context), /Недопустимое имя GitHub-ветки/);
});

test("builds a branch manifest pinned to one immutable commit and validates it", () => {
  const branch = "feature/branch-test";
  const commit = "b".repeat(40);
  const sources = {
    "src/apps_script/00_DI3_AppConfig.gs": 'var DI3_APP_CONFIG = Object.freeze({ TIME_ZONE: "Europe/Moscow" });\n',
    "src/apps_script/33_DI3_SchemaVersioning.gs": "var DI3_SCHEMA_VERSION = 4;\n",
    "src/apps_script/01_Module.gs": "function alpha() { return 1; }\n"
  };
  const tree = Object.entries(sources).map(([path, source]) => ({
    path, type: "blob", mode: "100644", size: Buffer.byteLength(source),
    sha: crypto.createHash("sha1").update("blob " + Buffer.byteLength(source) + String.fromCharCode(0) + source, "utf8").digest("hex")
  }));
  const manifest = vm.runInContext(
    "di3BuildGitHubBranchManifestFromSources_(" + JSON.stringify(branch) + "," +
      JSON.stringify(commit) + "," + JSON.stringify(tree) + "," + JSON.stringify(sources) + ")",
    context
  );
  assert.equal(manifest.release_channel, "branch");
  assert.equal(manifest.source_branch, branch);
  assert.equal(manifest.git_commit, commit);
  assert.equal(manifest.git_tag, "branch:" + branch + "@" + commit.slice(0, 12));
  assert.equal(manifest.target_schema_version, 4);
  assert.equal(manifest.application_time_zone, "Europe/Moscow");
  assert.ok(manifest.files.every(file => file.raw_url.includes("/" + commit + "/src/apps_script/")));
  const checked = vm.runInContext(
    "di3ValidateGitHubReleaseManifest_(" + JSON.stringify(manifest) + "," + JSON.stringify(manifest.git_tag) + ")",
    context
  );
  assert.equal(checked.status, "VALID");
  assert.equal(checked.file_count, 3);
});

test("branch manifest rejects unsafe branch metadata and a mismatched commit tag", () => {
  const manifest = {
    format: "dots-inventory-release/v1", git_tag: "branch:feature/work@cccccccccccc",
    release_channel: "branch", source_branch: "feature/../work", git_commit: "c".repeat(40),
    target_schema_version: 4, application_time_zone: "Europe/Moscow", minimum_updater_version: "0.2.0",
    manifest_policy: "PRESERVE_TARGET_PROJECT_MANIFEST", source_policy: "PINNED_COMMIT_RAW_FILES",
    files: [{ name: "01_Module.gs", type: "SERVER_JS", source_path: "src/apps_script/01_Module.gs",
      raw_url: "https://raw.githubusercontent.com/brusvv/dots_inventory-/" + "c".repeat(40) + "/src/apps_script/01_Module.gs",
      size_bytes: 1, sha256: "d".repeat(64) }]
  };
  assert.throws(() => vm.runInContext("di3ValidateGitHubReleaseManifest_(" + JSON.stringify(manifest) + "," + JSON.stringify(manifest.git_tag) + ")", context), /Недопустимое имя GitHub-ветки/);
  manifest.source_branch = "feature/work";
  manifest.git_tag = "branch:feature/work@000000000000";
  assert.throws(() => vm.runInContext("di3ValidateGitHubReleaseManifest_(" + JSON.stringify(manifest) + "," + JSON.stringify(manifest.git_tag) + ")", context), /привязан к точному commit SHA/);
});

test("selected branch fails closed when its immutable commit SHA is missing", () => {
  context.PropertiesService = { getScriptProperties: () => ({
    getProperty: key => key === "DI3_GITHUB_SELECTED_BRANCH" ? "feature/branch-test" : null
  }) };
  try {
    assert.throws(() => vm.runInContext("di3GetSelectedGitHubBranchSelection_()", context),
      /не сохранён полный commit SHA/);
  } finally {
    delete context.PropertiesService;
  }
});

test("selected branch overrides Stable/Preview discovery using the persisted commit SHA", () => {
  const pinnedCommit = "9".repeat(40);
  context.PropertiesService = { getScriptProperties: () => ({
    getProperty: key => key === "DI3_GITHUB_SELECTED_BRANCH" ? "feature/branch-test" :
      (key === "DI3_GITHUB_SELECTED_COMMIT" ? pinnedCommit : null)
  }) };
  context.di3GetGitHubBranchManifest_ = (branch, commit) => ({ status: "READY", selected: branch, commit });
  try {
    const result = vm.runInContext("di3GetLatestGitHubReleaseManifest_()", context);
    assert.equal(result.status, "READY");
    assert.equal(result.selected, "feature/branch-test");
    assert.equal(result.commit, pinnedCommit);
  } finally {
    delete context.PropertiesService;
    delete context.di3GetGitHubBranchManifest_;
  }
});

test("branch Git tree preflight rejects symlinks and oversized source sets before fetching", () => {
  const valid = {
    path: "src/apps_script/01_Module.gs", type: "blob", mode: "100644",
    size: 10, sha: "a".repeat(40)
  };
  assert.equal(vm.runInContext(
    "di3ValidateGitHubBranchTreeEntries_(" + JSON.stringify([valid, { path: "README.md", type: "blob" }]) + ").length",
    context
  ), 1);
  const symlink = { ...valid, mode: "120000" };
  assert.throws(() => vm.runInContext(
    "di3ValidateGitHubBranchTreeEntries_(" + JSON.stringify([symlink]) + ")",
    context
  ), /разрешены только обычные файлы/);
  const tooMany = Array.from({ length: 201 }, (_, i) => ({
    path: "src/apps_script/" + String(i).padStart(3, "0") + ".gs",
    type: "blob", mode: "100644", size: 1, sha: "b".repeat(40)
  }));
  assert.throws(() => vm.runInContext(
    "di3ValidateGitHubBranchTreeEntries_(" + JSON.stringify(tooMany) + ")",
    context
  ), /от 1 до 200/);
  const tooLarge = [{ ...valid, size: 10000001 }];
  assert.throws(() => vm.runInContext(
    "di3ValidateGitHubBranchTreeEntries_(" + JSON.stringify(tooLarge) + ")",
    context
  ), /превышает 10 MB/);
});

test("branch manifest rejects symlink-mode Apps Script entries", () => {
  const branch = "feature/symlink-source";
  const commit = "d".repeat(40);
  const sources = {
    "src/apps_script/00_DI3_AppConfig.gs": 'var DI3_APP_CONFIG = Object.freeze({ TIME_ZONE: "Europe/Moscow" });',
    "src/apps_script/33_DI3_SchemaVersioning.gs": "var DI3_SCHEMA_VERSION = 4;"
  };
  const tree = Object.entries(sources).map(([path, content]) => ({
    path, type: "blob", mode: "100644", size: Buffer.byteLength(content),
    sha: crypto.createHash("sha1").update("blob " + Buffer.byteLength(content) + String.fromCharCode(0) + content, "utf8").digest("hex")
  }));
  tree[0].mode = "120000";
  assert.throws(() => vm.runInContext(
    "di3BuildGitHubBranchManifestFromSources_(" + JSON.stringify(branch) + "," +
      JSON.stringify(commit) + "," + JSON.stringify(tree) + "," + JSON.stringify(sources) + ")",
    context
  ), /не является обычным файлом Apps Script/);
});

test("rejects branch source content that does not match its Git blob SHA", () => {
  const branch = "feature/blob-integrity";
  const commit = "e".repeat(40);
  const sources = {
    "src/apps_script/00_DI3_AppConfig.gs": "var DI3_APP_CONFIG = Object.freeze({ TIME_ZONE: \"Europe/Moscow\" });",
    "src/apps_script/33_DI3_SchemaVersioning.gs": "var DI3_SCHEMA_VERSION = 4;"
  };
  const tree = Object.entries(sources).map(([path, source]) => ({
    path, type: "blob", mode: "100644", size: Buffer.byteLength(source),
    sha: crypto.createHash("sha1").update("blob " + Buffer.byteLength(source) + String.fromCharCode(0) + source, "utf8").digest("hex")
  }));
  tree[0].sha = "f".repeat(40);
  assert.throws(() => vm.runInContext(
    "di3BuildGitHubBranchManifestFromSources_(" + JSON.stringify(branch) + "," +
      JSON.stringify(commit) + "," + JSON.stringify(tree) + "," + JSON.stringify(sources) + ")",
    context
  ), /Git blob SHA-1/);
});

test("branch-selector-capable source cannot replace only part of the updater module set", () => {
  const branch = "feature/partial-updater";
  const commit = "c".repeat(40);
  const sources = {
    "src/apps_script/00_DI3_AppConfig.gs": 'var DI3_APP_CONFIG = Object.freeze({ TIME_ZONE: "Europe/Moscow" });',
    "src/apps_script/33_DI3_SchemaVersioning.gs": "var DI3_SCHEMA_VERSION = 4;",
    "src/apps_script/43_DI3_GitHubDeploymentManager.gs":
      'var DI3_GITHUB_UPDATER_VERSION = "0.2.0"; function di3SelectGitHubSourceBranch() {}',
    "src/apps_script/44_DI3_GitHubInstallPreview.gs": "function preview() {}",
    "src/apps_script/45_DI3_GitHubConfirmedInstaller.gs": "function install() {}"
  };
  const tree = Object.entries(sources).map(([path, source]) => ({
    path, type: "blob", mode: "100644", size: Buffer.byteLength(source),
    sha: crypto.createHash("sha1").update("blob " + Buffer.byteLength(source) + String.fromCharCode(0) + source, "utf8").digest("hex")
  }));
  assert.throws(() => vm.runInContext(
    "di3BuildGitHubBranchManifestFromSources_(" + JSON.stringify(branch) + "," +
      JSON.stringify(commit) + "," + JSON.stringify(tree) + "," + JSON.stringify(sources) + ")",
    context
  ), /полный согласованный набор updater-модулей/);
});

test("branch selector persists the exact selected commit and reset restores configured channel", () => {
  const stored = {};
  const commit = "6".repeat(40);
  const ui = {
    ButtonSet: { OK_CANCEL: "OK_CANCEL", OK: "OK" },
    Button: { OK: "OK", CANCEL: "CANCEL" },
    prompt: () => ({ getSelectedButton: () => "OK", getResponseText: () => "main" }),
    alert: () => {}
  };
  context.SpreadsheetApp = { getUi: () => ui };
  context.PropertiesService = { getScriptProperties: () => ({
    getProperty: key => stored[key] || null,
    setProperties: values => Object.assign(stored, values),
    deleteProperty: key => { delete stored[key]; }
  }) };
  context.di3FetchGitHubJson_ = () => ({ status: "OK", data: [{ name: "main" }, { name: "bugfix/test" }] });
  context.di3GetGitHubBranchManifest_ = branch => ({
    manifest: { git_commit: commit, target_schema_version: 4, application_time_zone: "Europe/Moscow" }
  });
  try {
    const selected = vm.runInContext("di3SelectGitHubSourceBranch()", context);
    assert.equal(selected.status, "SELECTED");
    assert.equal(selected.branch, "main");
    assert.equal(selected.commit, commit);
    assert.equal(stored.DI3_GITHUB_SELECTED_BRANCH, "main");
    assert.equal(stored.DI3_GITHUB_SELECTED_COMMIT, commit);
    const cleared = vm.runInContext("di3ClearGitHubSourceBranchSelection()", context);
    assert.equal(cleared.status, "CLEARED");
    assert.equal(stored.DI3_GITHUB_SELECTED_BRANCH, undefined);
    assert.equal(stored.DI3_GITHUB_SELECTED_COMMIT, undefined);
  } finally {
    delete context.SpreadsheetApp;
    delete context.PropertiesService;
    delete context.di3FetchGitHubJson_;
    delete context.di3GetGitHubBranchManifest_;
  }
});

test("resolves a branch to one pinned commit and preflights the Git tree before raw downloads", () => {
  const branch = "feature/api-test";
  const commit = "7".repeat(40);
  const treeSha = "8".repeat(40);
  const sources = {
    "src/apps_script/00_DI3_AppConfig.gs": 'var DI3_APP_CONFIG = Object.freeze({ TIME_ZONE: "Europe/Moscow" });\n',
    "src/apps_script/33_DI3_SchemaVersioning.gs": "var DI3_SCHEMA_VERSION = 4;\n",
    "src/apps_script/01_Module.gs": "function alpha() { return 1; }\n"
  };
  const entries = Object.entries(sources).map(([path, source]) => ({
    path, type: "blob", mode: "100644", size: Buffer.byteLength(source),
    sha: crypto.createHash("sha1").update("blob " + Buffer.byteLength(source) + String.fromCharCode(0) + source, "utf8").digest("hex")
  }));
  const apiCalls = [];
  let rawFetchCount = 0;
  context.di3FetchGitHubJson_ = url => {
    apiCalls.push(url);
    if (url.endsWith("/branches/" + encodeURIComponent(branch))) {
      return { status: "OK", data: { name: branch, commit: { sha: commit } } };
    }
    if (url.endsWith("/git/commits/" + commit)) {
      return { status: "OK", data: { sha: commit, tree: { sha: treeSha } } };
    }
    if (url.endsWith("/git/trees/" + treeSha + "?recursive=1")) {
      return { status: "OK", data: { tree: entries, truncated: false } };
    }
    throw new Error("Unexpected GitHub API URL: " + url);
  };
  context.UrlFetchApp = { fetch: url => {
    rawFetchCount++;
    const name = decodeURIComponent(String(url).split("/").pop());
    const source = sources["src/apps_script/" + name];
    if (source == null) throw new Error("Unexpected raw URL: " + url);
    return { getResponseCode: () => 200, getContentText: () => source };
  } };
  try {
    const result = vm.runInContext("di3GetGitHubBranchManifest_(" + JSON.stringify(branch) + ")", context);
    assert.equal(result.status, "READY");
    assert.equal(result.manifest.git_commit, commit);
    assert.equal(result.manifest.source_branch, branch);
    assert.equal(result.validation.status, "VALID");
    assert.equal(rawFetchCount, 3);
    assert.ok(apiCalls.some(url => url.endsWith("/branches/feature%2Fapi-test")));

    rawFetchCount = 0;
    const originalMode = entries[0].mode;
    entries[0].mode = "120000";
    assert.throws(() => vm.runInContext("di3GetGitHubBranchManifest_(" + JSON.stringify(branch) + ")", context),
      /разрешены только обычные файлы/);
    assert.equal(rawFetchCount, 0);
    entries[0].mode = originalMode;
  } finally {
    delete context.di3FetchGitHubJson_;
    delete context.UrlFetchApp;
  }
});

test("preserves installed updater modules for older branches without branch selector support", () => {
  const branch = "feature/older-business-change";
  const commit = "a".repeat(40);
  const sources = {
    "src/apps_script/00_DI3_AppConfig.gs": 'var DI3_APP_CONFIG = Object.freeze({ TIME_ZONE: "Europe/Moscow" });',
    "src/apps_script/33_DI3_SchemaVersioning.gs": "var DI3_SCHEMA_VERSION = 4;",
    "src/apps_script/43_DI3_GitHubDeploymentManager.gs": 'var DI3_GITHUB_UPDATER_VERSION = "0.1.0";',
    "src/apps_script/44_DI3_GitHubInstallPreview.gs": "function oldPreview() {}",
    "src/apps_script/45_DI3_GitHubConfirmedInstaller.gs": "function oldInstall() {}",
    "src/apps_script/46_DI3_GitHubCodeRollback.gs": "function oldRollback() {}"
  };
  const tree = Object.entries(sources).map(([path, source]) => ({
    path, type: "blob", mode: "100644", size: Buffer.byteLength(source),
    sha: crypto.createHash("sha1").update("blob " + Buffer.byteLength(source) + String.fromCharCode(0) + source, "utf8").digest("hex")
  }));
  const manifest = vm.runInContext(
    "di3BuildGitHubBranchManifestFromSources_(" + JSON.stringify(branch) + "," +
      JSON.stringify(commit) + "," + JSON.stringify(tree) + "," + JSON.stringify(sources) + ")",
    context
  );
  assert.ok(manifest.files.every(file => !/^4[3-6]_DI3_GitHub/.test(file.name)));
});

console.log("\n" + passed + " GitHub deployment-manager tests passed.");
