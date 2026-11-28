/**
 * Read-only diagnostics for the actual warehouse chart source and live builder.
 * Run AFTER di3RefreshWarehouseDashboard(). Does not write to any sheet.
 */
function di3LogWarehouseDashboardChartOrderDiagnostics() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss && ss.getSheetByName("Склад");
  if (!sheet) throw new Error('Лист "Склад" не найден.');

  var helperColumn = DI3_WAREHOUSE_VALUE_CHART_HELPER_START_COLUMN;
  var maxItems = DI3_WAREHOUSE_VALUE_CHART_MAX_PRODUCTS;
  var helperRange = sheet.getRange(1, helperColumn, maxItems + 1, 2);
  var source = helperRange.getValues();
  var populated = source.slice(1).filter(function (row) {
    return row[0] !== "" || row[1] !== "";
  });

  // Rebuild the exact row shape used by di3RefreshWarehouseDashboard(),
  // then call the builder that is actually loaded in this Apps Script project.
  var margin = di3GetTargetGrossMargin_();
  var data = di3GetWarehouseDashboardData(margin);
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
  }).sort(function (a, b) {
    return Number(b[2]) - Number(a[2]) || String(a[1]).localeCompare(String(b[1]));
  });
  var independentPairs = rows.filter(function (row) {
    var quantity = Number(row[2]);
    var knownQuantity = Number(row[3]);
    var value = row[6] === "" || row[6] == null ? NaN : Number(row[6]);
    return Number.isFinite(quantity) && quantity > 0 &&
      Number.isFinite(knownQuantity) && knownQuantity > 0 &&
      Number.isFinite(value) && value > 0 && String(row[10]) === "Оценено";
  }).slice().sort(function (a, b) {
    return Number(b[6]) - Number(a[6]);
  }).slice(0, maxItems).map(function (row) {
    return [String(row[1] || row[0] || "Без названия"), Number(row[6])];
  });
  var rebuiltPairs = di3BuildWarehouseValueChartDataV2_(rows, maxItems);

  var charts = sheet.getCharts().map(function (chart, index) {
    var ranges = [];
    try {
      ranges = chart.getRanges().map(function (range) { return range.getA1Notation(); });
    } catch (error) {
      ranges = ["ERROR: " + String(error && error.message || error)];
    }
    var anchor = null;
    try {
      var info = chart.getContainerInfo();
      anchor = { row: info.getAnchorRow(), column: info.getAnchorColumn() };
    } catch (error) {}
    return { index: index + 1, ranges: ranges, anchor: anchor };
  });

  var result = {
    status: "READ_ONLY_DIAGNOSTICS",
    sheet: sheet.getName(),
    helper_range: helperRange.getA1Notation(),
    source_count: populated.length,
    source_first_5: populated.slice(0, 5),
    source_last_5: populated.slice(-5),
    source_is_descending: populated.every(function (row, index) {
      return index === 0 || Number(populated[index - 1][1]) >= Number(row[1]);
    }),
    independent_sort_first_5: independentPairs.slice(0, 5),
    independent_sort_last_5: independentPairs.slice(-5),
    independent_sort_is_descending: independentPairs.every(function (row, index) { return index === 0 || Number(independentPairs[index - 1][1]) >= Number(row[1]); }),
    runtime_builder_first_5: rebuiltPairs.slice(0, 5),
    runtime_builder_last_5: rebuiltPairs.slice(-5),
    runtime_builder_is_descending: rebuiltPairs.every(function (row, index) {
      return index === 0 || Number(rebuiltPairs[index - 1][1]) >= Number(row[1]);
    }),
    helper_matches_runtime_builder: JSON.stringify(populated) === JSON.stringify(rebuiltPairs),
    chart_count: charts.length,
    charts: charts
  };
  Logger.log(JSON.stringify(result, null, 2));
  return result;
}
