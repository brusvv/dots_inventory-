const fs = require("fs");
const path = require("path");
const vm = require("vm");
const root = path.resolve(__dirname, "..");
const context = vm.createContext({ console, Date, JSON, Math, Number, String, Object, Array, RegExp, Error, isNaN, parseInt, parseFloat });
const files = [
  "src/apps_script/10_DI3_ProductCatalog.gs",
  "src/apps_script/15_DI3_OrderDomain.gs",
  "src/apps_script/17_DI3_OrderWorkspace.gs",
  "src/apps_script/22_DI3_MenuAndFilterUtils.gs",
  "src/apps_script/40_DI3_CatalogOrderUxTests.gs"
];
for (const file of files) {
  const source = fs.readFileSync(path.join(root, file), "utf8");
  vm.runInContext(source, context, { filename: file, timeout: 5000 });
}
const result = vm.runInContext("di3RunCatalogOrderUxUnitTests()", context, { timeout: 5000 });
console.log(JSON.stringify(result, null, 2));
if (result.failed) process.exit(1);
