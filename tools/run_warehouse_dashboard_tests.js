#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const files = [
  path.join(root, 'src/apps_script/19_DI3_WarehouseViews.gs'),
  path.join(root, 'src/apps_script/38_DI3_WarehouseDashboardTests.gs')
];
for (const file of files) {
  vm.runInThisContext(fs.readFileSync(file, 'utf8'), { filename: path.relative(root, file) });
}
const result = di3RunWarehouseDashboardUnitTests();
process.stdout.write(JSON.stringify(result, null, 2) + '\n');
if (result.status !== 'PASS' || result.failed !== 0) process.exitCode = 1;
