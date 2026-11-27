#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const sourceDir = path.join(root, "src/apps_script");
const files = fs.readdirSync(sourceDir)
  .filter((name) => name.endsWith(".gs"))
  .sort()
  .map((name) => path.join(sourceDir, name));

// Load the complete Apps Script source set in one shared global context so
// function-source assertions and pure date validation use the real modules.
for (const file of files) {
  vm.runInThisContext(fs.readFileSync(file, "utf8"), {
    filename: path.relative(root, file)
  });
}

if (typeof di3RunHistoricalSupplyUnitTests !== "function") {
  throw new Error("Historical supply test entry point was not loaded.");
}
const result = di3RunHistoricalSupplyUnitTests();
process.stdout.write(JSON.stringify({
  status: result.failed === 0 ? "PASS" : "FAIL",
  loaded_modules: files.length,
  passed: result.passed,
  failed: result.failed,
  failures: result.failures
}, null, 2) + "\n");
if (result.failed !== 0) process.exitCode = 1;
