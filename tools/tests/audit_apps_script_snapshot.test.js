"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { gitBlobSha1, auditSnapshot } = require("../audit_apps_script_snapshot");

function withSourceDir(files, callback) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "di3-source-audit-"));
  try {
    for (const [name, source] of Object.entries(files)) {
      fs.writeFileSync(path.join(dir, name + ".gs"), source, "utf8");
    }
    callback(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function validBackup() {
  return {
    name: "bootstrap.json",
    readable: true,
    payload_sha256_valid: true,
    file_hashes_valid: true,
    script_id_matches: true,
    spreadsheet_id_matches: true,
    description_marker_present: true,
    metadata_valid: true,
    backup_folder_membership_matches: true
  };
}

test("Git blob SHA-1 matches the Git object format", () => {
  assert.equal(
    gitBlobSha1("test\n"),
    "9daeafb9864cf43055ae93beb0afd6c7d144bfa4"
  );
});

test("snapshot audit passes exact modules and a verified backup", () => {
  withSourceDir({ A: "alpha\n", B: "beta\n" }, (sourceDir) => {
    const snapshot = {
      format: "dots-inventory-runtime-source-audit/v1",
      script_id: "script-test",
      spreadsheet_id: "sheet-test",
      files: [
        { name: "A", type: "SERVER_JS", git_blob_sha1: gitBlobSha1("alpha\n"), size_bytes: 6 },
        { name: "B", type: "SERVER_JS", git_blob_sha1: gitBlobSha1("beta\n"), size_bytes: 5 },
        { name: "operator_temp", type: "SERVER_JS", git_blob_sha1: "ignored", size_bytes: 1 }
      ],
      backups: [validBackup()]
    };
    const report = auditSnapshot(snapshot, sourceDir);
    assert.equal(report.status, "PASS");
    assert.equal(report.matched, 2);
    assert.deepEqual(report.missing, []);
    assert.deepEqual(report.mismatched, []);
    assert.deepEqual(report.extra_ignored, ["operator_temp"]);
  });
});

test("snapshot audit reports missing modules", () => {
  withSourceDir({ A: "alpha\n", B: "beta\n" }, (sourceDir) => {
    const report = auditSnapshot({
      format: "dots-inventory-runtime-source-audit/v1",
      files: [
        { name: "A", type: "SERVER_JS", git_blob_sha1: gitBlobSha1("alpha\n"), size_bytes: 6 }
      ],
      backups: [validBackup()]
    }, sourceDir);
    assert.equal(report.status, "FAIL");
    assert.deepEqual(report.missing, ["B"]);
  });
});

test("snapshot audit reports changed content or byte size", () => {
  withSourceDir({ A: "alpha\n" }, (sourceDir) => {
    const report = auditSnapshot({
      format: "dots-inventory-runtime-source-audit/v1",
      files: [
        { name: "A", type: "SERVER_JS", git_blob_sha1: gitBlobSha1("altered\n"), size_bytes: 6 }
      ],
      backups: [validBackup()]
    }, sourceDir);
    assert.equal(report.status, "FAIL");
    assert.deepEqual(report.mismatched, ["A"]);
  });
});

test("snapshot audit fails when the backup is not verified", () => {
  withSourceDir({ A: "alpha\n" }, (sourceDir) => {
    const backup = validBackup();
    backup.payload_sha256_valid = false;
    const report = auditSnapshot({
      format: "dots-inventory-runtime-source-audit/v1",
      files: [
        { name: "A", type: "SERVER_JS", git_blob_sha1: gitBlobSha1("alpha\n"), size_bytes: 6 }
      ],
      backups: [backup]
    }, sourceDir);
    assert.equal(report.status, "FAIL");
    assert.deepEqual(report.invalid_backups, ["bootstrap.json"]);
  });
});

test("snapshot audit rejects unsupported report formats", () => {
  assert.throws(
    () => auditSnapshot({ format: "unknown", files: [] }, process.cwd()),
    /Unsupported snapshot format/
  );
});


test("runtime source audit probe collects read-only metadata and disables OAuth redirects", () => {
  const vm = require("node:vm");
  const probePath = path.join(__dirname, "../../runtime/probes/DI3_APPS_SCRIPT_SOURCE_AUDIT_PROBE.gs");
  const probeSource = fs.readFileSync(probePath, "utf8");
  const calls = [];
  const projectBody = JSON.stringify({
    scriptId: "script-test",
    files: [
      { name: "appsscript", type: "JSON", source: '{"timeZone":"Europe/Moscow","oauthScopes":["scope.b","scope.a"],"runtimeVersion":"V8"}' },
      { name: "Code", type: "SERVER_JS", source: "function test() {}\\n" }
    ]
  });
  const deploymentBody = JSON.stringify({
    deployments: [{
      deploymentId: "deployment-test",
      deploymentConfig: { versionNumber: 7, manifestFileName: "appsscript", description: "internal" }
    }]
  });
  const sandbox = {
    ScriptApp: {
      getScriptId: () => "script-test",
      getOAuthToken: () => "oauth-test",
      getProjectTriggers: () => [{
        getHandlerFunction: () => "onEditHandler",
        getEventType: () => "ON_EDIT",
        getTriggerSource: () => "SPREADSHEETS"
      }]
    },
    SpreadsheetApp: { getActiveSpreadsheet: () => ({ getId: () => "sheet-test" }) },
    PropertiesService: { getScriptProperties: () => ({
      getKeys: () => ["DI3_BACKUP_FOLDER_ID", "DI3_GITHUB_READ_TOKEN"],
      getProperty: (key) => key === "DI3_BACKUP_FOLDER_ID" ? "folder-test" : null
    }) },
    UrlFetchApp: { fetch: (url, options) => {
      calls.push({ url, options });
      const body = url.includes("/deployments?") ? deploymentBody : projectBody;
      return { getResponseCode: () => 200, getContentText: () => body };
    } },
    DriveApp: { getFilesByName: () => ({ hasNext: () => false }) },
    Utilities: {
      DigestAlgorithm: { SHA_1: "sha1", SHA_256: "sha256" },
      Charset: { UTF_8: "UTF-8" },
      newBlob: (value) => ({ getBytes: () => Array.from(Buffer.from(String(value), "utf8")) }),
      computeDigest: (algorithm, value) => Array.from(
        crypto.createHash(algorithm).update(String(value), "utf8").digest()
      ).map((byte) => byte > 127 ? byte - 256 : byte)
    },
    Logger: { log: () => {} },
    Date, JSON, String, Array, Object, RegExp, Error, Math, Number, encodeURIComponent
  };
  const report = vm.runInNewContext(
    probeSource + "\\ndi3AuditExportRuntimeSourceSnapshot();",
    sandbox
  );
  assert.equal(calls.length, 2);
  for (const call of calls) {
    assert.equal(call.options.followRedirects, false);
    assert.equal(call.options.headers.Authorization, "Bearer oauth-test");
  }
  assert.deepEqual(Array.from(report.manifest.oauth_scopes), ["scope.a", "scope.b"]);
  assert.equal(report.manifest.time_zone, "Europe/Moscow");
  assert.deepEqual(Array.from(report.script_properties.keys), ["DI3_BACKUP_FOLDER_ID", "DI3_GITHUB_READ_TOKEN"]);
  assert.equal(report.triggers.items[0].handler_function, "onEditHandler");
  assert.equal(report.deployments.items[0].version_number, 7);
  assert.equal(report.project_fingerprint_sha256.length, 64);
  assert.equal(JSON.stringify(report).includes("oauth-test"), false);
});


test("snapshot audit rejects a backup with invalid Drive metadata or folder membership", () => {
  withSourceDir({ A: "alpha\\n" }, (sourceDir) => {
    const backup = validBackup();
    backup.backup_folder_membership_matches = false;
    const report = auditSnapshot({
      format: "dots-inventory-runtime-source-audit/v1",
      files: [
        { name: "A", type: "SERVER_JS", git_blob_sha1: gitBlobSha1("alpha\\n"), size_bytes: 6 }
      ],
      backups: [backup]
    }, sourceDir);
    assert.equal(report.status, "FAIL");
    assert.deepEqual(report.invalid_backups, ["bootstrap.json"]);
  });
});
