/** Dots Inventory v3 — one installable edit trigger with sheet-based routing. */
var DI3_MANAGED_EDIT_TRIGGER_HANDLERS = Object.freeze([
  "di3UnifiedOnEdit",
  "di3WarehouseManagerOnEdit",
  "di3ProductCatalogOnEdit",
  "di3SupplyFormOnEdit",
  "di3WarehouseViewsOnEdit"
]);

/**
 * Single entry point for all installable edit events.
 * Specialized handlers remain small and are invoked only for their own workspace.
 */
function di3UnifiedOnEdit(e) {
  if (!e || !e.range || !e.range.getSheet) return;
  var sheetName = e.range.getSheet().getName();

  if (sheetName === DI3_SETTINGS_WORKSPACE_SHEET) {
    return di3SettingsOnEdit(e);
  }
  if (sheetName === DI3_FINANCE_DASHBOARD_SHEET) {
    var editedRange = e.range;
    var firstRow = editedRange.getRow();
    var lastRow = firstRow + editedRange.getNumRows() - 1;
    var firstColumn = editedRange.getColumn();
    var lastColumn = firstColumn + editedRange.getNumColumns() - 1;
    if (firstRow <= 3 && lastRow >= 3 &&
        ((firstColumn <= 2 && lastColumn >= 2) || (firstColumn <= 4 && lastColumn >= 4) || (firstColumn <= 6 && lastColumn >= 6))) {
      return di3RefreshFinanceDashboard();
    }
    return;
  }
  if (sheetName === DI3_WAREHOUSE_MANAGER_SHEET) {
    return di3WarehouseManagerOnEdit(e);
  }
  if (sheetName === DI3_PRODUCT_FORM_SHEET) {
    return di3ProductCatalogOnEdit(e);
  }
  if (sheetName === DI3_SUPPLY_FORM_SHEET) {
    return di3SupplyFormOnEdit(e);
  }
  if (sheetName === DI3_WAREHOUSE_DASHBOARD_SHEET ||
      sheetName === DI3_STOCK_JOURNAL_SHEET ||
      sheetName === DI3_FIFO_HISTORY_SHEET) {
    return di3WarehouseViewsOnEdit(e);
  }
  return;
}

/**
 * Installs exactly one managed onEdit trigger and removes legacy per-workspace triggers.
 * Safe to call repeatedly from any workspace setup function.
 */
function di3InstallUnifiedEditTrigger_() {
  if (typeof ScriptApp === "undefined") return false;

  var triggers = ScriptApp.getProjectTriggers();
  var keeper = null;
  var stale = [];
  triggers.forEach(function (trigger) {
    var handler = trigger.getHandlerFunction();
    if (handler === "di3UnifiedOnEdit" && !keeper) {
      keeper = trigger;
      return;
    }
    if (DI3_MANAGED_EDIT_TRIGGER_HANDLERS.indexOf(handler) !== -1) stale.push(trigger);
  });
  // Delete after enumeration; deleting while iterating a live trigger array can skip entries in mocks.
  stale.forEach(function (trigger) { ScriptApp.deleteTrigger(trigger); });

  if (!keeper) {
    ScriptApp.newTrigger("di3UnifiedOnEdit")
      .forSpreadsheet(di3GetSpreadsheet_())
      .onEdit()
      .create();
  }
  return true;
}
