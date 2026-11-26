/** Dots Inventory v3 schema registry. Standalone application schema; no external data import is included. */
// Execution-local nesting counter: Apps Script executions do not share this state.
// Nested services reuse the outer ScriptLock instead of attempting to acquire it again.
var DI3_SCRIPT_LOCK_DEPTH_ = 0;
var DI3_TABLE_SCHEMAS = Object.freeze({
  Products: [
    "product_id", "identity_key", "brand", "model", "diameter",
    "category", "shape", "material", "thickness", "foam",
    "current_sale_price", "active", "created_at", "updated_at", "last_seen_at"
  ],
  PackVariants: [
    "pack_variant_id", "product_id", "units_per_pack", "variant_label",
    "is_current", "active", "source", "created_at", "updated_at"
  ],
  ProductCostHistory: [
    "cost_history_id", "product_id", "pack_variant_id", "cost_per_pack",
    "unit_cost", "currency", "source_type", "source_key",
    "effective_at", "recorded_at", "note"
  ],
  StockLedger: [
    "movement_id", "operation_id", "event_key", "product_id",
    "document_type", "document_id", "quantity_delta", "effective_at",
    "recorded_at", "unit_cost_before", "unit_cost_after", "comment", "ledger_sequence"
  ],
  Operations: [
    "operation_id", "idempotency_key", "operation_type", "document_type",
    "document_id", "status", "payload_hash", "started_at",
    "committed_at", "error", "actor"
  ],
  OperationAttempts: [
    "attempt_id", "operation_id", "attempt_number", "operation_type",
    "status_before", "execution_mode", "started_at", "finished_at",
    "result_status", "error_class", "error_message", "actor"
  ],
  DocumentStatusHistory: [
    "history_id", "document_type", "document_id", "old_status",
    "new_status", "changed_at", "actor", "operation_id", "comment"
  ],
  _AppMeta: ["key", "value", "updated_at"],
  SchemaMigrations: ["migration_id", "migration_key", "from_schema_version", "to_schema_version", "status", "started_at", "completed_at", "backup_file_id", "details", "error", "actor"],
  Settings: ["setting_key", "setting_value", "value_type", "is_editable", "description", "updated_at", "updated_by"],
  StockMovementDetails: [
    "movement_id", "display_code", "movement_type", "reason_code",
    "unit_sale_price", "revenue_amount", "cost_status", "reversal_of_movement_id",
    "actor", "note", "source_module"
  ],
  StockLots: [
    "lot_id", "product_id", "source_movement_id", "source_type", "source_id",
    "pack_variant_id", "effective_at", "recorded_at", "initial_quantity",
    "unit_cost", "cost_status", "currency", "note", "remaining_quantity", "total_cost_minor"
  ],
  StockAllocations: [
    "allocation_id", "allocation_run_id", "movement_id", "lot_id", "product_id",
    "allocation_type", "quantity", "unit_cost", "cost_status", "allocated_cost",
    "effective_at", "recorded_at", "reverses_allocation_id", "allocated_cost_minor"
  ],
  FifoAllocationRuns: [
    "run_id", "run_sequence", "status", "reason", "created_at", "committed_at",
    "ledger_rows_count", "allocation_rows_count", "products_count", "error",
    "operation_id", "replay_id", "scope_type", "scope_json", "input_fingerprint"
  ],
  FifoAllocationArchive: [
    "archive_row_id", "replay_id", "archived_at", "archive_reason",
    "source_allocation_id", "source_allocation_run_id", "movement_id", "lot_id",
    "product_id", "allocation_type", "quantity", "unit_cost", "cost_status",
    "allocated_cost", "effective_at", "recorded_at", "reverses_allocation_id",
    "allocated_cost_minor"
  ],
  FifoLotCacheArchive: [
    "archive_row_id", "replay_id", "lot_id", "product_id",
    "previous_remaining_quantity", "archived_at"
  ],
  FifoReplayEvents: [
    "replay_event_id", "replay_id", "event_sequence", "event_type",
    "fifo_run_id", "operation_id", "scope_type", "scope_json", "input_fingerprint",
    "source_allocations_fingerprint", "target_allocations_fingerprint",
    "source_lot_cache_fingerprint", "target_lot_cache_fingerprint",
    "created_at", "details_json"
  ],
  FifoProductState: [
    "product_id", "last_effective_at", "last_recorded_at", "last_movement_id",
    "last_processed_ledger_sequence", "movement_count", "remaining_quantity", "updated_at"
  ],
  OperationPayloads: [
    "operation_id", "payload_json", "created_at"
  ],
  ProductPublicCodes: [
    "product_id", "display_code", "created_at"
  ],
  V3_Supplies: [
    "supply_id", "supply_number", "supplier", "status", "created_at",
    "sent_at", "awaiting_at", "received_at", "goods_amount",
    "seller_discount_amount", "partner_discount_amount", "discount_total",
    "shipping_amount", "final_amount", "notes", "currency", "updated_at",
    "supplier_order_date", "expected_received_date"
  ],
  V3_SupplyItems: [
    "supply_item_id", "supply_id", "line_no", "product_id", "product_label_snapshot",
    "pack_variant_id", "units_per_pack", "packs", "purchase_price_per_pack",
    "base_line_amount", "allocated_seller_discount", "allocated_partner_discount",
    "allocated_shipping", "final_pack_cost", "received_units", "final_line_amount",
    "unit_cost", "created_at", "updated_at"
  ],
  V3_Orders: [
    "order_id", "order_number", "created_at", "status", "goods_amount",
    "commission_rate", "commission_amount", "discount_rate", "discount_amount",
    "payable_total", "estimated_fifo_cost_total", "estimated_fifo_cost_status",
    "actual_fifo_cost_total", "actual_fifo_cost_status", "profit_total", "notes",
    "delivery_method", "dispatched_at", "completed_at", "returning_at",
    "returned_at", "cancelled_at", "updated_at", "seller_revenue",
    "platform_commission_realized", "buyer_paid_total", "settlement_status",
    "settlement_finalized_at", "commission_payer", "business_date"
  ],
  V3_OrderItems: [
    "order_item_id", "order_id", "line_no", "product_id", "product_label_snapshot",
    "quantity", "sale_unit_price", "line_revenue", "estimated_unit_cost",
    "estimated_line_cost", "estimated_cost_status", "dispatch_movement_id",
    "actual_fifo_cost", "actual_fifo_cost_status", "created_at", "updated_at"
  ],
  V3_DeliveryMethods: [
    "method_id", "method_name", "active", "sort_order", "created_at", "updated_at"
  ],
  PeriodLocks: [
    "period_key", "period_start", "period_end", "status", "locked_at", "locked_by",
    "reopened_at", "reopened_by", "reopen_reason", "note"
  ],
  OrderCostSnapshots: [
    "snapshot_id", "order_id", "order_item_id", "calculation_version", "fifo_run_id",
    "cost_amount_minor", "cost_status", "quantity", "captured_at", "reason",
    "previous_snapshot_id", "delta_amount_minor"
  ]
});

var DI3_CORE_TABLE_NAMES = Object.freeze(Object.keys(DI3_TABLE_SCHEMAS));
// Small intentional input area for user-maintained reference values (not a large blank grid).
var DI3_TABLE_MIN_ROWS = Object.freeze({ V3_DeliveryMethods: 11, Settings: 5, OperationAttempts: 2, SchemaMigrations: 2 });

function di3GetSpreadsheet_() {
  return SpreadsheetApp.getActiveSpreadsheet();
}

function di3GetSheetOrThrow_(sheetName) {
  var sheet = di3GetSpreadsheet_().getSheetByName(sheetName);
  if (!sheet) throw new Error('Не найден системный лист "' + sheetName + '".');
  return sheet;
}

function di3NormalizeHeader_(value) {
  return String(value == null ? "" : value).trim().replace(/\s+/g, " ");
}

/** Validate all existing target sheets without creating or changing anything. */
function di3ValidateExistingCoreSchemas_() {
  var ss = di3GetSpreadsheet_();
  var issues = [];
  DI3_CORE_TABLE_NAMES.forEach(function (name) {
    var sheet = ss.getSheetByName(name);
    if (!sheet) return;
    var expected = DI3_TABLE_SCHEMAS[name];
    var lastColumn = sheet.getLastColumn();
    var readableWidth = Math.min(expected.length, sheet.getMaxColumns());
    var actual = (readableWidth ? sheet.getRange(1, 1, 1, readableWidth).getDisplayValues()[0] : [])
      .map(di3NormalizeHeader_);
    while (actual.length < expected.length) actual.push("");
    var blank = actual.every(function (value) { return value === ""; });
    if (blank) {
      if (sheet.getLastRow() > 1) {
        issues.push(name + ': заголовки пустые, но ниже есть данные.');
      }
      return;
    }
    var compatibleLegacy = false;
    if (name === "V3_Orders") {
      var legacyOrder23 = expected.slice(0, 23).every(function (header, index) { return actual[index] === header; }) &&
        actual.slice(23).every(function (value) { return value === ""; });
      var settlementOrder28 = expected.slice(0, 28).every(function (header, index) { return actual[index] === header; }) &&
        actual[28] === "" && actual[29] === "";
      var commissionPayerOrder29 = expected.slice(0, 29).every(function (header, index) { return actual[index] === header; }) &&
        actual[29] === "";
      compatibleLegacy = legacyOrder23 || settlementOrder28 || commissionPayerOrder29;
    } else if (name === "V3_Supplies") {
      var supplies17 = expected.slice(0, 17).every(function (header, index) { return actual[index] === header; });
      var planningTail = actual.slice(17, 19);
      compatibleLegacy = supplies17 && (planningTail.every(function (value) { return value === ""; }) ||
        (planningTail[0] === "supplier_order_date" && planningTail[1] === ""));
    } else if (name === "StockLots") {
      var lots13 = expected.slice(0, 13).every(function (header, index) { return actual[index] === header; });
      var lots14 = expected.slice(0, 14).every(function (header, index) { return actual[index] === header; });
      compatibleLegacy = lots13 || lots14;
    } else if (name === "StockAllocations") {
      compatibleLegacy = expected.slice(0, 13).every(function (header, index) { return actual[index] === header; });
    }
    if (!compatibleLegacy) {
      for (var i = 0; i < expected.length; i++) {
        if (actual[i] !== expected[i]) {
          issues.push(name + '! колонка ' + (i + 1) + ': ожидался заголовок "' +
            expected[i] + '", найден "' + actual[i] + '".');
          break;
        }
      }
    }
    if (lastColumn > expected.length) {
      var extra = sheet.getRange(1, expected.length + 1, 1, lastColumn - expected.length)
        .getDisplayValues()[0];
      if (extra.some(function (value) { return di3NormalizeHeader_(value) !== ""; })) {
        issues.push(name + ': обнаружены дополнительные заголовки справа от ожидаемой схемы.');
      }
    }
  });
  return issues;
}


/** Ensure a sheet has just enough grid to hold the requested working area. */
function di3EnsureSheetCapacity_(sheet, requiredRows, requiredColumns) {
  requiredRows = Math.max(1, Number(requiredRows) || 1);
  requiredColumns = Math.max(1, Number(requiredColumns) || 1);
  var maxRows = sheet.getMaxRows();
  var maxColumns = sheet.getMaxColumns();
  if (maxRows < requiredRows) sheet.insertRowsAfter(maxRows, requiredRows - maxRows);
  if (maxColumns < requiredColumns) sheet.insertColumnsAfter(maxColumns, requiredColumns - maxColumns);
  return { rows: Math.max(maxRows, requiredRows), columns: Math.max(maxColumns, requiredColumns) };
}

/** Safely freeze rows while leaving at least one non-frozen row. */
function di3SetFrozenRowsSafely_(sheet, requestedRows) {
  if (!sheet) throw new Error("di3SetFrozenRowsSafely_: лист не задан.");
  requestedRows = Math.max(0, Math.floor(Number(requestedRows) || 0));
  if (requestedRows === 0) {
    sheet.setFrozenRows(0);
    return { frozen_rows: 0, max_rows: sheet.getMaxRows() };
  }
  var requiredRows = requestedRows + 1;
  var maxRows = sheet.getMaxRows();
  if (maxRows < requiredRows) sheet.insertRowsAfter(maxRows, requiredRows - maxRows);
  sheet.setFrozenRows(requestedRows);
  if (sheet.getFrozenRows() !== requestedRows || sheet.getMaxRows() <= requestedRows) {
    throw new Error("Не удалось безопасно закрепить строки на листе «" + sheet.getName() + "».");
  }
  return { frozen_rows: requestedRows, max_rows: sheet.getMaxRows() };
}

/** Safely freeze columns while leaving at least one non-frozen column. */
function di3SetFrozenColumnsSafely_(sheet, requestedColumns) {
  if (!sheet) throw new Error("di3SetFrozenColumnsSafely_: лист не задан.");
  requestedColumns = Math.max(0, Math.floor(Number(requestedColumns) || 0));
  if (requestedColumns === 0) {
    sheet.setFrozenColumns(0);
    return { frozen_columns: 0, max_columns: sheet.getMaxColumns() };
  }
  var requiredColumns = requestedColumns + 1;
  var maxColumns = sheet.getMaxColumns();
  if (maxColumns < requiredColumns) sheet.insertColumnsAfter(maxColumns, requiredColumns - maxColumns);
  sheet.setFrozenColumns(requestedColumns);
  if (sheet.getFrozenColumns() !== requestedColumns || sheet.getMaxColumns() <= requestedColumns) {
    throw new Error("Не удалось безопасно закрепить столбцы на листе «" + sheet.getName() + "».");
  }
  return { frozen_columns: requestedColumns, max_columns: sheet.getMaxColumns() };
}

/**
 * Trim unused grid while preserving every populated row and column.
 * Apps Script Sheet has deleteRows/deleteColumns; it does NOT have setMaxRows/setMaxColumns.
 * Only v3-owned sheets call this helper. Content outside the used boundary is never deleted.
 */
function di3CompactSheet_(sheet, minimumRows, minimumColumns) {
  if (!sheet) throw new Error("di3CompactSheet_: лист не задан.");
  minimumRows = Math.max(1, Math.floor(Number(minimumRows) || 1));
  minimumColumns = Math.max(1, Math.floor(Number(minimumColumns) || 1));

  // A frozen pane must never consume the complete physical grid. Keep at least
  // one scrollable row and column when trimming compact sheets.
  var frozenRows = Math.max(0, sheet.getFrozenRows ? (sheet.getFrozenRows() || 0) : 0);
  var frozenColumns = Math.max(0, sheet.getFrozenColumns ? (sheet.getFrozenColumns() || 0) : 0);
  var usedRows = Math.max(minimumRows, sheet.getLastRow() || 0, frozenRows + 1);
  var usedColumns = Math.max(minimumColumns, sheet.getLastColumn() || 0, frozenColumns + 1);
  // Preserve any populated cells beyond the nominal schema/working area before trimming.
  di3EnsureSheetCapacity_(sheet, usedRows, usedColumns);
  var maxRows = sheet.getMaxRows();
  var maxColumns = sheet.getMaxColumns();

  if (maxRows > usedRows) {
    if (typeof sheet.deleteRows !== "function") {
      throw new Error("Google Sheets API не предоставляет deleteRows() для листа «" + sheet.getName() + "».");
    }
    sheet.deleteRows(usedRows + 1, maxRows - usedRows);
  }
  if (maxColumns > usedColumns) {
    if (typeof sheet.deleteColumns !== "function") {
      throw new Error("Google Sheets API не предоставляет deleteColumns() для листа «" + sheet.getName() + "».");
    }
    sheet.deleteColumns(usedColumns + 1, maxColumns - usedColumns);
  }

  var finalRows = sheet.getMaxRows();
  var finalColumns = sheet.getMaxColumns();
  if (finalRows < usedRows || finalColumns < usedColumns) {
    throw new Error("Не удалось корректно уплотнить лист «" + sheet.getName() + "»: ожидалось " +
      usedRows + "×" + usedColumns + ", получено " + finalRows + "×" + finalColumns + ".");
  }
  return {
    rows: finalRows,
    columns: finalColumns,
    used_rows: usedRows,
    used_columns: usedColumns,
    deleted_rows: maxRows - finalRows,
    deleted_columns: maxColumns - finalColumns
  };
}

/** Create a compact sheet without Google's default 1,000 × 26 empty grid. */
function di3PrepareNewSheet_(sheet, minimumRows, minimumColumns) {
  if (!sheet) throw new Error("di3PrepareNewSheet_: лист не задан.");
  minimumRows = Math.max(1, Math.floor(Number(minimumRows) || 1));
  minimumColumns = Math.max(1, Math.floor(Number(minimumColumns) || 1));
  di3EnsureSheetCapacity_(sheet, minimumRows, minimumColumns);
  di3CompactSheet_(sheet, minimumRows, minimumColumns);
  return sheet;
}

function di3DocumentProperties_() {
  var properties = PropertiesService.getDocumentProperties();
  if (!properties) throw new Error("DocumentProperties недоступны. Убедись, что Apps Script привязан к Google-таблице.");
  return properties;
}

function di3GetFormRequestToken_(formKey) {
  var key = "DI3_FORM_REQUEST_TOKEN_" + String(formKey || "").toUpperCase();
  var properties = di3DocumentProperties_();
  var token = properties.getProperty(key);
  if (!token) {
    token = di3MakeUuid_();
    properties.setProperty(key, token);
  }
  return token;
}

function di3RotateFormRequestToken_(formKey) {
  var key = "DI3_FORM_REQUEST_TOKEN_" + String(formKey || "").toUpperCase();
  var token = di3MakeUuid_();
  di3DocumentProperties_().setProperty(key, token);
  return token;
}

/** Move an old hidden-cell anti-duplicate token into DocumentProperties, then clear the cell. */
function di3AdoptLegacyFormRequestToken_(formKey, sheet, legacyCellA1) {
  var key = "DI3_FORM_REQUEST_TOKEN_" + String(formKey || "").toUpperCase();
  var properties = di3DocumentProperties_();
  var stored = properties.getProperty(key);
  var legacy = String(sheet.getRange(legacyCellA1).getValue() || "").trim();
  if (!stored && legacy) properties.setProperty(key, legacy);
  sheet.getRange(legacyCellA1).clearContent();
  return di3GetFormRequestToken_(formKey);
}

/** Add remaining_quantity to the known 13-column StockLots predecessor without moving existing columns. */
function di3UpgradeStockLotsSchema_() {
  var ss = di3GetSpreadsheet_();
  var sheet = ss.getSheetByName("StockLots");
  if (!sheet || sheet.getLastRow() === 0) return { upgraded: false, reason: "SHEET_NOT_CREATED_OR_EMPTY" };
  var oldWidth = 13;
  var oldHeaders = DI3_TABLE_SCHEMAS.StockLots.slice(0, oldWidth);
  var actualPrefix = sheet.getRange(1, 1, 1, oldWidth).getDisplayValues()[0].map(di3NormalizeHeader_);
  if (!oldHeaders.every(function (header, index) { return actualPrefix[index] === header; })) {
    var currentRemaining = sheet.getMaxColumns() >= 14 ? di3NormalizeHeader_(sheet.getRange(1, 14).getDisplayValue()) : "";
    if (currentRemaining === "remaining_quantity") return { upgraded: false, reason: "ALREADY_CURRENT" };
    throw new Error("StockLots: несовместимая схема. Обновление remaining_quantity остановлено без изменений.");
  }
  if (sheet.getMaxColumns() < 14) sheet.insertColumnsAfter(sheet.getMaxColumns(), 14 - sheet.getMaxColumns());
  var lastHeader = di3NormalizeHeader_(sheet.getRange(1, 14).getDisplayValue());
  if (lastHeader && lastHeader !== "remaining_quantity") {
    throw new Error("StockLots: колонка N занята заголовком «" + lastHeader + "». Автоматическое обновление остановлено.");
  }
  if (!lastHeader) {
    if (di3PreflightHasBodyValues_(sheet, 14, 1)) {
      throw new Error("StockLots: колонка remaining_quantity содержит данные при пустом заголовке. Обновление остановлено без перезаписи.");
    }
    sheet.getRange(1, 14).setValue("remaining_quantity");
    sheet.getRange(1, 14).setFontWeight("bold");
  }
  return { upgraded: !lastHeader, added_column: "remaining_quantity" };
}

/** Add planning dates to the known 18-column Supplies schema without moving existing data. */
function di3UpgradeSupplyPlanningDatesSchema_() {
  var sheet = di3GetSpreadsheet_().getSheetByName("V3_Supplies");
  if (!sheet || sheet.getLastRow() === 0) return { upgraded: false, reason: "SHEET_NOT_CREATED_OR_EMPTY" };
  var oldHeaders = DI3_TABLE_SCHEMAS.V3_Supplies.slice(0, 17);
  var expectedTail = ["supplier_order_date", "expected_received_date"];
  var readableWidth = Math.min(19, sheet.getMaxColumns());
  var actual = sheet.getRange(1, 1, 1, Math.max(17, readableWidth)).getDisplayValues()[0].map(di3NormalizeHeader_);
  while (actual.length < 19) actual.push("");
  if (!oldHeaders.every(function (header, index) { return actual[index] === header; })) {
    throw new Error("V3_Supplies: несовместимый базовый заголовок. Добавление плановых дат остановлено без изменений.");
  }
  for (var i = 0; i < 2; i++) {
    if (actual[17 + i] && actual[17 + i] !== expectedTail[i]) {
      throw new Error("V3_Supplies: колонка " + (18 + i) + " занята неизвестным заголовком «" + actual[17 + i] + "». Обновление остановлено.");
    }
    if (!actual[17 + i] && sheet.getMaxColumns() >= 18 + i && sheet.getLastRow() > 1) {
      var body = sheet.getRange(2, 18 + i, sheet.getLastRow() - 1, 1).getValues();
      if (body.some(function (row) { return row[0] !== "" && row[0] != null; })) {
        throw new Error("V3_Supplies: колонка " + (18 + i) + " содержит данные при пустом заголовке. Плановые даты не будут перезаписывать данные.");
      }
    }
  }
  var changed = false;
  if (sheet.getMaxColumns() < 19) sheet.insertColumnsAfter(sheet.getMaxColumns(), 19 - sheet.getMaxColumns());
  for (var j = 0; j < 2; j++) {
    if (!actual[17 + j]) {
      sheet.getRange(1, 18 + j).setValue(expectedTail[j]).setFontWeight("bold");
      changed = true;
    }
  }
  di3CompactSheet_(sheet, Math.max(1, sheet.getLastRow()), 19);
  return { upgraded: changed, added_columns: changed ? expectedTail.filter(function (_, index) { return !actual[17 + index]; }) : [] };
}

/** Create missing v3 tables, or initialize a completely empty existing sheet. */
function di3EnsureCoreFoundationSchemas_(allowPlannedSchemaMigrations) {
  // Existing-workbook schema upgrades run only from the setup path, after Dry Run and a verified backup.
  // Ordinary application calls may initialize missing tables but must not silently migrate a live book.
  // Additive schema upgrades only. These functions validate the existing header prefix before appending.
  if (typeof di3UpgradeOrderSettlementSchema_ === "function") di3UpgradeOrderSettlementSchema_();
  if (typeof di3UpgradeStockLotsSchema_ === "function") di3UpgradeStockLotsSchema_();
  if (typeof di3UpgradeStockLotsMoneySchema_ === "function") di3UpgradeStockLotsMoneySchema_();
  if (typeof di3UpgradeStockAllocationsMoneySchema_ === "function") di3UpgradeStockAllocationsMoneySchema_();
  if (allowPlannedSchemaMigrations === true && typeof di3UpgradeSupplyPlanningDatesSchema_ === "function") di3UpgradeSupplyPlanningDatesSchema_();
  var ss = di3GetSpreadsheet_();
  var created = [];
  DI3_CORE_TABLE_NAMES.forEach(function (name) {
    var headers = DI3_TABLE_SCHEMAS[name];
    var sheet = ss.getSheetByName(name);
    if (!sheet) {
      sheet = ss.insertSheet(name);
      created.push(name);
      di3PrepareNewSheet_(sheet, 1, headers.length);
    }
    if (sheet.getMaxColumns() < headers.length) {
      sheet.insertColumnsAfter(sheet.getMaxColumns(), headers.length - sheet.getMaxColumns());
    }
    var actual = sheet.getRange(1, 1, 1, headers.length).getDisplayValues()[0]
      .map(di3NormalizeHeader_);
    var blank = actual.every(function (value) { return value === ""; });
    if (blank) {
      if (sheet.getLastRow() > 1) {
        throw new Error(name + ': нельзя установить заголовки — ниже уже есть данные.');
      }
      sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
      di3SetFrozenRowsSafely_(sheet, 1);
      sheet.getRange(1, 1, 1, headers.length).setFontWeight("bold");
      if (name === "V3_Orders" && headers.length === 30 && sheet.getMaxRows() > 1) {
        sheet.getRange(2, 30, sheet.getMaxRows() - 1, 1).setNumberFormat("dd.mm.yyyy");
      }
      di3CompactSheet_(sheet, DI3_TABLE_MIN_ROWS[name] || 1, headers.length);
      return;
    }
    // During the explicit setup/migration path only, permit the validated v3 order prefix
    // to reach Schema Versioning. The v4 migration itself journals and fills column AD.
    if (name === "V3_Orders" && allowPlannedSchemaMigrations === true &&
        headers.length === 30 && headers[29] === "business_date" &&
        headers.slice(0, 29).every(function (header, index) { return actual[index] === header; }) &&
        actual[29] === "") {
      if (sheet.getMaxRows() > 1) sheet.getRange(2, 30, sheet.getMaxRows() - 1, 1).setNumberFormat("dd.mm.yyyy");
      di3CompactSheet_(sheet, Math.max(DI3_TABLE_MIN_ROWS[name] || 1, sheet.getLastRow() || 0), 30);
      return;
    }
    for (var i = 0; i < headers.length; i++) {
      if (actual[i] !== headers[i]) {
        throw new Error(name + '! строка 1 не соответствует схеме. Ожидался заголовок "' +
          headers[i] + '", найден "' + actual[i] + '". Ничего не перезаписано.');
      }
    }
    // Product diameter is a textual measurement (for example "6.5"), not a date.
    // Keep its storage column in plain-text mode before any future append/update.
    if (name === "Products" && sheet.getMaxRows() > 1) {
      sheet.getRange(2, 5, sheet.getMaxRows() - 1, 1).setNumberFormat("@");
    }
    if (name === "V3_Orders" && headers.length === 30 && sheet.getMaxRows() > 1) {
      sheet.getRange(2, 30, sheet.getMaxRows() - 1, 1).setNumberFormat("dd.mm.yyyy");
    }
    di3CompactSheet_(sheet, Math.max(DI3_TABLE_MIN_ROWS[name] || 1, sheet.getLastRow() || 0), headers.length);
  });
  return created;
}

function di3GetHeaderMap_(sheetName) {
  var headers = DI3_TABLE_SCHEMAS[sheetName];
  if (!headers) throw new Error('Неизвестная схема: ' + sheetName);
  var sheet = di3GetSheetOrThrow_(sheetName);
  var actual = sheet.getRange(1, 1, 1, headers.length).getDisplayValues()[0]
    .map(di3NormalizeHeader_);
  var map = {};
  headers.forEach(function (header, index) {
    if (actual[index] !== header) {
      throw new Error(sheetName + ': неверный заголовок в колонке ' + (index + 1));
    }
    map[header] = index;
  });
  return map;
}

function di3ReadTableValues_(sheetName) {
  var sheet = di3GetSheetOrThrow_(sheetName);
  var width = DI3_TABLE_SCHEMAS[sheetName].length;
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  return sheet.getRange(2, 1, lastRow - 1, width).getValues();
}

/**
 * Read only rows matching one exact key in a known column.
 * TextFinder searches the key column server-side; matching full rows are fetched
 * in contiguous blocks so callers avoid transferring the entire repository.
 * The returned rows retain physical sheet row numbers for safe targeted updates.
 */
function di3ReadRowsByColumnValue_(sheetName, columnIndexZeroBased, value) {
  var schema = DI3_TABLE_SCHEMAS[sheetName];
  if (!schema) throw new Error("Неизвестная системная таблица: " + sheetName);
  var columnIndex = Number(columnIndexZeroBased);
  if (!Number.isInteger(columnIndex) || columnIndex < 0 || columnIndex >= schema.length) {
    throw new Error("Некорректный индекс колонки поиска для " + sheetName + ": " + columnIndexZeroBased);
  }
  if (value == null || String(value) === "") return [];

  var sheet = di3GetSheetOrThrow_(sheetName);
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  var target = String(value);
  var matches = [];
  var searchRange = sheet.getRange(2, columnIndex + 1, lastRow - 1, 1);

  if (typeof searchRange.createTextFinder === "function") {
    var finder = searchRange.createTextFinder(target)
      .matchCase(true)
      .matchEntireCell(true)
      .matchFormulaText(false)
      .useRegularExpression(false);
    matches = finder.findAll().map(function (range) { return range.getRow(); });
  } else {
    // Compatibility fallback for test doubles or older non-GAS adapters.
    var fallbackRows = di3ReadTableValues_(sheetName);
    fallbackRows.forEach(function (row, index) {
      if (String(row[columnIndex]) === target) matches.push(index + 2);
    });
  }

  if (!matches.length) return [];
  matches = matches.filter(function (rowNumber, index, all) {
    return Number.isInteger(rowNumber) && rowNumber >= 2 && all.indexOf(rowNumber) === index;
  }).sort(function (a, b) { return a - b; });

  var result = [];
  var groupStart = matches[0];
  var previousRow = matches[0];
  function flushGroup_(start, end) {
    var block = sheet.getRange(start, 1, end - start + 1, schema.length).getValues();
    block.forEach(function (row, offset) {
      // Preserve the old String(rawValue) equality even if TextFinder's display layer
      // yields a false-positive because of formatting or a formula's display value.
      if (String(row[columnIndex]) !== target) return;
      result.push({ row_number: start + offset, values: row });
    });
  }
  for (var i = 1; i < matches.length; i++) {
    if (matches[i] !== previousRow + 1) {
      flushGroup_(groupStart, previousRow);
      groupStart = matches[i];
    }
    previousRow = matches[i];
  }
  flushGroup_(groupStart, previousRow);
  return result;
}


/** Find rows matching any exact key with server-side TextFinder, then read only matching row blocks. */
function di3ReadRowsByColumnValuesViaTextFinder_(sheetName, columnIndexZeroBased, values) {
  if (!Array.isArray(values) || !values.length) return [];
  var schema = DI3_TABLE_SCHEMAS[sheetName];
  if (!schema) throw new Error("Неизвестная системная таблица: " + sheetName);
  var columnIndex = Number(columnIndexZeroBased);
  if (!Number.isInteger(columnIndex) || columnIndex < 0 || columnIndex >= schema.length) {
    throw new Error("Некорректный индекс колонки поиска для " + sheetName + ": " + columnIndexZeroBased);
  }
  var targets = Object.create(null);
  values.forEach(function (value) { if (value != null && String(value) !== "") targets[String(value)] = true; });
  var keys = Object.keys(targets);
  if (!keys.length) return [];
  var sheet = di3GetSheetOrThrow_(sheetName);
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  var searchRange = sheet.getRange(2, columnIndex + 1, lastRow - 1, 1);
  if (typeof searchRange.createTextFinder !== "function") {
    return di3ReadRowsByColumnValues_(sheetName, columnIndex, keys);
  }
  var rowSet = Object.create(null);
  // A small exact-key set (for example, three pending statuses) can be searched
  // with one anchored alternation instead of one remote TextFinder call per key.
  // Keep the number of alternatives bounded; large fan-outs use the one-column
  // read helper so regex size and server-side search complexity stay predictable.
  if (keys.length <= 25) {
    var escaped = keys.map(function (key) { return key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); });
    var pattern = "^(?:" + escaped.join("|") + ")$";
    searchRange.createTextFinder(pattern).matchCase(true).matchEntireCell(true)
      .matchFormulaText(false).useRegularExpression(true).findAll().forEach(function (range) {
        var rowNumber = Number(range.getRow());
        if (rowNumber >= 2 && rowNumber <= lastRow) rowSet[rowNumber] = true;
      });
  } else {
    keys.forEach(function (key) {
      searchRange.createTextFinder(key).matchCase(true).matchEntireCell(true)
        .matchFormulaText(false).useRegularExpression(false).findAll().forEach(function (range) {
          var rowNumber = Number(range.getRow());
          if (rowNumber >= 2 && rowNumber <= lastRow) rowSet[rowNumber] = true;
        });
    });
  }
  var rowNumbers = Object.keys(rowSet).map(Number).sort(function (a, b) { return a - b; });
  if (!rowNumbers.length) return [];
  var result = [];
  var groupStart = rowNumbers[0], previousRow = rowNumbers[0];
  function flush(start, end) {
    var block = sheet.getRange(start, 1, end - start + 1, schema.length).getValues();
    block.forEach(function (row, offset) {
      if (Object.prototype.hasOwnProperty.call(targets, String(row[columnIndex]))) {
        result.push({ row_number: start + offset, values: row });
      }
    });
  }
  for (var i = 1; i < rowNumbers.length; i++) {
    if (rowNumbers[i] !== previousRow + 1) {
      flush(groupStart, previousRow);
      groupStart = rowNumbers[i];
    }
    previousRow = rowNumbers[i];
  }
  flush(groupStart, previousRow);
  return result;
}

function di3ReadRowByColumnValue_(sheetName, columnIndexZeroBased, value) {
  var rows = di3ReadRowsByColumnValue_(sheetName, columnIndexZeroBased, value);
  return rows.length ? rows[0] : null;
}

/**
 * Core application-metadata repository.
 * Keep this in SchemaRegistry rather than a feature module: setup, schema
 * versioning, diagnostics and backup metadata all need _AppMeta before FIFO
 * operations are available or initialized.
 */
function di3GetAppMetaValue_(key) {
  var match = di3ReadRowByColumnValue_("_AppMeta", 0, String(key));
  return match ? match.values[1] : null;
}

function di3SetAppMetaValue_(key, value) {
  var match = di3ReadRowByColumnValue_("_AppMeta", 0, String(key));
  var sheet = di3GetSheetOrThrow_("_AppMeta");
  if (match) {
    sheet.getRange(Number(match.row_number), 2, 1, 2).setValues([[value, new Date()]]);
    return Number(match.row_number);
  }
  di3AppendTableRows_("_AppMeta", [[String(key), value, new Date()]]);
  return sheet.getLastRow();
}

/**
 * Read rows matching any of several exact keys in one repository column.
 * The key column is transferred once, then only matching full-row blocks are read.
 * This is intended for bounded, operation-local fan-out (for example, all items
 * belonging to a set of affected orders), not as a persistent cache.
 */
function di3ReadRowsByColumnValues_(sheetName, columnIndexZeroBased, values) {
  if (!Array.isArray(values) || !values.length) return [];
  var schema = DI3_TABLE_SCHEMAS[sheetName];
  if (!schema) throw new Error("Неизвестная системная таблица: " + sheetName);
  var columnIndex = Number(columnIndexZeroBased);
  if (!Number.isInteger(columnIndex) || columnIndex < 0 || columnIndex >= schema.length) {
    throw new Error("Некорректный индекс колонки поиска для " + sheetName + ": " + columnIndexZeroBased);
  }
  var targets = Object.create(null);
  values.forEach(function (value) {
    if (value != null && String(value) !== "") targets[String(value)] = true;
  });
  var targetKeys = Object.keys(targets);
  if (!targetKeys.length) return [];
  if (targetKeys.length === 1) return di3ReadRowsByColumnValue_(sheetName, columnIndex, targetKeys[0]);

  var sheet = di3GetSheetOrThrow_(sheetName);
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  var keyValues = sheet.getRange(2, columnIndex + 1, lastRow - 1, 1).getValues();
  var matches = [];
  keyValues.forEach(function (row, index) {
    if (Object.prototype.hasOwnProperty.call(targets, String(row[0]))) matches.push(index + 2);
  });
  if (!matches.length) return [];

  var result = [];
  var groupStart = matches[0];
  var previousRow = matches[0];
  function flushGroup_(start, end) {
    var block = sheet.getRange(start, 1, end - start + 1, schema.length).getValues();
    block.forEach(function (row, offset) {
      if (!Object.prototype.hasOwnProperty.call(targets, String(row[columnIndex]))) return;
      result.push({ row_number: start + offset, values: row });
    });
  }
  for (var i = 1; i < matches.length; i++) {
    if (matches[i] !== previousRow + 1) {
      flushGroup_(groupStart, previousRow);
      groupStart = matches[i];
    }
    previousRow = matches[i];
  }
  flushGroup_(groupStart, previousRow);
  return result;
}

/** Read a single repository column when a caller only needs one index field. */
function di3ReadTableColumnValues_(sheetName, columnIndexZeroBased) {
  var schema = DI3_TABLE_SCHEMAS[sheetName];
  var columnIndex = Number(columnIndexZeroBased);
  if (!schema) throw new Error("Неизвестная системная таблица: " + sheetName);
  if (!Number.isInteger(columnIndex) || columnIndex < 0 || columnIndex >= schema.length) {
    throw new Error("Некорректный индекс колонки для " + sheetName + ": " + columnIndexZeroBased);
  }
  var sheet = di3GetSheetOrThrow_(sheetName);
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  return sheet.getRange(2, columnIndex + 1, lastRow - 1, 1).getValues().map(function (row) { return row[0]; });
}

function di3AppendTableRows_(sheetName, rows) {
  if (!rows || !rows.length) return 0;
  var width = DI3_TABLE_SCHEMAS[sheetName].length;
  rows.forEach(function (row, index) {
    if (!Array.isArray(row) || row.length !== width) {
      throw new Error(sheetName + ': строка ' + (index + 1) + ' имеет неверную ширину.');
    }
  });
  var sheet = di3GetSheetOrThrow_(sheetName);
  var startRow = Math.max(sheet.getLastRow(), 1) + 1;
  var requiredLastRow = startRow + rows.length - 1;
  di3EnsureSheetCapacity_(sheet, requiredLastRow, width);
  if (sheetName === "Products") sheet.getRange(startRow, 5, rows.length, 1).setNumberFormat("@");
  sheet.getRange(startRow, 1, rows.length, width).setValues(rows);
  return rows.length;
}

function di3ApplyContiguousRowUpdates_(sheetName, updates) {
  if (!updates || !updates.length) return 0;
  var width = DI3_TABLE_SCHEMAS[sheetName].length;
  var sorted = updates.slice().sort(function (a, b) { return a.row_number - b.row_number; });
  var sheet = di3GetSheetOrThrow_(sheetName);
  var groups = [];
  sorted.forEach(function (item) {
    if (!Array.isArray(item.values) || item.values.length !== width) {
      throw new Error(sheetName + ': неверная ширина обновляемой строки.');
    }
    var lastGroup = groups.length ? groups[groups.length - 1] : null;
    if (lastGroup && item.row_number === lastGroup.start_row + lastGroup.rows.length) {
      lastGroup.rows.push(item.values);
    } else {
      groups.push({ start_row: item.row_number, rows: [item.values] });
    }
  });
  groups.forEach(function (group) {
    if (sheetName === "Products") sheet.getRange(group.start_row, 5, group.rows.length, 1).setNumberFormat("@");
    sheet.getRange(group.start_row, 1, group.rows.length, width).setValues(group.rows);
  });
  return sorted.length;
}

function di3WithLock_(callback) {
  if (typeof callback !== "function") throw new Error("di3WithLock_: не передана функция операции.");

  // ScriptLock is not reentrant at the service level. Reuse the lock already
  // owned by this synchronous Apps Script execution for nested service calls.
  if (DI3_SCRIPT_LOCK_DEPTH_ > 0) {
    DI3_SCRIPT_LOCK_DEPTH_++;
    try {
      return callback();
    } finally {
      DI3_SCRIPT_LOCK_DEPTH_--;
    }
  }

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) {
    throw new Error('Core Foundation занят другой операцией. Повтори запуск позже.');
  }

  DI3_SCRIPT_LOCK_DEPTH_ = 1;
  var result;
  var callbackError = null;
  var flushError = null;
  var releaseError = null;
  try {
    try {
      result = callback();
    } catch (error) {
      callbackError = error;
    }

    // Google recommends flushing pending SpreadsheetApp changes before
    // releasing the lock, so another execution cannot enter before writes
    // from this critical section have been committed.
    try {
      if (typeof SpreadsheetApp !== "undefined" && SpreadsheetApp && typeof SpreadsheetApp.flush === "function") {
        SpreadsheetApp.flush();
      }
    } catch (error) {
      flushError = error;
    }
  } finally {
    DI3_SCRIPT_LOCK_DEPTH_ = 0;
    try {
      lock.releaseLock();
    } catch (error) {
      releaseError = error;
    }
  }

  if (callbackError) {
    if (flushError) callbackError.di3FlushError = String(flushError && flushError.message || flushError);
    if (releaseError) callbackError.di3ReleaseError = String(releaseError && releaseError.message || releaseError);
    throw callbackError;
  }
  if (flushError) {
    if (releaseError) flushError.di3ReleaseError = String(releaseError && releaseError.message || releaseError);
    throw flushError;
  }
  if (releaseError) throw releaseError;
  return result;
}
