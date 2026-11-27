#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

function gitBlobSha1(source) {
  const bytes = Buffer.from(String(source), "utf8");
  const header = Buffer.from("blob " + bytes.length + "\0", "utf8");
  return crypto.createHash("sha1").update(Buffer.concat([header, bytes])).digest("hex");
}

function auditSnapshot(snapshot, sourceDir) {
  if (!snapshot || snapshot.format !== "dots-inventory-runtime-source-audit/v1") {
    throw new Error("Unsupported snapshot format.");
  }
  if (!Array.isArray(snapshot.files)) {
    throw new Error("Snapshot must contain a files array.");
  }

  const expectedNames = fs.readdirSync(sourceDir)
    .filter((name) => name.endsWith(".gs"))
    .map((name) => name.slice(0, -3))
    .sort();

  const actualByName = new Map();
  for (const file of snapshot.files) {
    if (!file || file.type !== "SERVER_JS" || !file.name) continue;
    if (actualByName.has(file.name)) {
      throw new Error("Duplicate installed source file: " + file.name);
    }
    actualByName.set(file.name, file);
  }

  const results = expectedNames.map((name) => {
    const actual = actualByName.get(name);
    const sourcePath = path.join(sourceDir, name + ".gs");
    const source = fs.readFileSync(sourcePath, "utf8");
    const expectedSha = gitBlobSha1(source);
    const expectedSize = Buffer.byteLength(source, "utf8");
    const actualSha = actual ? String(actual.git_blob_sha1 || "") : null;
    const actualSize = actual ? Number(actual.size_bytes) : null;
    return {
      name,
      installed: Boolean(actual),
      expected_sha: expectedSha,
      actual_sha: actualSha,
      expected_size_bytes: expectedSize,
      actual_size_bytes: actualSize,
      match: Boolean(actual) && actualSha === expectedSha && actualSize === expectedSize
    };
  });

  const missing = results.filter((item) => !item.installed).map((item) => item.name);
  const mismatched = results.filter((item) => item.installed && !item.match)
    .map((item) => item.name);
  const extra = [...actualByName.keys()].filter((name) => !expectedNames.includes(name)).sort();

  const backups = Array.isArray(snapshot.backups) ? snapshot.backups : [];
  const backupChecks = backups.map((backup) => ({
    name: backup.name,
    valid: backup.readable === true &&
      backup.payload_sha256_valid === true &&
      backup.file_hashes_valid === true &&
      backup.script_id_matches === true &&
      backup.spreadsheet_id_matches === true
  }));

  return {
    status: missing.length === 0 && mismatched.length === 0 &&
      backupChecks.length > 0 && backupChecks.every((item) => item.valid) ? "PASS" : "FAIL",
    script_id: snapshot.script_id || null,
    spreadsheet_id: snapshot.spreadsheet_id || null,
    expected_modules: expectedNames.length,
    matched: results.filter((item) => item.match).length,
    missing,
    mismatched,
    extra_ignored: extra,
    backup_count: backups.length,
    invalid_backups: backupChecks.filter((item) => !item.valid).map((item) => item.name),
    results
  };
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--snapshot") args.snapshot = argv[++i];
    else if (argv[i] === "--source-dir") args.sourceDir = argv[++i];
    else if (argv[i] === "--help") args.help = true;
    else throw new Error("Unknown argument: " + argv[i]);
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.snapshot) {
    process.stdout.write(
      "Usage: node tools/audit_apps_script_snapshot.js --snapshot <runtime-snapshot.json> [--source-dir src/apps_script]\n"
    );
    process.exitCode = args.help ? 0 : 2;
    return;
  }
  const snapshot = JSON.parse(fs.readFileSync(args.snapshot, "utf8"));
  const sourceDir = path.resolve(args.sourceDir || "src/apps_script");
  const report = auditSnapshot(snapshot, sourceDir);
  process.stdout.write(JSON.stringify(report, null, 2) + "\n");
  if (report.status !== "PASS") process.exitCode = 1;
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    process.stderr.write(String(error.stack || error) + "\n");
    process.exitCode = 1;
  }
}

module.exports = { gitBlobSha1, auditSnapshot };
