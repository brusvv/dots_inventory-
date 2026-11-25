/** Read-only installation preflight. Must run before setup performs any workbook mutation. */

/** Visible sheets owned by the application; unknown populated tabs are never silently overwritten. */
var DI3_MANAGED_WORKSPACE_SHEET_NAMES = Object.freeze([
  "Продукты", "Карточка продукта", "Поставка v3", "Реестр поставок v3",
  "Управление складом", "Менеджер склада", "Склад", "Журнал склада",
  "История FIFO", "Калькулятор заказа v3", "Реестр заказов v3",
  "Настройки", "Финансы"
]);

function di3FindUnexpectedPopulatedTabs_(sheets) {
  var allowed = Object.create(null);
  DI3_CORE_TABLE_NAMES.forEach(function (name) { allowed[name] = true; });
  DI3_MANAGED_WORKSPACE_SHEET_NAMES.forEach(function (name) { allowed[name] = true; });
  return (sheets || []).filter(function (sheet) {
    var name = String(sheet.getName());
    if (allowed[name]) return false;
    var hasCells = Number(sheet.getLastRow()) > 0 || Number(sheet.getLastColumn()) > 0;
    var hasCharts = !!(sheet.getCharts && sheet.getCharts().length);
    return hasCells || hasCharts;
  }).map(function (sheet) {
    return {
      name: String(sheet.getName()),
      last_row: Number(sheet.getLastRow()) || 0,
      last_column: Number(sheet.getLastColumn()) || 0,
      charts: sheet.getCharts ? sheet.getCharts().length : 0,
      hidden: !!(sheet.isSheetHidden && sheet.isSheetHidden())
    };
  });
}

function di3PreflightUnknownPopulatedTabs_() {
  var spreadsheet = di3GetSpreadsheet_();
  var unexpected = di3FindUnexpectedPopulatedTabs_(spreadsheet.getSheets());
  return {
    status: unexpected.length ? "BLOCKED" : "READY",
    checked_tabs: spreadsheet.getSheets().length,
    unexpected_tabs: unexpected,
    issues: unexpected.map(function (item) {
      return "Неизвестный лист «" + item.name + "» содержит данные или диаграммы (" +
        item.last_row + " строк × " + item.last_column + " столбцов). Dry Run не будет переименовывать, очищать или удалять этот лист. Перенеси данные или убери лист вручную после резервного копирования.";
    }),
    warnings: [],
    planned_changes: []
  };
}

function di3PreflightCellText_(sheet, a1) {
  return di3NormalizeHeader_(sheet.getRange(a1).getDisplayValue());
}

function di3PreflightHeaderRow_(sheet, row, width) {
  var available = Math.max(0, Math.min(width, sheet.getMaxColumns()));
  var values = available ? sheet.getRange(row, 1, 1, available).getDisplayValues()[0] : [];
  while (values.length < width) values.push("");
  return values.map(di3NormalizeHeader_);
}

function di3PreflightHasBodyValues_(sheet, startColumn, width) {
  var lastRow = sheet.getLastRow();
  var available = Math.min(width, sheet.getMaxColumns() - startColumn + 1);
  if (lastRow < 2 || available <= 0) return false;
  var values = sheet.getRange(2, startColumn, lastRow - 1, available).getValues();
  return values.some(function (row) {
    return row.some(function (value) { return value !== "" && value != null; });
  });
}

function di3PreflightCoreSchemas_() {
  var ss = di3GetSpreadsheet_();
  var issues = [];
  var warnings = [];
  var planned = [];
  var previousOrderHeaders = [
    "order_id", "order_number", "created_at", "status", "goods_amount",
    "commission_rate", "commission_amount", "discount_rate", "discount_amount",
    "payable_total", "estimated_fifo_cost_total", "estimated_fifo_cost_status",
    "actual_fifo_cost_total", "actual_fifo_cost_status", "profit_total", "notes",
    "delivery_method", "dispatched_at", "completed_at", "returning_at",
    "returned_at", "cancelled_at", "updated_at"
  ];

  DI3_CORE_TABLE_NAMES.forEach(function (name) {
    var sheet = ss.getSheetByName(name);
    if (!sheet) {
      planned.push({ type: "CREATE_SYSTEM_SHEET", sheet: name });
      return;
    }
    var expected = DI3_TABLE_SCHEMAS[name];
    var lastRow = sheet.getLastRow();
    var actual = di3PreflightHeaderRow_(sheet, 1, expected.length);
    var blank = actual.every(function (value) { return value === ""; });

    if (blank) {
      if (lastRow > 1) {
        issues.push(name + ": строка заголовков пустая, но ниже уже есть данные.");
      } else if (lastRow === 1) {
        issues.push(name + ": первая строка содержит данные, не соответствующие заголовкам схемы.");
      } else {
        planned.push({ type: "INITIALIZE_SCHEMA", sheet: name, columns: expected.length });
      }
      return;
    }

    if (name === "V3_Orders") {
      var legacyOrderPrefix = previousOrderHeaders.every(function (header, index) {
        return actual[index] === header;
      });
      var settlementOrderPrefix = expected.length >= 28 && expected.slice(0, 28).every(function (header, index) {
        return actual[index] === header;
      });
      if (legacyOrderPrefix && !settlementOrderPrefix) {
        var legacyTail = actual.slice(previousOrderHeaders.length);
        var expectedLegacyTail = expected.slice(previousOrderHeaders.length);
        var legacyTailBlank = legacyTail.every(function (value) { return !value; });
        var legacyTailCurrent = legacyTail.join("|") === expectedLegacyTail.join("|");
        if (!legacyTailBlank && !legacyTailCurrent) {
          issues.push("V3_Orders: хвост колонок X:AC занят неизвестными заголовками; миграция небезопасна.");
        } else if (legacyTailBlank && di3PreflightHasBodyValues_(sheet, previousOrderHeaders.length + 1, expectedLegacyTail.length)) {
          issues.push("V3_Orders: новые поля X:AC содержат данные при пустых заголовках. Автоматическая миграция не будет их перезаписывать.");
        } else if (legacyTailBlank) {
          planned.push({ type: "UPGRADE_SCHEMA", sheet: name, add_columns: expectedLegacyTail });
          warnings.push("V3_Orders: будут добавлены поля расчёта и плательщик комиссии; старые заказы сохранят прежнее правило «платит покупатель».");
        }
        return;
      }
      if (settlementOrderPrefix) {
        var payerHeader = actual[28] || "";
        if (payerHeader && payerHeader !== "commission_payer") {
          issues.push("V3_Orders: колонка AC занята неизвестным заголовком; добавление плательщика комиссии небезопасно.");
        } else if (!payerHeader && di3PreflightHasBodyValues_(sheet, 29, 1)) {
          issues.push("V3_Orders: колонка AC содержит данные при пустом заголовке. Автоматическая миграция остановлена.");
        } else if (!payerHeader) {
          planned.push({ type: "UPGRADE_SCHEMA", sheet: name, add_columns: ["commission_payer"] });
          warnings.push("V3_Orders: будет добавлен плательщик комиссии; существующие заказы получат значение BUYER.");
        }
        return;
      }
    }

    if (name === "V3_Supplies") {
      var suppliesPrefix17 = expected.slice(0, 17).every(function (header, index) { return actual[index] === header; });
      if (suppliesPrefix17) {
        var supplyTailExpected = expected.slice(17, 19);
        var supplyTail = actual.slice(17, 19);
        var supplyTailNeedsUpgrade = false;
        for (var supplyTailIndex = 0; supplyTailIndex < 2; supplyTailIndex++) {
          if (supplyTail[supplyTailIndex] && supplyTail[supplyTailIndex] !== supplyTailExpected[supplyTailIndex]) {
            issues.push("V3_Supplies: колонка " + (18 + supplyTailIndex) + " занята неизвестным заголовком «" + supplyTail[supplyTailIndex] + "». Миграция плановых дат небезопасна.");
            return;
          }
          if (!supplyTail[supplyTailIndex]) {
            if (di3PreflightHasBodyValues_(sheet, 18 + supplyTailIndex, 1)) {
              issues.push("V3_Supplies: колонка " + (18 + supplyTailIndex) + " содержит данные при пустом заголовке. Миграция остановлена без перезаписи.");
              return;
            }
            supplyTailNeedsUpgrade = true;
          }
        }
        if (supplyTailNeedsUpgrade) {
          planned.push({ type: "UPGRADE_SCHEMA", sheet: name, add_columns: supplyTailExpected.filter(function (_, index) { return !supplyTail[index]; }) });
          warnings.push("V3_Supplies: будут добавлены плановые даты заказа и ожидаемого получения; существующие даты событий и строки документов не изменяются.");
        }
        if (sheet.getLastColumn() > expected.length) {
          var supplyExtras = sheet.getRange(1, expected.length + 1, 1, sheet.getLastColumn() - expected.length).getDisplayValues()[0];
          if (supplyExtras.some(function (value) { return di3NormalizeHeader_(value) !== ""; })) {
            issues.push("V3_Supplies: обнаружены дополнительные заголовки справа от схемы.");
          }
        }
        return;
      }
    }

    if (name === "StockLots") {
      var lotsPrefix13 = expected.slice(0, 13).every(function (header, index) { return actual[index] === header; });
      var hasRemaining = actual[13] === "remaining_quantity";
      var hasMoney = actual[14] === "total_cost_minor";
      if (lotsPrefix13 && (hasRemaining || !actual[13])) {
        if (!hasRemaining && di3PreflightHasBodyValues_(sheet, 14, 1)) {
          issues.push("StockLots: колонка N содержит данные при пустом заголовке remaining_quantity. Миграция остановлена.");
        } else if (hasMoney || !actual[14]) {
          if (!hasMoney && di3PreflightHasBodyValues_(sheet, 15, 1)) {
            issues.push("StockLots: колонка O содержит данные при пустом заголовке total_cost_minor. Миграция остановлена.");
          } else {
            var addLots = [];
            if (!hasRemaining) addLots.push("remaining_quantity");
            if (!hasMoney) addLots.push("total_cost_minor");
            if (addLots.length) {
              planned.push({ type: "UPGRADE_SCHEMA", sheet: name, add_columns: addLots });
              warnings.push("StockLots: будут добавлены FIFO-поля " + addLots.join(", ") + ". Старые колонки останутся на месте.");
            }
          }
        } else {
          issues.push("StockLots: колонка O занята неизвестным заголовком «" + actual[14] + "». Миграция небезопасна.");
        }
        return;
      }
    }

    if (name === "StockAllocations") {
      var allocationPrefix13 = expected.slice(0, 13).every(function (header, index) { return actual[index] === header; });
      if (allocationPrefix13 && (!actual[13] || actual[13] === "allocated_cost_minor")) {
        if (!actual[13] && di3PreflightHasBodyValues_(sheet, 14, 1)) {
          issues.push("StockAllocations: колонка N содержит данные при пустом заголовке allocated_cost_minor. Миграция остановлена.");
        } else if (!actual[13]) {
          planned.push({ type: "UPGRADE_SCHEMA", sheet: name, add_columns: ["allocated_cost_minor"] });
          warnings.push("StockAllocations: будет добавлена allocated_cost_minor; значения создаются обязательным полным FIFO replay.");
        }
        return;
      }
    }

    var mismatchIndex = -1;
    for (var i = 0; i < expected.length; i++) {
      if (actual[i] !== expected[i]) { mismatchIndex = i; break; }
    }
    if (mismatchIndex >= 0) {
      issues.push(name + "! колонка " + (mismatchIndex + 1) + ": ожидался заголовок «" +
        expected[mismatchIndex] + "», найден «" + actual[mismatchIndex] + "».");
      return;
    }
    var lastColumn = sheet.getLastColumn();
    if (lastColumn > expected.length) {
      var extras = sheet.getRange(1, expected.length + 1, 1, lastColumn - expected.length).getDisplayValues()[0];
      if (extras.some(function (value) { return di3NormalizeHeader_(value) !== ""; })) {
        issues.push(name + ": обнаружены дополнительные заголовки справа от схемы.");
      }
    }
  });
  return { issues: issues, warnings: warnings, planned_changes: planned };
}

function di3PreflightWorkspaceSheets_() {
  var ss = di3GetSpreadsheet_();
  var issues = [];
  var warnings = [];
  var planned = [];
  function requireCell(sheetName, cell, expected, description) {
    var sheet = ss.getSheetByName(sheetName);
    if (!sheet || sheet.getLastRow() === 0) return;
    var actual = di3PreflightCellText_(sheet, cell);
    if (actual !== di3NormalizeHeader_(expected)) {
      issues.push("Лист «" + sheetName + "»: " + description + " — ожидалось «" + expected + "», найдено «" + actual + "».");
    }
  }
  function requireHeaders(sheetName, row, headers, description, startColumn) {
    var sheet = ss.getSheetByName(sheetName);
    if (!sheet || sheet.getLastRow() === 0) return;
    startColumn = Math.max(1, Number(startColumn) || 1);
    var actual = sheet.getRange(row, startColumn, 1, headers.length).getDisplayValues()[0].map(di3NormalizeHeader_);
    for (var i = 0; i < headers.length; i++) {
      if (actual[i] !== di3NormalizeHeader_(headers[i])) {
        issues.push("Лист «" + sheetName + "»: несовместимый заголовок " + description + " в колонке " + (startColumn + i) + ".");
        return;
      }
    }
  }

  var currentManager = ss.getSheetByName(DI3_WAREHOUSE_MANAGER_SHEET);
  var legacyManager = ss.getSheetByName(DI3_LEGACY_WAREHOUSE_MANAGER_SHEET);
  if (currentManager && legacyManager && currentManager.getSheetId() !== legacyManager.getSheetId()) {
    issues.push("Одновременно существуют листы «" + DI3_WAREHOUSE_MANAGER_SHEET + "» и «" + DI3_LEGACY_WAREHOUSE_MANAGER_SHEET + "». Автоматическое объединение небезопасно.");
  } else if (!currentManager && legacyManager) {
    planned.push({ type: "RENAME_WORKSPACE", from: DI3_LEGACY_WAREHOUSE_MANAGER_SHEET, to: DI3_WAREHOUSE_MANAGER_SHEET });
    if (legacyManager.getLastRow() > 0) {
      var legacyLabels = legacyManager.getRange("A3:A7").getDisplayValues().map(function (row) { return di3NormalizeHeader_(row[0]); });
      var expectedLabels = ["Тип движения", "Дата и время операции", "Товар", "Основание", "Количество, шт."];
      if (legacyLabels.some(function (label, index) { return label !== expectedLabels[index]; })) {
        issues.push("Лист «" + DI3_LEGACY_WAREHOUSE_MANAGER_SHEET + "» не соответствует известной структуре формы склада.");
      }
    }
  }

  // Product register supports the current 21-column layout, the previous 17/14-column layouts,
  // and the known pre-v3 editor/register layout. Old generated views are rebuilt from Products.
  var products = ss.getSheetByName(DI3_PRODUCTS_UI_SHEET);
  if (products && products.getLastRow() > 0) {
    var currentHeaders = di3PreflightHeaderRow_(products, 4, DI3_PRODUCTS_UI_COLUMN_COUNT);
    var expectedCurrent = DI3_PRODUCTS_UI_HEADERS.concat(DI3_PRODUCTS_FIFO_HEADERS);
    var isCurrent = currentHeaders.join("|") === expectedCurrent.join("|");

    var legacy17Headers = di3PreflightHeaderRow_(products, 4, 17);
    var expectedLegacy17 = DI3_PRODUCTS_UI_HEADERS_LEGACY_17.concat(DI3_PRODUCTS_FIFO_HEADERS);
    var isLegacy17 = legacy17Headers.join("|") === expectedLegacy17.join("|");

    var legacy14Headers = di3PreflightHeaderRow_(products, 4, 14);
    var expectedLegacy14 = DI3_PRODUCTS_UI_HEADERS_LEGACY_14.concat(DI3_PRODUCTS_FIFO_HEADERS.slice(0, 6));
    var isLegacy14 = legacy14Headers.join("|") === expectedLegacy14.join("|");

    var legacyRegister = products.getMaxRows() >= 14 && products.getMaxColumns() >= 18 &&
      di3PreflightCellText_(products, "A14") === di3NormalizeHeader_(DI3_PRODUCTS_UI_HEADERS_LEGACY_17[0]);

    if (!isCurrent && (isLegacy17 || isLegacy14)) {
      planned.push({ type: "UPGRADE_WORKSPACE", sheet: DI3_PRODUCTS_UI_SHEET,
        detail: "Перестроить видимый каталог на 21 колонку с характеристиками товара" });
    } else if (!isCurrent && legacyRegister) {
      planned.push({ type: "MIGRATE_WORKSPACE", sheet: DI3_PRODUCTS_UI_SHEET,
        detail: "Перенести старую карточку в отдельный лист и перестроить каталог" });
      warnings.push("Продукты: обнаружен известный старый макет карточки и реестра; перед запуском рекомендуется создать копию таблицы.");
    } else if (!isCurrent) {
      issues.push("Лист «" + DI3_PRODUCTS_UI_SHEET + "» не соответствует ни текущей, ни известной предыдущей структуре каталога.");
    }
  }

  requireCell(DI3_FINANCE_DASHBOARD_SHEET, "A1", "ФИНАНСЫ · АНАЛИТИКА ПРОДАЖ И ЗАКУПОК", "заголовок финансового Dashboard");
  requireHeaders(DI3_FINANCE_DASHBOARD_SHEET, 10, DI3_FINANCE_MONTH_HEADERS, "A10:J10");
  requireHeaders(DI3_FINANCE_DASHBOARD_SHEET, 10, DI3_FINANCE_PURCHASE_HEADERS, "K10:Q10", 11);
  requireCell(DI3_SETTINGS_WORKSPACE_SHEET, "A1", "НАСТРОЙКИ СИСТЕМЫ", "заголовок настроек");
  requireHeaders(DI3_SETTINGS_WORKSPACE_SHEET, 9, ["Месяц", "Код месяца"], "A9:B9");
  requireCell(DI3_PRODUCT_FORM_SHEET, "A1", "Карточка продукта", "заголовок формы");
  requireCell(DI3_PRODUCT_FORM_SHEET, "A4", "Товар для редактирования", "поле выбора товара");
  requireHeaders(DI3_SUPPLY_FORM_SHEET, 11, DI3_SUPPLY_LINE_HEADERS, "A11:J11");
  requireCell(DI3_WAREHOUSE_DASHBOARD_SHEET, "A1", "СКЛАД · ОБЗОР ЗАПАСОВ", "заголовок Dashboard");
  requireHeaders(DI3_STOCK_JOURNAL_SHEET, 7, DI3_STOCK_JOURNAL_HEADERS, "A7:N7");
  requireCell(DI3_FIFO_HISTORY_SHEET, "A1", "ИСТОРИЯ СЕБЕСТОИМОСТИ FIFO", "заголовок истории FIFO");
  var supplyRegister = ss.getSheetByName(DI3_SUPPLY_REGISTER_SHEET);
  if (supplyRegister && supplyRegister.getLastRow() > 0) {
    var legacySupplyHeaders = [
      "Номер поставки", "Продавец", "Статус", "Создана", "Отправлена",
      "Ожидает получения", "Получена", "Итого, ₽", "Комментарий", "supply_id",
      "Дата следующего этапа (необязательно)"
    ];
    var currentSupplyHeaders = di3PreflightHeaderRow_(supplyRegister, 3, DI3_SUPPLY_REGISTER_HEADERS.length);
    var previousOrderSupplyHeaders = di3PreflightHeaderRow_(supplyRegister, 3, DI3_SUPPLY_REGISTER_PREVIOUS_ORDER_HEADERS.length);
    var compatSupplyHeaders = di3PreflightHeaderRow_(supplyRegister, 3, DI3_SUPPLY_REGISTER_COMPAT_HEADERS.length);
    var previousSupplyHeaders = di3PreflightHeaderRow_(supplyRegister, 3, DI3_SUPPLY_REGISTER_PREVIOUS_HEADERS.length);
    var legacySupplyActual = di3PreflightHeaderRow_(supplyRegister, 3, legacySupplyHeaders.length);
    if (legacySupplyActual.join("|") === legacySupplyHeaders.join("|")) {
      planned.push({ type: "UPGRADE_WORKSPACE", sheet: DI3_SUPPLY_REGISTER_SHEET,
        detail: "Перестроить реестр: системная дата первой колонкой, затем даты этапов; перенести поле даты следующего этапа в M" });
      warnings.push("Реестр поставок: будет обновлена только видимая проекция из V3_Supplies; введённые даты следующего этапа сохранятся по supply_id.");
    } else if (previousOrderSupplyHeaders.join("|") === DI3_SUPPLY_REGISTER_PREVIOUS_ORDER_HEADERS.join("|")) {
      planned.push({ type: "UPGRADE_WORKSPACE", sheet: DI3_SUPPLY_REGISTER_SHEET,
        detail: "Переставить колонки по цепочке поставки и вывести автоматическую дату создания записи в системе первой; сортировать по дате оформления" });
      warnings.push("Реестр поставок: будут перестроены видимые колонки и строки; дата следующего этапа сохранится по supply_id, сортировка останется по дате оформления.");
    } else if (previousSupplyHeaders.join("|") === DI3_SUPPLY_REGISTER_PREVIOUS_HEADERS.join("|")) {
      planned.push({ type: "UPGRADE_WORKSPACE", sheet: DI3_SUPPLY_REGISTER_SHEET,
        detail: "Уточнить подписи дат, переставить колонки по цепочке поставки и сортировать по дате оформления" });
      warnings.push("Реестр поставок: изменится видимая проекция; дата следующего этапа сохранится по supply_id.");
    } else if (compatSupplyHeaders.join("|") === DI3_SUPPLY_REGISTER_COMPAT_HEADERS.join("|")) {
      planned.push({ type: "UPGRADE_WORKSPACE", sheet: DI3_SUPPLY_REGISTER_SHEET,
        detail: "Обновить структуру реестра по цепочке поставки и сохранить даты следующего этапа в M" });
      warnings.push("Реестр поставок: обновятся заголовки и порядок колонок; дата следующего этапа сохранится по supply_id.");
    } else if (currentSupplyHeaders.join("|") !== DI3_SUPPLY_REGISTER_HEADERS.join("|")) {
      issues.push("Лист «" + DI3_SUPPLY_REGISTER_SHEET + "» имеет неизвестную структуру реестра поставок.");
    }
  }
  requireHeaders(DI3_ORDER_FORM_SHEET, 11, [
    "Товар", "Количество, шт.", "Цена продажи, ₽ / шт. (пусто = цена каталога)"
  ], "A11:C11");

  var orderRegister = ss.getSheetByName(DI3_ORDER_REGISTER_SHEET);
  if (orderRegister && orderRegister.getLastRow() > 0) {
    var oldHeader = di3PreflightHeaderRow_(orderRegister, 3, DI3_ORDER_REGISTER_LEGACY_HEADERS.length);
    var newHeader = di3PreflightHeaderRow_(orderRegister, 3, DI3_ORDER_REGISTER_HEADERS.length);
    if (oldHeader.join("|") === DI3_ORDER_REGISTER_LEGACY_HEADERS.join("|")) {
      planned.push({ type: "MIGRATE_WORKSPACE", sheet: DI3_ORDER_REGISTER_SHEET, detail: "Перестроить известный 13-колоночный реестр заказов в 17-колоночный" });
      warnings.push("Реестр заказов: обнаружена известная старая структура; перед запуском рекомендуется создать копию таблицы.");
    } else if (newHeader.join("|") !== DI3_ORDER_REGISTER_HEADERS.join("|")) {
      issues.push("Лист «" + DI3_ORDER_REGISTER_SHEET + "» имеет неизвестную структуру реестра заказов.");
    }
  }

  return { issues: issues, warnings: warnings, planned_changes: planned };
}

/**
 * Dry Run installation preflight. Read-only: it never creates sheets, writes cells,
 * changes the spreadsheet time zone, installs triggers or mutates document properties.
 */
function di3DryRunInstallation() {
  var core = di3PreflightCoreSchemas_();
  var workspace = di3PreflightWorkspaceSheets_();
  var settings = typeof di3PreflightSettingsRepository_ === "function"
    ? di3PreflightSettingsRepository_() : { issues: [], warnings: [] };
  var schemaVersioning = typeof di3GetSchemaVersioningReport_ === "function"
    ? di3GetSchemaVersioningReport_() : { status: "READY", current_version: 0, target_version: 0, issues: [], warnings: [], planned_changes: [] };
  var timeZone = typeof di3PreflightTimeZoneConfig_ === "function"
    ? di3PreflightTimeZoneConfig_() : { issues: [], warnings: [], planned_changes: [] };
  var unknownTabs = di3PreflightUnknownPopulatedTabs_();
  var issues = core.issues.concat(workspace.issues, settings.issues, timeZone.issues, schemaVersioning.issues || [], unknownTabs.issues);
  var warnings = core.warnings.concat(workspace.warnings, settings.warnings, timeZone.warnings, schemaVersioning.warnings || [], unknownTabs.warnings);
  var planned = core.planned_changes.concat(workspace.planned_changes, timeZone.planned_changes, schemaVersioning.planned_changes || [], unknownTabs.planned_changes);
  return {
    status: issues.length ? "BLOCKED" : "READY",
    read_only: true,
    checked_at: new Date(),
    checked_system_sheets: DI3_CORE_TABLE_NAMES.length,
    checked_workbook_tabs: unknownTabs.checked_tabs,
    unexpected_populated_tabs: unknownTabs.unexpected_tabs,
    time_zone: timeZone,
    schema_versioning: schemaVersioning,
    issues: issues,
    warnings: warnings,
    planned_changes: planned,
    summary: issues.length
      ? "Установка заблокирована: обнаружены несовместимые листы или данные, которые могут быть затронуты миграцией."
      : "Предварительная проверка пройдена. Обнаруженные известные миграции перечислены в planned_changes."
  };
}

/** Menu wrapper: report Dry Run findings without changing workbook contents. */
function di3RunInstallationDryRun() {
  var report = di3DryRunInstallation();
  try {
    var message = report.status === "READY"
      ? report.summary + (report.warnings.length ? "\n" + report.warnings.join("\n") : "")
      : report.issues.join("\n");
    di3GetSpreadsheet_().toast(message, "Dry Run установки · " + report.status, 10);
  } catch (toastError) {}
  return report;
}
