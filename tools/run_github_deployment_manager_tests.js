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
    DigestAlgorithm: { SHA_256: "SHA-256" },
    Charset: { UTF_8: "UTF-8" },
    computeDigest: (_algorithm, value) => Array.from(crypto.createHash("sha256").update(String(value), "utf8").digest()).map((b) => b > 127 ? b - 256 : b),
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

console.log("\n" + passed + " GitHub deployment-manager tests passed.");
