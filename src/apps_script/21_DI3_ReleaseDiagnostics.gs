/** Dots Inventory v3 — read-only installation and operational diagnostics. */
var DI3_REQUIRED_USER_WORKSPACES = Object.freeze([
  "Настройки",
  "Финансы",
  "Продукты",
  "Карточка продукта",
  "Поставка v3",
  "Реестр поставок v3",
  "Управление складом",
  "Склад",
  "Журнал склада",
  "История FIFO",
  "Калькулятор заказа v3",
  "Реестр заказов v3"
]);

var DI3_REQUIRED_TRIGGER_HANDLERS = Object.freeze([
  "di3UnifiedOnEdit",
  "di3SupplyOnOpen"
]);

/**
 * Read-only diagnostics. Does not create sheets, repair data, or change documents.
 * Returns errors and warnings separately so optional conditions are not treated as corruption.
 */
function di3RunInstallationDiagnostics() {
  var checks = [];
  var errors = [];
  var warnings = [];
  var ss = di3GetSpreadsheet_();

  function addCheck(name, passed, detail) {
    checks.push({ name: name, passed: !!passed, detail: detail || "" });
    if (!passed) errors.push(name + (detail ? ": " + detail : ""));
  }

  var schemaIssues = di3ValidateExistingCoreSchemas_();
  addCheck("Схемы системных таблиц", schemaIssues.length === 0, schemaIssues.join("; "));

  var missingCore = DI3_CORE_TABLE_NAMES.filter(function (name) { return !ss.getSheetByName(name); });
  addCheck("Системные листы", missingCore.length === 0, missingCore.length ? "Отсутствуют: " + missingCore.join(", ") : "Все " + DI3_CORE_TABLE_NAMES.length + " таблиц на месте.");

  var missingWorkspaces = DI3_REQUIRED_USER_WORKSPACES.filter(function (name) { return !ss.getSheetByName(name); });
  addCheck("Пользовательские листы", missingWorkspaces.length === 0, missingWorkspaces.length ? "Отсутствуют: " + missingWorkspaces.join(", ") : "Все " + DI3_REQUIRED_USER_WORKSPACES.length + " рабочих листов на месте.");

  try {
    var schemaVersioning = di3GetSchemaVersioningReport_();
    var schemaReady = schemaVersioning.status === "READY" && schemaVersioning.current_version === DI3_SCHEMA_VERSION &&
      schemaVersioning.baseline_migration && schemaVersioning.baseline_migration.status === "COMPLETED";
    addCheck("Версия схемы и журнал миграций", schemaReady,
      schemaReady ? "Schema version " + schemaVersioning.current_version + "; migrations " + schemaVersioning.migrations_count :
        "Текущая версия " + schemaVersioning.current_version + ", целевая " + schemaVersioning.target_version + ". " + (schemaVersioning.issues || []).concat(schemaVersioning.warnings || []).join("; "));
  } catch (schemaVersionError) {
    addCheck("Версия схемы и журнал миграций", false, schemaVersionError.message || String(schemaVersionError));
  }

  try {
    var settingsAudit = di3ValidateSettingsRepository_();
    addCheck("Репозиторий настроек", settingsAudit.issues.length === 0,
      settingsAudit.issues.join("; ") || (settingsAudit.settings_count + " настроек; валюта " + settingsAudit.currency + "; часовой пояс " + settingsAudit.time_zone));
  } catch (settingsError) {
    addCheck("Репозиторий настроек", false, settingsError.message || String(settingsError));
  }

  try {
    var moneyVersion = String(di3GetAppMetaValue_("money_fifo_schema_version") || "");
    var moneyStatus = String(di3GetAppMetaValue_("money_fifo_migration_status") || "");
    var moneyReady = moneyVersion === DI3_MONEY_FIFO_SCHEMA_VERSION && moneyStatus === "READY";
    checks.push({ name: "Денежная модель FIFO", passed: moneyReady,
      detail: moneyReady ? "Версия " + moneyVersion + "; целые копейки активны." : "Требуется миграция: version=" + (moneyVersion || "нет") + ", status=" + (moneyStatus || "нет") + ". Новые складские операции заблокированы до миграции." });
    if (!moneyReady) warnings.push("Денежная модель FIFO не готова. Создай резервную копию и выполни «Система → Пересчитать FIFO в копейках».");
  } catch (moneyStateError) {
    warnings.push("Не удалось проверить состояние денежной модели FIFO: " + (moneyStateError.message || String(moneyStateError)));
  }

  var versionRows = [];
  try { versionRows = di3ReadTableValues_("_AppMeta"); } catch (versionError) {}
  var versionRow = versionRows.filter(function (row) { return String(row[0]) === "application_version"; })[0];
  addCheck("Версия приложения", !!versionRow, versionRow ? String(versionRow[1]) : "В _AppMeta не найдена application_version.");

  var pending = [];
  try {
    pending = di3ReadTableValues_("Operations").filter(function (row) {
      return ["MANUAL_STOCK_MOVEMENT", "SUPPLY_RECEIVE", "ORDER_DISPATCH", "ORDER_RETURN", "STOCK_ADJUSTMENT"].indexOf(String(row[2])) !== -1 &&
        ["PREPARED", "RETRYABLE", "QUARANTINED"].indexOf(String(row[5])) !== -1;
    });
  } catch (pendingError) {
    errors.push("Не удалось прочитать Operations: " + (pendingError.message || String(pendingError)));
  }
  if (pending.length) warnings.push("Есть незавершённые складские операции: " + pending.length + ". Запусти восстановление перед дальнейшей работой.");
  checks.push({ name: "Незавершённые складские операции", passed: pending.length === 0, detail: pending.length ? String(pending.length) : "Нет." });
  var quarantinedOperations = pending.filter(function (row) { return String(row[5]) === "QUARANTINED"; });
  if (quarantinedOperations.length) warnings.push("В карантине находятся операции: " + quarantinedOperations.map(function (row) { return String(row[0]); }).join(", ") + ". Они не будут повторяться автоматически; требуется ручная проверка.");
  checks.push({ name: "Операции в карантине", passed: quarantinedOperations.length === 0,
    detail: quarantinedOperations.length ? quarantinedOperations.length + ": " + quarantinedOperations.map(function (row) { return String(row[0]); }).join(", ") : "Нет." });
  try {
    var operationReport = di3GetOperationRecoveryReport_();
    var incompleteAttempts = operationReport.incomplete_attempts || [];
    if (incompleteAttempts.length) warnings.push("Есть незавершённые записи журнала попыток: " + incompleteAttempts.map(function (item) { return item.attempt_id; }).join(", ") + ". Проверь, не оборвалось ли выполнение Apps Script.");
    checks.push({ name: "Журнал попыток операций", passed: incompleteAttempts.length === 0,
      detail: incompleteAttempts.length ? incompleteAttempts.length + " незавершённых попыток" : "Все попытки имеют конечный результат." });
  } catch (attemptReportError) {
    checks.push({ name: "Журнал попыток операций", passed: false, detail: attemptReportError.message || String(attemptReportError) });
  }

  var fifoIntegrity = null;
  try {
    fifoIntegrity = di3GetFifoIntegrityDiagnostics_();
    var fifoIntegrityDetail = fifoIntegrity.errors.concat(fifoIntegrity.warnings).join("; ");
    if (fifoIntegrity.errors.length && pending.length) {
      // A partially applied PREPARED/RETRYABLE operation can temporarily make projections differ.
      // Surface the problem as a warning and keep Dashboard/read-only diagnostics available.
      warnings.push("FIFO-проверка обнаружила несогласованность при незавершённой операции: " + fifoIntegrity.errors.join("; "));
      checks.push({ name: "FIFO-целостность", passed: true, detail: "Требуется восстановление операции: " + fifoIntegrityDetail });
    } else {
      addCheck("FIFO-целостность", fifoIntegrity.errors.length === 0, fifoIntegrityDetail || "Партии, распределения и состояние товаров согласованы.");
    }
    fifoIntegrity.warnings.forEach(function (warning) { warnings.push(warning); });
  } catch (fifoIntegrityError) {
    warnings.push("Не удалось проверить FIFO-целостность: " + (fifoIntegrityError.message || String(fifoIntegrityError)));
  }

  var configuredTimeZone = di3GetConfiguredTimeZone_();
  var spreadsheetTimeZone = "";
  try { spreadsheetTimeZone = ss.getSpreadsheetTimeZone(); } catch (timeZoneError) {}
  var scriptTimeZone = di3GetScriptTimeZone_();
  var timeZoneMatches = spreadsheetTimeZone === configuredTimeZone && (!scriptTimeZone || scriptTimeZone === configuredTimeZone);
  if (!timeZoneMatches) {
    warnings.push("Несогласованный часовой пояс: config=" + configuredTimeZone + ", project=" + (scriptTimeZone || "неизвестен") + ", spreadsheet=" + (spreadsheetTimeZone || "неизвестен") + ".");
  }
  checks.push({ name: "Единый часовой пояс", passed: timeZoneMatches,
    detail: "config=" + configuredTimeZone + "; project=" + (scriptTimeZone || "неизвестен") + "; spreadsheet=" + (spreadsheetTimeZone || "неизвестен") });

  var periodStatus = null;
  try { periodStatus = di3GetPeriodGuardStatus(); } catch (periodError) {
    warnings.push("Не удалось прочитать PeriodGuard: " + (periodError.message || String(periodError)));
  }
  if (periodStatus) checks.push({ name: "Учётные периоды", passed: true, detail: periodStatus.locked_through ? "Закрыто по " + periodStatus.locked_through : "Нет закрытых периодов." });

  var latestFifoRun = null;
  try {
    var fifoRunRows = di3ReadTableValues_("FifoAllocationRuns");
    fifoRunRows.forEach(function (row) {
      var sequence = Number(row[1]) || 0;
      if (!latestFifoRun || sequence > latestFifoRun.sequence) {
        latestFifoRun = { sequence: sequence, status: String(row[2] || ""), run_id: String(row[0] || "") };
      }
    });
  } catch (fifoError) {
    warnings.push("Не удалось прочитать FIFO-runs: " + (fifoError.message || String(fifoError)));
  }
  var fifoHealthy = !latestFifoRun || latestFifoRun.status === "COMMITTED";
  if (!fifoHealthy) warnings.push("Последний FIFO-run имеет статус " + latestFifoRun.status + ". Проверь журнал FIFO-пересчётов и восстановление.");
  checks.push({ name: "Последний FIFO-пересчёт", passed: fifoHealthy, detail: latestFifoRun ? ("#" + latestFifoRun.sequence + " · " + latestFifoRun.status) : "Движений пока нет; FIFO ещё не запускался." });

  var triggerNames = [];
  try {
    if (typeof ScriptApp !== "undefined") {
      triggerNames = ScriptApp.getProjectTriggers().map(function (trigger) { return trigger.getHandlerFunction(); });
    }
  } catch (triggerError) {
    warnings.push("Нет доступа к списку установленных триггеров: " + (triggerError.message || String(triggerError)));
  }
  var missingTriggers = DI3_REQUIRED_TRIGGER_HANDLERS.filter(function (name) { return triggerNames.indexOf(name) === -1; });
  var managedEditCount = triggerNames.filter(function (name) { return name === "di3UnifiedOnEdit"; }).length;
  var legacyEditTriggers = triggerNames.filter(function (name) {
    return ["di3WarehouseManagerOnEdit", "di3ProductCatalogOnEdit", "di3SupplyFormOnEdit", "di3WarehouseViewsOnEdit"].indexOf(name) !== -1;
  });
  var editTriggersHealthy = managedEditCount === 1 && legacyEditTriggers.length === 0;
  if (missingTriggers.length) warnings.push("Не найдены installable triggers: " + missingTriggers.join(", ") + ". Повтори setupDotsInventoryV3() от владельца таблицы.");
  if (!editTriggersHealthy) warnings.push("Ожидается ровно один di3UnifiedOnEdit без старых обработчиков: найдено " + managedEditCount + " новых и " + legacyEditTriggers.length + " старых.");
  checks.push({ name: "Установленные триггеры", passed: missingTriggers.length === 0 && editTriggersHealthy,
    detail: missingTriggers.length || !editTriggersHealthy ? "Отсутствуют: " + missingTriggers.join(", ") + "; старые onEdit: " + legacyEditTriggers.length + "; единый onEdit: " + managedEditCount :
      "Установлены единый onEdit и общий onOpen; старых edit-триггеров нет." });

  function getChartRequiredRows(sheet) {
    var required = 0;
    try {
      (sheet.getCharts ? sheet.getCharts() : []).forEach(function (chart) {
        if (!chart || typeof chart.getContainerInfo !== "function") return;
        var info = chart.getContainerInfo();
        var anchorRow = info && typeof info.getAnchorRow === "function" ? Number(info.getAnchorRow()) : 0;
        if (Number.isFinite(anchorRow) && anchorRow > 0) required = Math.max(required, anchorRow + 18);
      });
    } catch (chartError) {
      warnings.push("Не удалось проверить размер области диаграмм на листе " + sheet.getName() + ".");
    }
    return required;
  }

  var workspaceDimensions = {
    "Настройки": { rows: 21, columns: 4 },
    "Финансы": { rows: 50, columns: 17 },
    "Продукты": { rows: 4, columns: 21 },
    "Карточка продукта": { rows: 17, columns: 2 },
    "Поставка v3": { rows: 31, columns: 14 },
    "Реестр поставок v3": { rows: 3, columns: 13 },
    "Управление складом": { rows: 13, columns: 5 },
    "Склад": { rows: 13, columns: 13 },
    "Журнал склада": { rows: 7, columns: 14 },
    "История FIFO": { rows: 6, columns: 7 },
    "Калькулятор заказа v3": { rows: 31, columns: 7 },
    "Реестр заказов v3": { rows: 3, columns: 13 }
  };
  var oversized = [];
  var sheetGridReport = [];
  Object.keys(workspaceDimensions).forEach(function (name) {
    var target = workspaceDimensions[name];
    var sheet = ss.getSheetByName(name);
    if (!sheet) return;
    var minRows = Math.max(target.rows, sheet.getLastRow() || 0, getChartRequiredRows(sheet),
      (sheet.getFrozenRows ? sheet.getFrozenRows() : 0) + 1);
    var minColumns = Math.max(target.columns, sheet.getLastColumn() || 0,
      (sheet.getFrozenColumns ? sheet.getFrozenColumns() : 0) + 1);
    sheetGridReport.push({ sheet: name, kind: "workspace", rows: sheet.getMaxRows(), columns: sheet.getMaxColumns(),
      required_rows: minRows, required_columns: minColumns,
      extra_rows: Math.max(0, sheet.getMaxRows() - minRows), extra_columns: Math.max(0, sheet.getMaxColumns() - minColumns) });
    if (sheet.getMaxRows() > minRows || sheet.getMaxColumns() > minColumns) {
      oversized.push(name + ": сетка " + sheet.getMaxRows() + "×" + sheet.getMaxColumns() + ", достаточно " + minRows + "×" + minColumns);
    }
  });
  var systemOversized = [];
  DI3_CORE_TABLE_NAMES.forEach(function (name) {
    var sheet = ss.getSheetByName(name);
    if (!sheet) return;
    var requiredRows = Math.max(DI3_TABLE_MIN_ROWS[name] || 1, sheet.getLastRow() || 0,
      (sheet.getFrozenRows ? sheet.getFrozenRows() : 0) + 1);
    var requiredColumns = Math.max(DI3_TABLE_SCHEMAS[name].length,
      (sheet.getFrozenColumns ? sheet.getFrozenColumns() : 0) + 1);
    sheetGridReport.push({ sheet: name, kind: "system", rows: sheet.getMaxRows(), columns: sheet.getMaxColumns(),
      required_rows: requiredRows, required_columns: requiredColumns,
      extra_rows: Math.max(0, sheet.getMaxRows() - requiredRows), extra_columns: Math.max(0, sheet.getMaxColumns() - requiredColumns) });
    if (sheet.getMaxRows() > requiredRows || sheet.getMaxColumns() > requiredColumns) {
      systemOversized.push(name + ": " + sheet.getMaxRows() + "×" + sheet.getMaxColumns() + " вместо " + requiredRows + "×" + requiredColumns);
    }
  });
  var frozenPaneIssues = [];
  ss.getSheets().forEach(function (sheet) {
    var frozenRows = sheet.getFrozenRows ? sheet.getFrozenRows() : 0;
    var frozenColumns = sheet.getFrozenColumns ? sheet.getFrozenColumns() : 0;
    if (frozenRows >= sheet.getMaxRows()) frozenPaneIssues.push(sheet.getName() + ": закреплены все строки");
    if (frozenColumns >= sheet.getMaxColumns()) frozenPaneIssues.push(sheet.getName() + ": закреплены все столбцы");
  });
  addCheck("Закреплённые области", frozenPaneIssues.length === 0,
    frozenPaneIssues.length ? frozenPaneIssues.join("; ") : "На каждом листе остаётся прокручиваемая область.");

  var compactGridHealthy = oversized.length === 0 && systemOversized.length === 0;
  addCheck("Компактные размеры листов", compactGridHealthy,
    compactGridHealthy ? "Нет лишних пустых строк и столбцов." : oversized.concat(systemOversized).join("; "));

  var productCount = 0;
  var lotRows = 0;
  var unknownLots = 0;
  try {
    productCount = di3ReadTableValues_("Products").filter(function (row) { return row[0]; }).length;
    var lots = di3ReadTableValues_("StockLots");
    lotRows = lots.length;
    unknownLots = lots.filter(function (row) { return String(row[10] || "UNKNOWN") === "UNKNOWN"; }).length;
  } catch (dataError) {
    warnings.push("Не удалось полностью прочитать каталог или партии: " + (dataError.message || String(dataError)));
  }
  if (unknownLots) warnings.push("Есть партии с неизвестной себестоимостью: " + unknownLots + ". Они учитываются в количестве, но не входят в известную стоимость и расчёт скидок.");

  var status = errors.length ? "ERROR" : (warnings.length ? "READY_WITH_WARNINGS" : "READY");
  var result = {
    status: status,
    version: versionRow ? String(versionRow[1]) : "UNKNOWN",
    generated_at: new Date(),
    checks: checks,
    errors: errors,
    warnings: warnings,
    summary: { products: productCount, fifo_lots: lotRows, unknown_cost_lots: unknownLots, pending_stock_operations: pending.length,
      fifo: fifoIntegrity ? fifoIntegrity.summary : null },
    sheet_grids: sheetGridReport
  };

  try {
    var message = status === "READY" ? "Критических проблем не найдено." : (status === "READY_WITH_WARNINGS" ? warnings.join("\n") : errors.join("\n"));
    ss.toast(message, "Диагностика · " + status, 8);
  } catch (toastError) {}
  return result;
}


/** Log physical grid dimensions for all v3-owned sheets after setup/compaction. */
function di3LogSheetGridReport() {
  var diagnostics = di3RunInstallationDiagnostics();
  var report = diagnostics.sheet_grids || [];
  if (typeof Logger !== "undefined" && Logger && typeof Logger.log === "function") {
    report.forEach(function (item) {
      Logger.log(item.sheet + " | " + item.rows + "×" + item.columns +
        " | required " + item.required_rows + "×" + item.required_columns +
        " | extra " + item.extra_rows + " rows, " + item.extra_columns + " columns");
    });
  }
  return { status: diagnostics.status, sheets: report };
}
