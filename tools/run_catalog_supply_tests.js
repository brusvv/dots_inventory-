const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.resolve(__dirname, "..");
let uuidSequence = 0;
const context = vm.createContext({
  console, Date, JSON, Math, Number, String, Object, Array, RegExp, Error,
  isNaN, parseInt, parseFloat,
  Utilities: { getUuid: () => "test-uuid-" + (++uuidSequence) }
});
const files = [
  "src/apps_script/00_DI3_SchemaRegistry.gs",
  "src/apps_script/01_DI3_ProductIdentity.gs",
  "src/apps_script/02_DI3_ProductsRepository.gs",
  "src/apps_script/03_DI3_PackVariants.gs",
  "src/apps_script/07_DI3_StockCore.gs",
  "src/apps_script/30_DI3_MoneyCore.gs",
  "src/apps_script/11_DI3_SupplyDomain.gs",
  "src/apps_script/13_DI3_CatalogAndSupplyTests.gs"
];
for (const file of files) {
  const source = fs.readFileSync(path.join(root, file), "utf8");
  vm.runInContext(source, context, { filename: file, timeout: 5000 });
}
const result = vm.runInContext("di3RunCatalogAndSupplyUnitTests()", context, { timeout: 5000 });
console.log(JSON.stringify(result, null, 2));
if (result.failed) process.exit(1);
