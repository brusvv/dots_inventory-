# Apps Script source inventory

The base `.gs` modules came from the supplied `40.rar`. The current working tree also includes three local UX regression modules and explicitly documented source patches UX-01–UX-09; consult the patch logs for modified/added files. Numeric gap `06` is present in the source naming sequence; no module `06_*.gs` was included in this upload. This repository does not infer whether that gap is intentional.

| Module | Role inferred from module name/content |
|---|---|
| `00_DI3_AppConfig.gs` | Central application configuration / timezone |
| `00_DI3_SchemaRegistry.gs` | System table schemas and schema repository helpers |
| `01_DI3_ProductIdentity.gs` | Product identity normalization |
| `02_DI3_ProductsRepository.gs` | Product repository |
| `03_DI3_PackVariants.gs` | Pack variants |
| `04_DI3_Setup.gs` | Setup orchestration |
| `05_DI3_CoreTests.gs` | Core foundation tests |
| `07_DI3_StockCore.gs` | Stock core, FIFO valuation and stock operations |
| `08_DI3_WarehouseManager.gs` | Warehouse management workspace |
| `09_DI3_StockCoreTests.gs` | Stock core tests |
| `10_DI3_ProductCatalog.gs` | Product catalogue and product form |
| `11_DI3_SupplyDomain.gs` | Supply domain and supply form |
| `12_DI3_SupplyReceiving.gs` | Supply stage transitions and receipt |
| `13_DI3_CatalogAndSupplyTests.gs` | Catalog/supply tests |
| `14_DI3_SupplyReceivingTests.gs` | Receiving tests |
| `15_DI3_OrderDomain.gs` | Order domain |
| `16_DI3_OrderWorkflow.gs` | Order creation, dispatch and returns |
| `17_DI3_OrderWorkspace.gs` | Order form / register workspace |
| `18_DI3_OrderTests.gs` | Order tests |
| `19_DI3_WarehouseViews.gs` | Warehouse dashboard, value chart and stock journal |
| `20_DI3_FifoHistoryWorkspace.gs` | FIFO history workspace |
| `21_DI3_ReleaseDiagnostics.gs` | Release diagnostics |
| `22_DI3_MenuAndFilterUtils.gs` | Menus, filters and shared UI helpers |
| `23_DI3_PeriodGuard.gs` | Financial period guard |
| `24_DI3_IncrementalFifo.gs` | Incremental FIFO projections/rebuild |
| `25_DI3_GridSafetyTests.gs` | Grid safety tests |
| `26_DI3_EventDispatcher.gs` | Unified event dispatcher |
| `27_DI3_OperationExecutor.gs` | Operation registry, immutable payload, retry/recovery |
| `28_DI3_InstallationPreflight.gs` | Installation preflight |
| `29_DI3_SettingsRepository.gs` | Settings repository |
| `30_DI3_MoneyCore.gs` | Integer money calculations and rounding |
| `31_DI3_FinanceDashboard.gs` | Finance dashboard |
| `32_DI3_BackupRestore.gs` | Backup and restore |
| `33_DI3_SchemaVersioning.gs` | Schema versioning and migrations |
| `34_DI3_HistoricalSupply.gs` | Historical supply entry and receipt |
| `35_DI3_HistoricalSupplyTests.gs` | Historical supply tests |
| `36_DI3_SupplyFullEdit.gs` | Full supply edit Phase A/B |
| `37_DI3_SupplyFullEditTests.gs` | Full supply edit tests |
| `38_DI3_WarehouseDashboardTests.gs` | Warehouse dashboard chart tests |
| `39_DI3_SupplyWorkspaceUxTests.gs` | UX-01–UX-03 regression tests for Supply Workspace and FIFO menu safety |
| `40_DI3_CatalogOrderUxTests.gs` | UX-04–UX-06 regression tests for Catalog, Order and navigation |
| `41_DI3_SystemSafetyUxTests.gs` | UX-07–UX-09 regression tests for explicit confirmations before batch recovery, money/FIFO migration and period reopening |
