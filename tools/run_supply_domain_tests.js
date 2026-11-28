const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.resolve(__dirname, "..");
let uuidSequence = 0;
function digestBytes(value) {
  const text = String(value);
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return [hash >>> 24, (hash >>> 16) & 255, (hash >>> 8) & 255, hash & 255];
}
const context = vm.createContext({
  console, Date, JSON, Math, Number, String, Object, Array, RegExp, Error,
  isNaN, parseInt, parseFloat,
  Utilities: {
    getUuid: () => "test-uuid-" + (++uuidSequence),
    computeDigest: (_algorithm, value) => digestBytes(value),
    DigestAlgorithm: { SHA_256: "SHA_256" },
    Charset: { UTF_8: "UTF_8" }
  }
});
const sourceDir = path.join(root, "src/apps_script");
const files = fs.readdirSync(sourceDir)
  .filter((name) => name.endsWith(".gs"))
  .sort()
  .map((name) => path.join(sourceDir, name));
for (const file of files) {
  vm.runInContext(fs.readFileSync(file, "utf8"), context, {
    filename: path.relative(root, file),
    timeout: 5000
  });
}
// The supply financial-plan unit tests do not exercise settings storage; keep
// their currency dependency deterministic and independent of SpreadsheetApp.
context.di3GetBaseCurrency_ = () => "RUB";

const suites = [
  ["catalog_and_supply", "di3RunCatalogAndSupplyUnitTests"],
  ["supply_receiving", "di3RunSupplyReceivingUnitTests"],
  ["historical_supply", "di3RunHistoricalSupplyUnitTests"],
  ["supply_full_edit", "di3RunSupplyFullEditUnitTests"],
  ["supply_correction_source_audit", "di3RunSupplyCorrectionUnitTests"],
  ["supply_correction_relations", "di3RunSupplyCorrectionRelationUnitTests"],
  ["supply_correction_fifo_preview", "di3RunSupplyCorrectionFifoPreviewTests"],
  ["supply_workspace_ux", "di3RunSupplyWorkspaceUxUnitTests"]
];
const results = suites.map(([name, entrypoint]) => {
  const result = vm.runInContext(entrypoint + "()", context, { timeout: 10000 });
  return { name, ...result };
});
const failed = results.reduce((sum, result) => sum + Number(result.failed || 0), 0);
console.log(JSON.stringify({
  status: failed === 0 ? "PASS" : "FAIL",
  loaded_modules: files.length,
  passed: results.reduce((sum, result) => sum + Number(result.passed || 0), 0),
  failed,
  suites: results
}, null, 2));
if (failed) process.exit(1);
