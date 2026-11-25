# Apps Script source inventory

The base `.gs` modules came from the supplied `40.rar`. The current working tree contains 43 Apps Script modules (39 base modules + UX regression modules 39–41 + Finance schema test module 42), 7 runtime probes and source patches UX-01–UX-10, commission payer/schema v3, F-01 and static hardening F-03/F-04/F-05/F-09/F-11/F-13/F-15/F-16/F-18. Consult the patch logs for exact scopes and runtime limitations. Numeric gap `06` is present in the source naming sequence; no module `06_*.gs` was included in this upload. This repository does not infer whether that gap is intentional.

| Module | Role inferred from module name/content |
|---|---|
| `00_DI3_AppConfig.gs` | Central application configuration / timezone |
| `00_DI3_SchemaRegistry.gs` | System table schemas and schema repository helpers; `V3_Orders` now includes `commission_payer` |
| `01_DI3_ProductIdentity.gs` | Product identity normalization |
| `02_DI3_ProductsRepository.gs` | Product repository |
| `03_DI3_PackVariants.gs` | Pack variants |
| `04_DI3_Setup.gs` | Setup orchestration |
| `05_DI3_CoreTests.gs` | Core foundation tests |
| `07_DI3_StockCore.gs` | Stock core, FIFO valuation and stock operations; warehouse totals include average known FIFO unit cost |
| `08_DI3_WarehouseManager.gs` | Warehouse management workspace; explicit YES/NO before manual IN/OUT posting |
| `09_DI3_StockCoreTests.gs` | Stock core tests |
| `10_DI3_ProductCatalog.gs` | Product catalogue and product form |
| `11_DI3_SupplyDomain.gs` | Supply domain and supply form |
| `12_DI3_SupplyReceiving.gs` | Supply stage transitions and receipt |
| `13_DI3_CatalogAndSupplyTests.gs` | Catalog/supply tests |
| `14_DI3_SupplyReceivingTests.gs` | Receiving tests |
| `15_DI3_OrderDomain.gs` | Order domain, buyer/seller commission payer split, percent input normalization and additive V3_Orders schema migration |
| `16_DI3_OrderWorkflow.gs` | Order creation, dispatch and returns; return FIFO allocations are resolved by original dispatch movement ID rather than latest global FIFO run; settlement applies commission payer to seller revenue and buyer payment |
| `17_DI3_OrderWorkspace.gs` | Order form / register workspace; B3 selects who pays platform commission |
| `18_DI3_OrderTests.gs` | Order-domain calculation, transition and F-01 return/FIFO regression tests |
| `19_DI3_WarehouseViews.gs` | Warehouse dashboard, value chart and stock journal; chart diagnostics, height-aware grid retention, independent view refresh and pending-operation journal warning |
| `20_DI3_FifoHistoryWorkspace.gs` | FIFO history workspace |
| `21_DI3_ReleaseDiagnostics.gs` | Release diagnostics |
| `22_DI3_MenuAndFilterUtils.gs` | Menus, filters and shared UI helpers |
| `23_DI3_PeriodGuard.gs` | Financial period guard |
| `24_DI3_IncrementalFifo.gs` | Incremental FIFO projections/rebuild |
| `25_DI3_GridSafetyTests.gs` | Grid safety tests |
| `26_DI3_EventDispatcher.gs` | Unified event dispatcher |
| `27_DI3_OperationExecutor.gs` | Operation registry, immutable payload, retry/recovery; 45,000-character fail-closed payload-size guard |
| `28_DI3_InstallationPreflight.gs` | Installation preflight, including V3_Orders v2→v3 migration validation |
| `29_DI3_SettingsRepository.gs` | Settings repository |
| `30_DI3_MoneyCore.gs` | Integer money calculations and rounding |
| `31_DI3_FinanceDashboard.gs` | Finance dashboard; commission payer changes buyer-paid and seller-revenue metrics; table columns are resolved by schema field names |
| `32_DI3_BackupRestore.gs` | Backup and restore; flushes pending spreadsheet writes before backup snapshot/copy |
| `33_DI3_SchemaVersioning.gs` | Schema versioning and migrations (schema v3; RC8_ORDER_COMMISSION_PAYER_V3) |
| `34_DI3_HistoricalSupply.gs` | Historical supply entry and receipt; confirmation dialogs run outside global lock, then state/form fingerprint is revalidated under lock before writes |
| `35_DI3_HistoricalSupplyTests.gs` | Historical supply tests |
| `36_DI3_SupplyFullEdit.gs` | Full supply edit Phase A/B |
| `37_DI3_SupplyFullEditTests.gs` | Full supply edit tests |
| `38_DI3_WarehouseDashboardTests.gs` | Warehouse dashboard chart and average-known-cost tests |
| `39_DI3_SupplyWorkspaceUxTests.gs` | UX-01–UX-03 regression tests for Supply Workspace and FIFO menu safety |
| `40_DI3_CatalogOrderUxTests.gs` | UX-04–UX-06 regression tests for Catalog, Order and navigation |
| `41_DI3_SystemSafetyUxTests.gs` | UX-07–UX-10 regression tests for confirmations before batch recovery, Money/FIFO migration, period reopening and manual warehouse movement; extended for payload guard and backup flush checks |
| `42_DI3_FinanceSchemaTests.gs` | Four local tests for Finance Dashboard schema-name column mapping and the removal of hard-coded source-table indexes |

Additional local tools: `tools/run_finance_schema_tests.js` runs the Finance schema suite. `tools/run_order_domain_tests.js`, `tools/run_supply_workspace_ux_tests.js`, `tools/run_system_safety_ux_tests.js`, `tools/run_catalog_order_ux_tests.js` and `tools/run_warehouse_dashboard_tests.js` are source-only regression runners.
