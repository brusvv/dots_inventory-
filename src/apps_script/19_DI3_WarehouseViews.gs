/**
 * Dots Inventory v3 — warehouse dashboard and stock movement journal.
 * User-facing management sheet is named "Управление складом".
 */
var DI3_WAREHOUSE_DASHBOARD_SHEET = "Склад";
var DI3_STOCK_JOURNAL_SHEET = "Журнал склада";
var DI3_DASHBOARD_TABLE_HEADER_ROW = 13;
var DI3_DASHBOARD_TABLE_START_ROW = 14;
var DI3_WAREHOUSE_VALUE_CHART_MAX_PRODUCTS = 20;
var DI3_WAREHOUSE_VALUE_CHART_HELPER_START_COLUMN = 14;

/**
 * Build a chart-only series from the visible warehouse rows.
 * Rows are kept as complete label/value pairs, filtered to fully valued positive stock,
 * sorted by inventory value descending, and capped at the configured Top-N size.
 * This avoids non-contiguous chart ranges that can misalign labels and values in Sheets.
 */
function di3BuildWarehouseValueChartData_(rows, maxItems) {
  var limit = Math.max(1, Math.min(50, Math.floor(Number(maxItems) || DI3_WAREHOUSE_VALUE_CHART_MAX_PRODUCTS)));
  return (rows || []).filter(function (row) {
    if (!row || row.length < 11) return false;
    var quantity = Number(row[2]);
    var knownQuantity = Number(row[3]);
    var value = row[6] === "" || row[6] == null ? NaN : Number(row[6]);
    // The dashboard table uses «Оценено» only when the full remaining stock is valued.
    return Number.isFinite(quantity) && quantity > 0 &&
      Number.isFinite(knownQuantity) && knownQuantity > 0 &&
      Number.isFinite(value) && value > 0 && String(row[10]) === "Оценено";
  }).slice().sort(function (a, b) {
    var byValue = Number(b[6]) - Number(a[6]);
    if (byValue) return byValue;
    var byLabel = String(a[1] || "").localeCompare(String(b[1] || ""));
    return byLabel || String(a[0] || "").localeCompare(String(b[0] || ""));
  }).slice(0, limit).map(function (row) {
    return [String(row[1] || row[0] || "Без названия"), Number(row[6])];
  });
}
var DI3_STOCK_JOURNAL_HEADER_ROW = 7;
var DI3_STOCK_JOURNAL_START_ROW = 8;
var DI3_STOCK_JOURNAL_HEADERS = [
  "Дата операции", "Код", "Движение", "Основание", "Товар", "Количество, шт.",
  "FIFO, ₽/шт.", "Себестоимость FIFO, ₽", "Цена продажи, ₽/шт.", "Выручка, ₽",
  "Оценка", "Источник", "Комментарий", "movement_id"
];
var DI3_STOCK_JOURNAL_FILTERS = Object.freeze({
  direction: "B3", from: "D3", to: "F3", reason: "H3", product: "B4", search: "D4"
});

function di3GetTargetGrossMargin_() {
  if (typeof di3GetSettingValue_ === "function") {
    var configured = di3GetSettingValue_("target_gross_margin", null);
    if (configured !== null && configured !== "") {
      var savedMargin = Number(configured);
      if (!Number.isFinite(savedMargin) || savedMargin < 0 || savedMargin >= 0.95) {
        throw new Error("В Settings повреждена целевая валовая маржа.");
      }
      return savedMargin;
    }
  }
  // Backward-compatible fallback for an older workbook before Settings migration.
  var sheet = di3GetSpreadsheet_().getSheetByName(DI3_WAREHOUSE_DASHBOARD_SHEET);
  if (!sheet) return 0.30;
  var value = sheet.getRange("B10").getValue();
  if (value === "" || value == null) return 0.30;
  var margin = Number(value);
  return Number.isFinite(margin) && margin >= 0 && margin < 0.95 ? margin : 0.30;
}

function di3StyleSectionTitle_(range) {
  range.setBackground("#17243A").setFontColor("#FFFFFF").setFontWeight("bold");
}

function di3SetupWarehouseDashboard() {
  di3EnsureCoreFoundationSchemas_();
  var ss = di3GetSpreadsheet_();
  var sheet = ss.getSheetByName(DI3_WAREHOUSE_DASHBOARD_SHEET);
  var created = false;
  if (!sheet) { sheet = ss.insertSheet(DI3_WAREHOUSE_DASHBOARD_SHEET); di3PrepareNewSheet_(sheet, 13, 13); created = true; }
  if (created || sheet.getLastRow() === 0) {
    sheet.getRange("A1:H1").merge();
    sheet.getRange("A1").setValue("СКЛАД · ОБЗОР ЗАПАСОВ");
    sheet.getRange("A2:H2").merge();
    sheet.getRange("A2").setValue("Фактические остатки, оценка FIFO и ориентиры для ценообразования. Неоценённые запасы показываются отдельно.");
    var cards = [
      ["A4:B4", "A5:B6", "Активные товары"],
      ["C4:D4", "C5:D6", "Единиц на складе"],
      ["E4:F4", "E5:F6", "Стоимость запасов"],
      ["G4:H4", "G5:H6", "Неоценённые единицы"]
    ];
    cards.forEach(function (card) {
      sheet.getRange(card[0]).merge().setValue(card[2]);
      sheet.getRange(card[1]).merge().setValue("—");
      sheet.getRange(card[0]).setBackground("#EAF0F7").setFontColor("#40516A").setFontWeight("bold");
      sheet.getRange(card[1]).setBackground("#F7F9FC").setFontSize(20).setFontWeight("bold").setVerticalAlignment("middle");
    });
    sheet.getRange("A8:H8").merge().setValue("Покрытие себестоимости и ценообразование");
    di3StyleSectionTitle_(sheet.getRange("A8:H8"));
    sheet.getRange("A10").setValue("Целевая валовая маржа");
    sheet.getRange("B10").setValue(di3GetTargetGrossMargin_()).setNumberFormat("0%");
    sheet.getRange("C10").setValue("Применяется к минимальной цене и допустимой скидке");
    sheet.getRange("C10:H10").merge();
    sheet.getRange("A11").setValue("Оценено единиц");
    sheet.getRange("B11").setValue("—");
    sheet.getRange("C11").setValue("Известная стоимость");
    sheet.getRange("D11").setValue("—");
    sheet.getRange("E11").setValue("Статус оценки");
    sheet.getRange("F11").setValue("—");
    sheet.getRange("G11").setValue("Средняя FIFO");
    sheet.getRange("H11").setValue("—");
    sheet.getRange("A13:M13").setValues([[
      "Код", "Товар", "Остаток", "Оценено", "Не оценено", "Средняя FIFO, ₽/шт.",
      "Стоимость, ₽", "Цена продажи, ₽", "Мин. цена по средней, ₽", "Макс. скидка, ₽", "Статус",
      "След. FIFO, ₽/шт.", "Мин. цена след. FIFO, ₽"
    ]]);
    sheet.getRange("A1:H1").setBackground("#17243A").setFontColor("#FFFFFF").setFontWeight("bold").setFontSize(16);
    sheet.getRange("A2:H2").setBackground("#EAF0F7").setFontColor("#40516A");
    sheet.getRange("A13:K13").setBackground("#253B59").setFontColor("#FFFFFF").setFontWeight("bold");
    sheet.getRange("L13:M13").setBackground("#475569").setFontColor("#FFFFFF").setFontWeight("bold");
    di3SetFrozenRowsSafely_(sheet, 13);
    [115, 260, 105, 105, 115, 150, 145, 140, 145, 140, 125, 130, 155].forEach(function (w, i) { sheet.setColumnWidth(i + 1, w); });
    sheet.setRowHeight(1, 38);
    sheet.setRowHeight(2, 34);
    sheet.setRowHeights(5, 2, 28);
  } else {
    var title = String(sheet.getRange("A1").getDisplayValue() || "");
    if (title !== "СКЛАД · ОБЗОР ЗАПАСОВ") throw new Error("Лист «Склад» уже существует с другой структурой. Автоматическая перезапись запрещена.");
  }
  sheet.getCharts().forEach(function (chart) { sheet.removeChart(chart); });
  di3EnsureSheetCapacity_(sheet, Math.max(13, sheet.getLastRow()), 13);
  sheet.getRange("A13:M13").setValues([[
    "Код", "Товар", "Остаток", "Оценено", "Не оценено", "Средняя FIFO, ₽/шт.",
    "Стоимость, ₽", "Цена продажи, ₽", "Мин. цена по средней, ₽", "Макс. скидка, ₽", "Статус",
    "След. FIFO, ₽/шт.", "Мин. цена след. FIFO, ₽"
  ]]);
  sheet.getRange("L13:M13").setBackground("#475569").setFontColor("#FFFFFF").setFontWeight("bold");
  di3CompactSheet_(sheet, Math.max(13, sheet.getLastRow()), 13);
  sheet.setHiddenGridlines(true);
  sheet.getRange("B10").setDataValidation(SpreadsheetApp.newDataValidation().requireNumberBetween(0, 0.9499).setAllowInvalid(false).build());
  sheet.getRange("B10").setValue(di3GetTargetGrossMargin_()).setNumberFormat("0%");
  di3RefreshWarehouseDashboard();
  return { status: "READY", sheet: DI3_WAREHOUSE_DASHBOARD_SHEET };
}

/**
 * Read-only runtime diagnostics for the Top-20 warehouse chart.
 * Run from the Apps Script editor and inspect the execution log; no sheet data is changed.
 */
function di3DiagnoseWarehouseDashboardChart() {
  var sheet = di3GetSpreadsheet_().getSheetByName(DI3_WAREHOUSE_DASHBOARD_SHEET);
  if (!sheet) throw new Error("Лист «Склад» не найден.");
  var helper = sheet.getRange(1, DI3_WAREHOUSE_VALUE_CHART_HELPER_START_COLUMN,
    DI3_WAREHOUSE_VALUE_CHART_MAX_PRODUCTS + 1, 2);
  var charts = sheet.getCharts();
  return {
    sheet: sheet.getName(),
    last_row: sheet.getLastRow(),
    max_rows: sheet.getMaxRows(),
    max_columns: sheet.getMaxColumns(),
    helper_range: helper.getA1Notation(),
    helper_hidden: {
      labels: sheet.isColumnHiddenByUser(DI3_WAREHOUSE_VALUE_CHART_HELPER_START_COLUMN),
      values: sheet.isColumnHiddenByUser(DI3_WAREHOUSE_VALUE_CHART_HELPER_START_COLUMN + 1)
    },
    helper_display_values: helper.getDisplayValues(),
    helper_raw_values: helper.getValues(),
    chart_count: charts.length,
    charts: charts.map(function (chart) {
      var ranges = [];
      try {
        ranges = chart.getRanges().map(function (range) { return range.getA1Notation(); });
      } catch (ignoreRanges) {}
      var position = null;
      try {
        var info = chart.getContainerInfo();
        position = { anchor_row: info.getAnchorRow(), anchor_column: info.getAnchorColumn() };
      } catch (ignorePosition) {}
      var type = "";
      try { type = String(chart.getChartType()); } catch (ignoreType) {}
      return { ranges: ranges, chart_type: type, position: position };
    })
  };
}

function di3LogWarehouseDashboardChartDiagnostics() {
  var result = di3DiagnoseWarehouseDashboardChart();
  Logger.log(JSON.stringify(result, null, 2));
  return result;
}

function di3RefreshWarehouseDashboard() {
  var sheet = di3GetSpreadsheet_().getSheetByName(DI3_WAREHOUSE_DASHBOARD_SHEET);
  if (!sheet) throw new Error("Сначала запусти di3SetupWarehouseDashboard().");
  var margin = di3GetTargetGrossMargin_();
  var data = di3GetWarehouseDashboardData(margin);
  var totals = data.totals;
  var warningText = data.warning || "Данные актуальны. Все складские операции подтверждены.";
  sheet.getRange("A3:H3").setBackground(data.pending_operations.length ? "#FEF3C7" : "#EAF0F7").setFontColor(data.pending_operations.length ? "#92400E" : "#40516A");
  sheet.getRange("A3").setValue(warningText);
  var cards = [
    ["A5", totals.products == null ? 0 : data.products.filter(function (p) { return p.active; }).length],
    ["C5", totals.stock_units == null ? "Проверка" : totals.stock_units],
    ["E5", totals.inventory_value == null ? (data.pending_operations.length ? "Ожидает сверки" : "Неполная оценка") : totals.inventory_value],
    ["G5", totals.unknown_units == null ? "—" : totals.unknown_units]
  ];
  cards.forEach(function (item) { sheet.getRange(item[0]).setValue(item[1]); });
  sheet.getRange("E5").setNumberFormat("#,##0.00 ₽");
  sheet.getRange("B11").setValue(totals.known_units == null ? "—" : totals.known_units);
  sheet.getRange("D11").setValue(totals.known_inventory_value == null ? "—" : totals.known_inventory_value).setNumberFormat("#,##0.00 ₽");
  sheet.getRange("F11").setValue(data.pending_operations.length ? "Ожидает сверки" : (totals.unknown_units > 0 ? "Частичная" : "Полная"));
  sheet.getRange("H11").setValue(totals.average_known_unit_cost == null ? "—" : totals.average_known_unit_cost);
  sheet.getRange("H11").setNumberFormat("#,##0.00 ₽");

  var rows = data.products.filter(function (p) { return p.active; }).map(function (p) {
    return [p.product_code, p.label, p.stock_quantity, p.known_quantity, p.unknown_quantity,
      p.average_fifo_cost == null ? (p.average_known_fifo_cost == null ? "" : p.average_known_fifo_cost) : p.average_fifo_cost,
      p.inventory_value == null ? "" : p.inventory_value,
      p.current_sale_price == null ? "" : p.current_sale_price,
      p.minimum_sale_price == null ? "" : p.minimum_sale_price,
      p.maximum_discount_per_unit == null ? "" : p.maximum_discount_per_unit,
      p.valuation_status === "COMPLETE" ? "Оценено" : (p.valuation_status === "EMPTY" ? "Нет остатка" : "Неполная оценка"),
      p.next_fifo_unit_cost == null ? "" : p.next_fifo_unit_cost,
      p.next_fifo_minimum_sale_price == null ? "" : p.next_fifo_minimum_sale_price];
  }).sort(function (a, b) { return Number(b[2]) - Number(a[2]) || String(a[1]).localeCompare(String(b[1])); });
  var start = DI3_DASHBOARD_TABLE_START_ROW;
  var oldCount = Math.max(0, sheet.getLastRow() - start + 1);
  di3EnsureSheetCapacity_(sheet, Math.max(13, start + rows.length - 1), 13);
  if (oldCount) sheet.getRange(start, 1, oldCount, 13).clearContent();
  sheet.getBandings().forEach(function (banding) { banding.remove(); });
  if (rows.length) {
    sheet.getRange(start, 1, rows.length, 13).setValues(rows);
    sheet.getRange(start, 3, rows.length, 3).setNumberFormat("#,##0");
    sheet.getRange(start, 6, rows.length, 5).setNumberFormat("#,##0.00 ₽");
    sheet.getRange(start, 12, rows.length, 2).setNumberFormat("#,##0.00 ₽");
    sheet.getRange(start, 11, rows.length, 1).setFontWeight("bold");
    di3ApplyLightBandingWithDarkText_(sheet.getRange(start, 1, rows.length, 13));
  }
  // The chart uses one contiguous, hidden helper range with paired labels and values.
  // This deliberately avoids separate non-adjacent ranges (B and G), which can cause
  // Google Sheets to associate category labels with the wrong series rows.
  sheet.getCharts().forEach(function (chart) { sheet.removeChart(chart); });
  var chartPairs = di3BuildWarehouseValueChartData_(rows, DI3_WAREHOUSE_VALUE_CHART_MAX_PRODUCTS);
  var chartRow = Math.max(15, start + rows.length + 2);
  var helperColumn = DI3_WAREHOUSE_VALUE_CHART_HELPER_START_COLUMN;
  if (sheet.getMaxColumns() >= helperColumn + 1) {
    di3EnsureSheetCapacity_(sheet, DI3_WAREHOUSE_VALUE_CHART_MAX_PRODUCTS + 1, helperColumn + 1);
    sheet.getRange(1, helperColumn, DI3_WAREHOUSE_VALUE_CHART_MAX_PRODUCTS + 1, 2).clearContent();
  }
  if (chartPairs.length > 0) {
    var chartMatrix = [["Товар", "Стоимость оценённых остатков, ₽"]].concat(chartPairs);
    var chartHeight = Math.max(340, Math.min(480, 180 + chartPairs.length * 15));
    var chartRows = Math.ceil(chartHeight / 21) + 2;
    di3EnsureSheetCapacity_(sheet, chartRow + chartRows, helperColumn + 1);
    sheet.getRange(1, helperColumn, chartMatrix.length, 2).setValues(chartMatrix);
    sheet.getRange(2, helperColumn + 1, chartPairs.length, 1).setNumberFormat("#,##0.00 ₽");
    sheet.hideColumns(helperColumn, 2);
    // Keep bar-specific calls on EmbeddedBarChartBuilder. Methods such as
    // addRange()/setNumHeaders()/setHiddenDimensionStrategy() return the base
    // EmbeddedChartBuilder, which does not expose reverseCategories().
    var chartBuilder = sheet.newChart().asBarChart();
    chartBuilder.reverseCategories();
    var chart = chartBuilder
      .addRange(sheet.getRange(1, helperColumn, chartMatrix.length, 2))
      // One header row; for a two-column range the first text column is the domain.
      .setNumHeaders(1)
      // The chart source is intentionally hidden; explicitly include hidden dimensions.
      .setHiddenDimensionStrategy(Charts.ChartHiddenDimensionStrategy.SHOW_BOTH)
      .setPosition(chartRow, 1, 0, 0)
      .setOption("title", "Топ-20 товаров по стоимости оценённых остатков")
      .setOption("legend", { position: "none" })
      .setOption("width", 980)
      .setOption("height", chartHeight)
      .setOption("chartArea", { left: 285, top: 42, width: "68%", height: "82%" })
      .setOption("hAxis", { title: "Стоимость, ₽", minValue: 0, format: "#,##0" })
      .build();
    sheet.insertChart(chart);
    di3CompactSheet_(sheet, chartRow + chartRows, helperColumn + 1);
  } else {
    if (!data.pending_operations.length) {
      sheet.getRange("A3").setValue(String(warningText || "Данные актуальны.") +
        " Нет товаров с положительной полностью оценённой стоимостью остатков; неоценённые единицы показаны отдельно.");
    }
    di3CompactSheet_(sheet, Math.max(13, start + rows.length - 1), 13);
  }
  return {
    refreshed: true,
    products: rows.length,
    totals: totals,
    chart_products: chartPairs.length,
    chart_limit: DI3_WAREHOUSE_VALUE_CHART_MAX_PRODUCTS,
    chart_sorted_by: "inventory_value_desc",
    chart_excludes_empty_and_unvalued: true
  };
}

function di3SetupStockJournalSheet() {
  di3EnsureCoreFoundationSchemas_();
  var ss = di3GetSpreadsheet_();
  var sheet = ss.getSheetByName(DI3_STOCK_JOURNAL_SHEET);
  var created = false;
  if (!sheet) { sheet = ss.insertSheet(DI3_STOCK_JOURNAL_SHEET); di3PrepareNewSheet_(sheet, 7, 14); created = true; }
  if (created || sheet.getLastRow() === 0) {
    sheet.getRange("A1:N1").merge().setValue("ЖУРНАЛ СКЛАДА");
    sheet.getRange("A2:N2").merge().setValue("История движений неизменяема. Ошибки исправляются обратным и новым движением, а не редактированием старой записи.");
    sheet.getRange("A3").setValue("Направление");
    sheet.getRange("B3").setValue("Все");
    sheet.getRange("C3").setValue("С даты");
    sheet.getRange("E3").setValue("По дату");
    sheet.getRange("G3").setValue("Основание");
    sheet.getRange("H3").setValue("Все");
    sheet.getRange("A4").setValue("Товар");
    sheet.getRange("B4").setValue("Все");
    sheet.getRange("C4").setValue("Поиск");
    sheet.getRange("D4:F4").merge();
    sheet.getRange("D4").setValue("");
    sheet.getRange("A7:N7").setValues([DI3_STOCK_JOURNAL_HEADERS]);
    sheet.getRange("A1:N1").setBackground("#17243A").setFontColor("#FFFFFF").setFontWeight("bold").setFontSize(14);
    sheet.getRange("A2:N2").setBackground("#EAF0F7").setFontColor("#40516A");
    sheet.getRange("A3:H4").setBackground("#F3F6FA");
    sheet.getRange("A3:A4").setFontWeight("bold");
    sheet.getRange("C3").setFontWeight("bold");
    sheet.getRange("E3").setFontWeight("bold");
    sheet.getRange("G3").setFontWeight("bold");
    sheet.getRange("A7:N7").setBackground("#253B59").setFontColor("#FFFFFF").setFontWeight("bold");
    di3SetFrozenRowsSafely_(sheet, 7);
    [165, 110, 105, 190, 290, 115, 150, 160, 150, 145, 130, 145, 320, 180].forEach(function (w, i) { sheet.setColumnWidth(i + 1, w); });
    sheet.setRowHeight(1, 36);
    sheet.setRowHeight(2, 32);
  } else {
    var actual = sheet.getRange("A7:N7").getDisplayValues()[0];
    DI3_STOCK_JOURNAL_HEADERS.forEach(function (h, i) {
      if (actual[i] !== h) throw new Error("Лист «Журнал склада» имеет несовместимые заголовки. Автоматическая перезапись запрещена.");
    });
  }
  di3RefreshStockJournalFilters();
  di3CompactSheet_(sheet, 7, 14);
  sheet.setHiddenGridlines(true);
  di3RefreshStockJournal();
  di3InstallWarehouseViewsTrigger_();
  return { status: "READY", sheet: DI3_STOCK_JOURNAL_SHEET };
}

function di3RefreshStockJournalFilters() {
  var sheet = di3GetSpreadsheet_().getSheetByName(DI3_STOCK_JOURNAL_SHEET);
  if (!sheet) throw new Error("Сначала создай журнал склада.");
  var products = di3ListAllProductsForWarehouse_();
  var codes = di3GetProductPublicCodeMap_();
  var productOptions = ["Все"].concat(products.map(function (p) { return di3GetProductOptionLabelWithMap_(p, codes); }));
  var reasons = ["Все"];
  ["IN", "OUT"].forEach(function (direction) {
    Object.keys(DI3_STOCK_REASON_LABELS[direction]).forEach(function (key) {
      var label = DI3_STOCK_REASON_LABELS[direction][key];
      if (reasons.indexOf(label) === -1) reasons.push(label);
    });
  });
  sheet.getRange("B3").setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(["Все", "Приход", "Расход"], true).setAllowInvalid(false).build());
  try {
    var dateRule = SpreadsheetApp.newDataValidation().requireDate().setAllowInvalid(false).build();
    sheet.getRange("D3").setDataValidation(dateRule).setNumberFormat("dd.mm.yyyy");
    sheet.getRange("F3").setDataValidation(dateRule).setNumberFormat("dd.mm.yyyy");
  } catch (dateValidationError) { /* Date filters remain available as manual date cells in limited test runtimes. */ }
  sheet.getRange("H3").setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(reasons, true).setAllowInvalid(false).build());
  sheet.getRange("B4").setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(productOptions, true).setAllowInvalid(false).build());
  if (!sheet.getRange("B3").getValue()) sheet.getRange("B3").setValue("Все");
  if (!sheet.getRange("H3").getValue()) sheet.getRange("H3").setValue("Все");
  if (!sheet.getRange("B4").getValue()) sheet.getRange("B4").setValue("Все");
  return { products: products.length, reasons: reasons.length - 1 };
}

function di3BuildStockJournalRows_() {
  di3AssertNoPendingStockOperations_();
  var ledger = di3ReadTableValues_("StockLedger");
  var details = di3ReadTableValues_("StockMovementDetails");
  var lots = di3ReadTableValues_("StockLots");
  var active = di3GetActiveRunAllocations_();
  var products = di3LoadProductsIndex_().byId;
  var codes = di3GetProductPublicCodeMap_();
  var detailById = {};
  details.forEach(function (r) { detailById[String(r[0])] = r; });
  var lotByMovement = {};
  lots.forEach(function (r) { lotByMovement[String(r[2])] = r; });
  var costByMovement = {};
  active.rows.forEach(function (r) {
    if (String(r[5]) !== "CONSUME") return;
    var id = String(r[2]);
    if (!costByMovement[id]) costByMovement[id] = { knownQty: 0, unknownQty: 0, knownCostMinor: 0 };
    var c = costByMovement[id];
    var qty = Number(r[6]) || 0;
    if (String(r[8]) === "UNKNOWN") c.unknownQty += qty;
    else { c.knownQty += qty; c.knownCostMinor += Number(di3MoneyGetAllocationCostMinor_(r) || 0); }
  });
  return ledger.map(function (r) {
    var id = String(r[0]);
    var detail = detailById[id] || [];
    var product = products[String(r[3])] || {};
    var movementType = String(detail[2] || (Number(r[6]) >= 0 ? "IN" : "OUT"));
    var reasonCode = String(detail[3] || "");
    var automaticReasons = {
      SUPPLY_RECEIVE: "Приёмка поставки",
      ORDER_DISPATCH: "Отправка заказа",
      ORDER_RETURN: "Возврат заказа"
    };
    var reason = (DI3_STOCK_REASON_LABELS[movementType] || {})[reasonCode] || automaticReasons[reasonCode] || reasonCode || "—";
    var quantity = Math.abs(Number(r[6]) || 0);
    var unitCost = null;
    var totalCost = null;
    var valuationStatus = "UNKNOWN";
    if (movementType === "IN") {
      var lot = lotByMovement[id];
      if (lot) {
        valuationStatus = String(lot[10] || "UNKNOWN");
        unitCost = lot[9] === "" || lot[9] == null ? null : Number(lot[9]);
        var totalCostMinor = di3MoneyGetLotTotalCostMinor_(lot);
        totalCost = totalCostMinor == null ? null : di3MoneyFromMinorUnits_(totalCostMinor);
      }
    } else {
      var cost = costByMovement[id] || { knownQty: 0, unknownQty: quantity, knownCostMinor: 0 };
      valuationStatus = cost.unknownQty ? (cost.knownQty ? "PARTIAL" : "UNKNOWN") : "KNOWN";
      var knownCost = di3MoneyFromMinorUnits_(cost.knownCostMinor);
      unitCost = cost.knownQty > 0 ? knownCost / cost.knownQty : null;
      totalCost = cost.unknownQty ? null : knownCost;
    }
    var productLabel = product.product_id ? di3GetProductLabel_(product) : ("Неизвестный товар · " + String(r[3]));
    return {
      effective_at: r[7], recorded_at: r[8], movement_id: id,
      display_code: detail[1] || "", movement_type: movementType,
      reason: reason, product_label: productLabel,
      product_option: product.product_id ? (codes[String(product.product_id)] || "") + " | " + productLabel : productLabel,
      quantity: quantity, unit_cost: unitCost, total_cost: totalCost,
      unit_sale_price: detail[4] === "" || detail[4] == null ? null : di3MoneyFromMinorUnits_(di3MoneyToMinorUnits_(detail[4], "Цена продажи", false)),
      revenue: detail[5] === "" || detail[5] == null ? null : di3MoneyFromMinorUnits_(di3MoneyToMinorUnits_(detail[5], "Выручка", false)),
      valuation_status: valuationStatus,
      source: detail[10] || r[4] || "", note: detail[9] || r[11] || "",
      product_id: String(r[3] || "")
    };
  }).sort(function (a, b) {
    var dateDiff = di3ToMillis_(b.effective_at) - di3ToMillis_(a.effective_at);
    if (dateDiff) return dateDiff;
    return di3ToMillis_(b.recorded_at) - di3ToMillis_(a.recorded_at);
  });
}

function di3RefreshStockJournal() {
  var sheet = di3GetSpreadsheet_().getSheetByName(DI3_STOCK_JOURNAL_SHEET);
  if (!sheet) throw new Error("Сначала запусти di3SetupStockJournalSheet().");
  var directionFilter = String(sheet.getRange(DI3_STOCK_JOURNAL_FILTERS.direction).getValue() || "Все");
  var fromValue = sheet.getRange(DI3_STOCK_JOURNAL_FILTERS.from).getValue();
  var toValue = sheet.getRange(DI3_STOCK_JOURNAL_FILTERS.to).getValue();
  var reasonFilter = String(sheet.getRange(DI3_STOCK_JOURNAL_FILTERS.reason).getValue() || "Все");
  var productFilter = String(sheet.getRange(DI3_STOCK_JOURNAL_FILTERS.product).getValue() || "Все");
  var search = String(sheet.getRange(DI3_STOCK_JOURNAL_FILTERS.search).getValue() || "").toLowerCase().trim();
  var rows = di3BuildStockJournalRows_().filter(function (r) {
    var direction = r.movement_type === "IN" ? "Приход" : "Расход";
    if (directionFilter !== "Все" && direction !== directionFilter) return false;
    if (reasonFilter !== "Все" && r.reason !== reasonFilter) return false;
    if (productFilter !== "Все" && r.product_option !== productFilter) return false;
    var time = di3ToMillis_(r.effective_at);
    if (fromValue instanceof Date && time < new Date(fromValue.getFullYear(), fromValue.getMonth(), fromValue.getDate()).getTime()) return false;
    if (toValue instanceof Date && time > new Date(toValue.getFullYear(), toValue.getMonth(), toValue.getDate(), 23, 59, 59, 999).getTime()) return false;
    if (search) {
      var haystack = [r.display_code, r.reason, r.product_label, r.source, r.note, r.movement_id].join(" ").toLowerCase();
      if (haystack.indexOf(search) === -1) return false;
    }
    return true;
  });
  var output = rows.map(function (r) {
    var status = r.valuation_status === "KNOWN" || r.valuation_status === "FREE" ? "Оценено" :
      (r.valuation_status === "PARTIAL" ? "Частично" : "Не оценено");
    return [r.effective_at, r.display_code, r.movement_type === "IN" ? "Приход" : "Расход", r.reason,
      r.product_label, r.quantity, r.unit_cost == null ? "" : r.unit_cost,
      r.total_cost == null ? "" : r.total_cost, r.unit_sale_price == null ? "" : r.unit_sale_price,
      r.revenue == null ? "" : r.revenue, status, r.source, r.note, r.movement_id];
  });
  var start = DI3_STOCK_JOURNAL_START_ROW;
  var oldCount = Math.max(0, sheet.getLastRow() - start + 1);
  di3EnsureSheetCapacity_(sheet, Math.max(7, start + output.length - 1), DI3_STOCK_JOURNAL_HEADERS.length);
  if (oldCount) sheet.getRange(start, 1, oldCount, DI3_STOCK_JOURNAL_HEADERS.length).clearContent();
  if (output.length) {
    sheet.getRange(start, 1, output.length, DI3_STOCK_JOURNAL_HEADERS.length).setValues(output);
    sheet.getRange(start, 1, output.length, 1).setNumberFormat("dd.mm.yyyy hh:mm");
    sheet.getRange(start, 6, output.length, 1).setNumberFormat("#,##0");
    sheet.getRange(start, 7, output.length, 4).setNumberFormat("#,##0.00 ₽");
    sheet.getRange(start, 11, output.length, 1).setFontWeight("bold");
    sheet.getBandings().forEach(function (banding) { banding.remove(); });
    di3ApplyLightBandingWithDarkText_(sheet.getRange(start, 1, output.length, DI3_STOCK_JOURNAL_HEADERS.length));
  } else {
    sheet.getBandings().forEach(function (banding) { banding.remove(); });
  }
  sheet.hideColumns(14);
  di3CompactSheet_(sheet, Math.max(7, start + output.length - 1), DI3_STOCK_JOURNAL_HEADERS.length);
  return { refreshed: true, movements: output.length, max_rows: sheet.getMaxRows(), max_columns: sheet.getMaxColumns() };
}

function di3ClearStockJournalFilters() {
  var sheet = di3GetSpreadsheet_().getSheetByName(DI3_STOCK_JOURNAL_SHEET);
  if (!sheet) return { cleared: false };
  sheet.getRange("D3").clearContent();
  sheet.getRange("F3").clearContent();
  sheet.getRange("D4").clearContent();
  sheet.getRange("B3").setValue("Все");
  sheet.getRange("H3").setValue("Все");
  sheet.getRange("B4").setValue("Все");
  return di3RefreshStockJournal();
}

function di3InstallWarehouseViewsTrigger_() {
  return di3InstallUnifiedEditTrigger_();
}

function di3WarehouseViewsOnEdit(e) {
  if (!e || !e.range) return;
  var sheet = e.range.getSheet();
  var name = sheet.getName();
  if (name === DI3_WAREHOUSE_DASHBOARD_SHEET && e.range.getA1Notation() === "B10") {
    try {
      di3SetTargetGrossMargin_(sheet.getRange("B10").getValue());
    } catch (marginError) {
      sheet.getRange("B10").setValue(di3GetTargetGrossMargin_());
      try { di3GetSpreadsheet_().toast(marginError.message || String(marginError), "Настройки маржи", 8); } catch (toastError) {}
    }
    di3RefreshWarehouseDashboard();
    return;
  }
  if (name === DI3_STOCK_JOURNAL_SHEET) {
    var cell = e.range.getA1Notation();
    if (["B3", "D3", "F3", "H3", "B4", "D4"].indexOf(cell) !== -1) di3RefreshStockJournal();
  }
  if (name === DI3_FIFO_HISTORY_SHEET && ["B3", "D3"].indexOf(e.range.getA1Notation()) !== -1) {
    di3RefreshFifoHistorySheet();
  }
}

function di3RefreshWarehouseViews() {
  return {
    dashboard: di3RefreshWarehouseDashboard(),
    journal: di3RefreshStockJournal(),
    products: di3RefreshProductsSheet(),
    fifo_history: di3RefreshFifoHistorySheet()
  };
}

function di3OpenWarehouseDashboard() {
  var sheet = di3GetSpreadsheet_().getSheetByName(DI3_WAREHOUSE_DASHBOARD_SHEET);
  if (!sheet) throw new Error('Лист «Склад» не найден. Запусти setupDotsInventoryV3().');
  di3GetSpreadsheet_().setActiveSheet(sheet);
  return { opened: true, sheet: DI3_WAREHOUSE_DASHBOARD_SHEET };
}

function di3OpenStockJournal() {
  var sheet = di3GetSpreadsheet_().getSheetByName(DI3_STOCK_JOURNAL_SHEET);
  if (!sheet) throw new Error('Лист «Журнал склада» не найден. Запусти setupDotsInventoryV3().');
  di3GetSpreadsheet_().setActiveSheet(sheet);
  return { opened: true, sheet: DI3_STOCK_JOURNAL_SHEET };
}

function di3RefreshWarehouseViewsAfterCommit_(sourceLabel) {
  try {
    return di3RefreshWarehouseViews();
  } catch (error) {
    var message = error && error.message ? error.message : String(error);
    try { di3GetSpreadsheet_().toast('Операция проведена, но обновление представлений не удалось: ' + message, sourceLabel || 'Склад', 8); } catch (ignore) {}
    return { refreshed: false, error: message };
  }
}

function di3OpenFifoHistorySheet() {
  var sheet = di3GetSpreadsheet_().getSheetByName(DI3_FIFO_HISTORY_SHEET);
  if (!sheet) throw new Error('Лист «История FIFO» не найден. Запусти setupDotsInventoryV3().');
  di3GetSpreadsheet_().setActiveSheet(sheet);
  return { opened: true, sheet: DI3_FIFO_HISTORY_SHEET };
}

function di3RefreshDependentCatalogViews_() {
  var ss = di3GetSpreadsheet_();
  var results = {};
  if (ss.getSheetByName(DI3_WAREHOUSE_DASHBOARD_SHEET)) results.dashboard = di3RefreshWarehouseDashboard();
  if (ss.getSheetByName(DI3_STOCK_JOURNAL_SHEET)) results.journal_filters = di3RefreshStockJournalFilters();
  if (typeof DI3_FIFO_HISTORY_SHEET !== "undefined" && ss.getSheetByName(DI3_FIFO_HISTORY_SHEET)) {
    results.fifo_history_products = di3RefreshFifoHistoryProductOptions();
  }
  if (ss.getSheetByName(DI3_PRODUCT_FORM_SHEET)) results.product_form_options = di3RefreshProductFormValidations();
  return results;
}
