const fs = require("fs");
const path = require("path");
const vm = require("vm");
const root = path.resolve(__dirname, "..");
const context = vm.createContext({ console, Date, JSON, Math, Number, String, Object, Array, RegExp, Error, isNaN, parseInt, parseFloat });
const files = [
  "src/apps_script/00_DI3_AppConfig.gs",
  "src/apps_script/00_DI3_SchemaRegistry.gs",
  "src/apps_script/07_DI3_StockCore.gs",
  "src/apps_script/24_DI3_IncrementalFifo.gs",
  "src/apps_script/08_DI3_WarehouseManager.gs",
  "src/apps_script/11_DI3_SupplyDomain.gs",
  "src/apps_script/12_DI3_SupplyReceiving.gs",
  "src/apps_script/15_DI3_OrderDomain.gs",
  "src/apps_script/16_DI3_OrderWorkflow.gs",
  "src/apps_script/17_DI3_OrderWorkspace.gs",
  "src/apps_script/22_DI3_MenuAndFilterUtils.gs",
  "src/apps_script/23_DI3_PeriodGuard.gs",
  "src/apps_script/27_DI3_OperationExecutor.gs",
  "src/apps_script/33_DI3_SchemaVersioning.gs",
  "src/apps_script/36_DI3_SupplyFullEdit.gs",
  "src/apps_script/29_DI3_SettingsRepository.gs",
  "src/apps_script/30_DI3_MoneyCore.gs",
  "src/apps_script/32_DI3_BackupRestore.gs",
  "src/apps_script/41_DI3_SystemSafetyUxTests.gs"
];
for (const file of files) {
  const source = fs.readFileSync(path.join(root, file), "utf8");
  vm.runInContext(source, context, { filename: file, timeout: 5000 });
}
const result = vm.runInContext("di3RunSystemSafetyUxUnitTests()", context, { timeout: 5000 });
console.log(JSON.stringify(result, null, 2));
if (result.failed) process.exit(1);
