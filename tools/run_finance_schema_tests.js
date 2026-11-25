const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.resolve(__dirname, "..");
const context = vm.createContext({ console, Date, JSON, Math, Number, String, Object, Array, RegExp, Error, isNaN, parseInt, parseFloat });
for (const file of [
  "src/apps_script/00_DI3_SchemaRegistry.gs",
  "src/apps_script/31_DI3_FinanceDashboard.gs",
  "src/apps_script/42_DI3_FinanceSchemaTests.gs"
]) {
  const source = fs.readFileSync(path.join(root, file), "utf8");
  vm.runInContext(source, context, { filename: file, timeout: 5000 });
}
const result = vm.runInContext("di3RunFinanceSchemaUnitTests()", context, { timeout: 5000 });
console.log(JSON.stringify(result, null, 2));
if (result.failed) process.exit(1);
