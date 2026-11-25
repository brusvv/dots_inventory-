/** Dots Inventory v3 — historical FIFO valuation view (30/90/180 days). */
var DI3_FIFO_HISTORY_SHEET = "История FIFO";

function di3SetupFifoHistorySheet() {
  di3EnsureCoreFoundationSchemas_();
  var ss = di3GetSpreadsheet_();
  var sheet = ss.getSheetByName(DI3_FIFO_HISTORY_SHEET);
  var created = false;
  if (!sheet) { sheet = ss.insertSheet(DI3_FIFO_HISTORY_SHEET); di3PrepareNewSheet_(sheet, 6, 7); created = true; }
  if (created || sheet.getLastRow() === 0) {
    sheet.getRange("A1:G1").merge().setValue("ИСТОРИЯ СЕБЕСТОИМОСТИ FIFO");
    sheet.getRange("A2:G2").merge().setValue("Динамика остатка, средней себестоимости и оценочной стоимости по выбранному товару. Средняя цена при частичном покрытии относится только к оценённой части.");
    sheet.getRange("A3").setValue("Товар");
    sheet.getRange("B3").setValue("");
    sheet.getRange("C3").setValue("Период, дней");
    sheet.getRange("D3").setValue(30);
    sheet.getRange("A5:G5").merge().setValue("ИСТОРИЯ ПО ДНЯМ");
    sheet.getRange("A6:G6").setValues([[
      "Дата", "Остаток, шт.", "Оценено, шт.", "Не оценено, шт.",
      "Средняя FIFO, ₽/шт.", "Известная стоимость, ₽", "Покрытие, %"
    ]]);
    sheet.getRange("A1:G1").setBackground("#17243A").setFontColor("#FFFFFF").setFontWeight("bold").setFontSize(15);
    sheet.getRange("A2:G2").setBackground("#EAF0F7").setFontColor("#40516A");
    sheet.getRange("A3:D3").setBackground("#F3F6FA");
    sheet.getRange("A3").setFontWeight("bold");
    sheet.getRange("C3").setFontWeight("bold");
    sheet.getRange("A5:G5").setBackground("#1F6B62").setFontColor("#FFFFFF").setFontWeight("bold");
    sheet.getRange("A6:G6").setBackground("#253B59").setFontColor("#FFFFFF").setFontWeight("bold");
    di3SetFrozenRowsSafely_(sheet, 6);
    [150, 125, 125, 140, 175, 185, 125].forEach(function (w, i) { sheet.setColumnWidth(i + 1, w); });
    sheet.setRowHeight(1, 38);
    sheet.setRowHeight(2, 36);
  } else {
    var title = String(sheet.getRange("A1").getDisplayValue() || "");
    if (title !== "ИСТОРИЯ СЕБЕСТОИМОСТИ FIFO") throw new Error("Лист «История FIFO» уже существует с другой структурой.");
  }
  di3CompactSheet_(sheet, 6, 7);
  sheet.setHiddenGridlines(true);
  di3RefreshFifoHistoryProductOptions();
  // Re-apply dark text to existing history rows when upgrading an already-created sheet.
  var existingHistoryRows = Math.max(0, sheet.getLastRow() - 6);
  if (existingHistoryRows) sheet.getRange(7, 1, existingHistoryRows, 7).setFontColor("#202124");
  di3InstallWarehouseViewsTrigger_();
  return { status: "READY", sheet: DI3_FIFO_HISTORY_SHEET };
}

function di3RefreshFifoHistoryProductOptions() {
  var sheet = di3GetSpreadsheet_().getSheetByName(DI3_FIFO_HISTORY_SHEET);
  if (!sheet) throw new Error("Сначала создай лист «История FIFO».");
  var products = di3ListAllProductsForWarehouse_();
  var codes = di3GetProductPublicCodeMap_();
  var options = products.map(function (product) { return di3GetProductOptionLabelWithMap_(product, codes); });
  if (options.length) sheet.getRange("B3").setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(options, true).setAllowInvalid(false).build());
  else sheet.getRange("B3").clearDataValidations();
  sheet.getRange("D3").setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList([30, 90, 180], true).setAllowInvalid(false).build());
  if (!sheet.getRange("D3").getValue()) sheet.getRange("D3").setValue(30);
  return { products: options.length };
}

function di3RefreshFifoHistorySheet() {
  var sheet = di3GetSpreadsheet_().getSheetByName(DI3_FIFO_HISTORY_SHEET);
  if (!sheet) throw new Error("Сначала запусти di3SetupFifoHistorySheet().");
  var selected = String(sheet.getRange("B3").getValue() || "");
  var days = Number(sheet.getRange("D3").getValue() || 30);
  if ([30, 90, 180].indexOf(days) === -1) throw new Error("Выбери период 30, 90 или 180 дней.");
  var products = di3ListAllProductsForWarehouse_();
  var codes = di3GetProductPublicCodeMap_();
  var matches = products.filter(function (p) { return di3GetProductOptionLabelWithMap_(p, codes) === selected; });
  var oldCount = Math.max(0, sheet.getLastRow() - 6);
  if (oldCount) sheet.getRange(7, 1, oldCount, 7).clearContent();
  sheet.getCharts().forEach(function (chart) { sheet.removeChart(chart); });
  if (!selected) return { refreshed: true, rows: 0, reason: "PRODUCT_NOT_SELECTED" };
  if (matches.length !== 1) throw new Error("Не удалось однозначно определить товар. Обнови список.");
  var history = di3GetProductFifoValuationHistory(matches[0].product_id, days);
  var rows = history.map(function (point) {
    var average = point.average_unit_cost == null ? point.average_known_unit_cost : point.average_unit_cost;
    return [point.date, point.total_quantity, point.known_quantity, point.unknown_quantity,
      average == null ? "" : average, point.known_inventory_value,
      point.cost_coverage_pct / 100];
  });
  if (rows.length) {
    var chartRow = 9 + rows.length;
    di3EnsureSheetCapacity_(sheet, chartRow + 18, 7);
    sheet.getRange(7, 1, rows.length, 7).setValues(rows);
    sheet.getRange(7, 1, rows.length, 1).setNumberFormat("dd.mm.yyyy");
    sheet.getRange(7, 2, rows.length, 3).setNumberFormat("#,##0");
    sheet.getRange(7, 5, rows.length, 2).setNumberFormat("#,##0.00 ₽");
    sheet.getRange(7, 7, rows.length, 1).setNumberFormat("0.0%");
    sheet.getBandings().forEach(function (banding) { banding.remove(); });
    var historyBodyRange = sheet.getRange(7, 1, rows.length, 7);
    di3ApplyLightBandingWithDarkText_(historyBodyRange);
    var chart = sheet.newChart().asLineChart()
      .addRange(sheet.getRange(6, 1, rows.length + 1, 1))
      .addRange(sheet.getRange(6, 5, rows.length + 1, 1))
      .setPosition(chartRow, 1, 0, 0)
      .setOption("title", "Средняя себестоимость FIFO · " + days + " дней")
      .setOption("legend", { position: "none" })
      .setOption("width", 760)
      .setOption("height", 360)
      .build();
    sheet.insertChart(chart);
    di3CompactSheet_(sheet, chartRow + 18, 7);
  } else {
    di3CompactSheet_(sheet, 6, 7);
  }
  return { refreshed: true, rows: rows.length, product_id: matches[0].product_id, days: days };
}
