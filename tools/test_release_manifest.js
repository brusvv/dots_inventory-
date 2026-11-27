#!/usr/bin/env node
"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { buildManifest, writeReleaseArtifacts, listAppsScriptFiles } = require("./build_release_manifest");
const hash = (x) => crypto.createHash("sha256").update(x).digest("hex");
function fixture(fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "dots-release-test-"));
  const sourceDir = path.join(root, "src"); fs.mkdirSync(sourceDir);
  fs.writeFileSync(path.join(sourceDir, "00_DI3_AppConfig.gs"), 'var DI3_APP_CONFIG = { TIME_ZONE: "Europe/Moscow" };');
  fs.writeFileSync(path.join(sourceDir, "33_DI3_SchemaVersioning.gs"), "var DI3_SCHEMA_VERSION = 4;");
  fs.writeFileSync(path.join(sourceDir, "01_Module.gs"), "function alpha() { return 1; }\n");
  fs.writeFileSync(path.join(sourceDir, "02_Module.gs"), "function beta() { return 2; }\n");
  try { fn({ root, sourceDir }); } finally { fs.rmSync(root, { recursive: true, force: true }); }
}
const base = { repository: "brusvv/dots_inventory-", commit: "a".repeat(40), tag: "dots-inventory-v4.0.0", channel: "stable", sourceBranch: "main" };
let passed = 0;
function test(name, fn) { fn(); passed++; process.stdout.write("PASS " + name + "\n"); }
fixture(({ sourceDir }) => {
  test("deterministic pinned manifest and release metadata", () => {
    const a = buildManifest({ ...base, sourceDir }), b = buildManifest({ ...base, sourceDir });
    assert.deepEqual(a, b); assert.equal(a.format, "dots-inventory-release/v1"); assert.equal(a.target_schema_version, 4);
    assert.equal(a.release_channel, "stable"); assert.equal(a.source_branch, "main");
    assert.equal(a.application_time_zone, "Europe/Moscow");
    assert.equal(a.minimum_updater_version, "0.2.0"); assert.equal(a.manifest_policy, "PRESERVE_TARGET_PROJECT_MANIFEST");
    assert.equal(a.files.length, 4); assert.ok(a.files.every((f) => f.raw_url.includes(base.commit)));
  });
  test("SHA-256 matches exact source bytes", () => {
    const m = buildManifest({ ...base, sourceDir }), f = m.files.find((x) => x.name === "01_Module.gs");
    assert.equal(f.sha256, hash(fs.readFileSync(path.join(sourceDir, f.name))));
  });
  test("writes manifest and detached checksums", () => {
    const out = path.join(path.dirname(sourceDir), "out"), m = writeReleaseArtifacts({ ...base, sourceDir, outputDir: out });
    const bytes = fs.readFileSync(path.join(out, "release-manifest.json"));
    assert.equal(fs.readFileSync(path.join(out, "release-manifest.sha256"), "utf8").split(/\s+/)[0], hash(bytes));
    assert.ok(fs.readFileSync(path.join(out, "SHA256SUMS.txt"), "utf8").includes(m.files[0].sha256));
  });
});
fixture(({ sourceDir }) => {
  test("rejects non-release tag", () => assert.throws(() => buildManifest({ ...base, tag: "main", sourceDir }), /Тег релиза/));
  test("builds a Preview manifest from a feature branch", () => {
    const m = buildManifest({ ...base, tag: "dots-inventory-v4.1.0-preview.1", channel: "preview",
      sourceBranch: "feature/new-dashboard", sourceDir });
    assert.equal(m.release_channel, "preview");
    assert.equal(m.source_branch, "feature/new-dashboard");
    assert.equal(m.release_version, "4.1.0-preview.1");
  });
  test("rejects Preview without a non-main source branch", () => {
    assert.throws(() => buildManifest({ ...base, tag: "dots-inventory-v4.1.0-preview.1",
      channel: "preview", sourceBranch: "main", sourceDir }), /исходную ветку/);
  });
  test("rejects Preview from an unsupported source branch", () => {
    assert.throws(() => buildManifest({ ...base, tag: "dots-inventory-v4.1.0-preview.1",
      channel: "preview", sourceBranch: "bugfix/new-feature", sourceDir }), /исходную ветку/);
  });
  test("rejects stable release from a feature branch", () => {
    assert.throws(() => buildManifest({ ...base, sourceBranch: "feature/work", sourceDir }), /из main/);
  });
  test("rejects channel/tag mismatch", () => {
    assert.throws(() => buildManifest({ ...base, channel: "preview", sourceBranch: "feature/work", sourceDir }), /не соответствует суффиксу/);
  });
  test("rejects abbreviated commit SHA", () => assert.throws(() => buildManifest({ ...base, commit: "abc123", sourceDir }), /полный 40-символьный/));
  test("rejects invalid repository identifier", () => assert.throws(() => buildManifest({ ...base, repository: "bad", sourceDir }), /owner\/repository/));
  test("rejects missing config", () => { fs.unlinkSync(path.join(sourceDir, "00_DI3_AppConfig.gs")); assert.throws(() => buildManifest({ ...base, sourceDir }), /ENOENT/); });
});
fixture(({ sourceDir }) => {
  test("rejects missing schema version", () => { fs.writeFileSync(path.join(sourceDir, "33_DI3_SchemaVersioning.gs"), "var CURRENT = 4;"); assert.throws(() => buildManifest({ ...base, sourceDir }), /DI3_SCHEMA_VERSION/); });
  test("rejects an invalid IANA timezone in application config", () => {
    fs.writeFileSync(path.join(sourceDir, "00_DI3_AppConfig.gs"), 'var DI3_APP_CONFIG = { TIME_ZONE: "Mars/Olympus_Mons" };');
    assert.throws(() => buildManifest({ ...base, sourceDir }), /корректным идентификатором IANA/);
  });
  test("rejects empty source tree", () => { for (const n of fs.readdirSync(sourceDir)) fs.unlinkSync(path.join(sourceDir, n)); assert.throws(() => listAppsScriptFiles(sourceDir), /не найдено ни одного/); });
});
process.stdout.write("\n" + passed + " release-manifest tests passed.\n");
