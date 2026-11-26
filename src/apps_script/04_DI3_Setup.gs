/** First-time setup for a blank Dots Inventory v3 spreadsheet. */
var DI3_APPLICATION_VERSION = "3.0.0-rc.8";

function di3RecordApplicationVersion_() {
  var rows = di3ReadTableValues_("_AppMeta");
  var index = -1;
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i][0]) === "application_version") { index = i; break; }
  }
  var now = new Date();
  if (index >= 0) {
    var sheet = di3GetSheetOrThrow_("_AppMeta");
    sheet.getRange(index + 2, 2, 1, 2).setValues([[DI3_APPLICATION_VERSION, now]]);
    return { key: "application_version", value: DI3_APPLICATION_VERSION, updated: true };
  }
  di3AppendTableRows_("_AppMeta", [["application_version", DI3_APPLICATION_VERSION, now]]);
  return { key: "application_version", value: DI3_APPLICATION_VERSION, updated: false };
}

function di3EnsureSpreadsheetTimeZone_() {
  var ss = di3GetSpreadsheet_();
  var required = di3GetConfiguredTimeZone_();
  var current = typeof ss.getSpreadsheetTimeZone === "function" ? ss.getSpreadsheetTimeZone() : "";
  if (current !== required) {
    if (typeof ss.setSpreadsheetTimeZone !== "function") throw new Error("Не удалось настроить часовой пояс таблицы. Требуется " + required + ".");
    ss.setSpreadsheetTimeZone(required);
  }
  return { time_zone: required, changed: current !== required };
}

/**
 * Install the standalone application into a blank spreadsheet.
 * Creates only v3-owned sheets and user workspaces. No data is imported from another workbook.
 * Safe to rerun: existing documents and system rows are not cleared.
 */
function setupDotsInventoryV3() {
  return di3WithLock_(function () {
    // Preflight must be the first workbook operation: on BLOCKED it leaves the
    // spreadsheet, time zone, properties and triggers untouched.
    var dryRun = di3DryRunInstallation();
    if (dryRun.status !== "READY") {
      throw new Error(dryRun.summary + "\n\n" + dryRun.issues.map(function (issue) { return "• " + issue; }).join("\n"));
    }
    // Preserve a non-empty legacy/partially installed workbook before setup
    // applies any planned schema or workspace changes.
    var setupBackup = null;
    if ((dryRun.planned_changes || []).length && typeof di3WorkbookHasExistingContent_ === "function" && di3WorkbookHasExistingContent_()) {
      setupBackup = di3CreateSpreadsheetBackupInternal_("SETUP_SCHEMA_OR_WORKSPACE_MIGRATION");
    }
    var timeZone = di3EnsureSpreadsheetTimeZone_();
    var created = di3EnsureCoreFoundationSchemas_(true);
    var schemaVersioning = typeof di3EnsureSchemaVersioning_ === "function"
      ? di3EnsureSchemaVersioning_(setupBackup) : { status: "NOT_AVAILABLE" };
    var moneyState = typeof di3EnsureMoneyMinorUnitsState_ === "function" ? di3EnsureMoneyMinorUnitsState_() : { status: "NOT_AVAILABLE" };
    var appVersion = di3RecordApplicationVersion_();
    var settingsRepository = di3EnsureSettingsRepository_();
    var settingsWorkspace = di3SetupSettingsWorkspace();
    var products = di3SetupProductsSheet();
    var productForm = di3SetupProductFormSheet();
    var supply = di3SetupSupplyForm();
    var warehouseManagement = di3SetupWarehouseManagement();
    var dashboard = di3SetupWarehouseDashboard();
    var journal = di3SetupStockJournalSheet();
    var fifoHistory = di3SetupFifoHistorySheet();
    var register = di3SetupSupplyRegisterSheet();
    var orderWorkspace = di3SetupOrderWorkspace();
    var deliveryMethods = orderWorkspace.delivery_methods;
    var financeDashboard = typeof di3SetupFinanceDashboard === "function"
      ? di3SetupFinanceDashboard() : { status: "NOT_AVAILABLE" };
    var fifoBootstrap = typeof di3EnsureIncrementalFifoReady_ === "function"
      ? di3EnsureIncrementalFifoReady_() : { status: "NOT_AVAILABLE" };
    var workbookLayout = di3FinalizeWorkbookLayout_();
    var setupStatus = (fifoBootstrap && fifoBootstrap.status === "PENDING_OPERATIONS") ||
      (moneyState && moneyState.status && moneyState.status !== "READY") ? "READY_WITH_WARNINGS" : "READY";
    return {
      status: setupStatus,
      version: DI3_APPLICATION_VERSION,
      dry_run: dryRun,
      backup: setupBackup,
      time_zone: timeZone,
      created_system_sheets: created,
      schema_versioning: schemaVersioning,
      application_version: appVersion,
      settings_repository: settingsRepository,
      money_fifo: moneyState,
      settings_workspace: settingsWorkspace,
      products: products,
      product_form: productForm,
      supply: supply,
      warehouse_management: warehouseManagement,
      warehouse_dashboard: dashboard,
      stock_journal: journal,
      fifo_history: fifoHistory,
      supply_register: register,
      delivery_methods: deliveryMethods,
      order_workspace: orderWorkspace,
      finance_dashboard: financeDashboard,
      fifo_state: fifoBootstrap,
      workbook_layout: workbookLayout
    };
  });
}

function di3SetupV3CatalogAndWarehouseWorkspaces() {
  return setupDotsInventoryV3();
}


/** Arrange user workspaces first, hide technical tables and remove default blank tabs. */
function di3FinalizeWorkbookLayout_() {
  var ss = di3GetSpreadsheet_();
  var workspaces = [
    { name: "Склад", color: "#1F6B62" },
    { name: "Финансы", color: "#0F766E" },
    { name: "Настройки", color: "#64748B" },
    { name: "Продукты", color: "#3478C8" },
    { name: "Карточка продукта", color: "#60A5FA" },
    { name: "Управление складом", color: "#D69E36" },
    { name: "Поставка v3", color: "#3478C8" },
    { name: "Реестр поставок v3", color: "#64748B" },
    { name: "Калькулятор заказа v3", color: "#3478C8" },
    { name: "Реестр заказов v3", color: "#64748B" },
    { name: "Историческая продажа", color: "#D69E36" },
    { name: "Журнал склада", color: "#0F766E" },
    { name: "История FIFO", color: "#7C3AED" }
  ];

  // Move in forward order: each workspace is placed immediately after those already arranged.
  // This guarantees all twelve user-facing tabs stay together before technical tabs.
  for (var i = 0; i < workspaces.length; i++) {
    var sheet = ss.getSheetByName(workspaces[i].name);
    if (!sheet) throw new Error("Не найден пользовательский лист " + workspaces[i].name + ".");
    ss.setActiveSheet(sheet);
    ss.moveActiveSheet(i + 1);
    if (typeof sheet.setTabColor === "function") sheet.setTabColor(workspaces[i].color);
    if (typeof sheet.setHiddenGridlines === "function") sheet.setHiddenGridlines(true);
  }

  var warehouseHome = ss.getSheetByName("Склад");
  if (warehouseHome && typeof ss.setActiveSheet === "function") ss.setActiveSheet(warehouseHome);

  // System tables are deliberately hidden, but remain available to diagnostics and repositories.
  DI3_CORE_TABLE_NAMES.forEach(function (name) {
    var systemSheet = ss.getSheetByName(name);
    if (systemSheet && typeof systemSheet.hideSheet === "function" && !systemSheet.isSheetHidden()) {
      systemSheet.hideSheet();
    }
  });

  // Remove only an untouched default Google Sheets tab; never delete a user-created sheet with content.
  var defaultBlankSheetRemoved = false;
  ["Sheet1", "Лист1", "Лист 1"].forEach(function (name) {
    var blank = ss.getSheetByName(name);
    if (!blank || blank.getLastRow() !== 0 || blank.getLastColumn() !== 0) return;
    if (blank.getCharts && blank.getCharts().length) return;
    if (ss.getSheets && ss.getSheets().length <= 1) return;
    if (typeof ss.deleteSheet === "function") {
      ss.deleteSheet(blank);
      defaultBlankSheetRemoved = true;
    }
  });

  return {
    workspace_order: workspaces.map(function (item) { return item.name; }),
    hidden_system_sheets: DI3_CORE_TABLE_NAMES.slice(),
    default_blank_sheet_removed: defaultBlankSheetRemoved
  };
}
