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
    spreadsheet_id_matches: true
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
