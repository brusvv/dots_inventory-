const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.resolve(__dirname, "..");
const context = vm.createContext({ console, Date, JSON, Math, Number, String, Object, Array, RegExp, Error, isNaN, parseInt, parseFloat });
const files = [
  "src/apps_script/30_DI3_MoneyCore.gs",
  "src/apps_script/11_DI3_SupplyDomain.gs",
  "src/apps_script/36_DI3_SupplyFullEdit.gs",
  "src/apps_script/12_DI3_SupplyReceiving.gs",
  "src/apps_script/34_DI3_HistoricalSupply.gs",
  "src/apps_script/22_DI3_MenuAndFilterUtils.gs",
  "src/apps_script/24_DI3_IncrementalFifo.gs",
  "src/apps_script/39_DI3_SupplyWorkspaceUxTests.gs"
];
for (const file of files) {
  const source = fs.readFileSync(path.join(root, file), "utf8");
  vm.runInContext(source, context, { filename: file, timeout: 5000 });
}
const result = vm.runInContext("di3RunSupplyWorkspaceUxUnitTests()", context, { timeout: 5000 });
console.log(JSON.stringify(result, null, 2));
if (result.failed) process.exit(1);
