/**
 * Deterministic category-order probe for Google Sheets bar charts.
 * Creates charts with known ascending/descending sources and reverseCategories().
 * Does not access the real warehouse dashboard.
 */
var DI3_CHART_ORDER_PROBE_SHEET = "__DI3_CHART_ORDER__";

function di3RunWarehouseChartOrderProbe() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error("Нет активной Google-таблицы.");
  if (ss.getSheetByName(DI3_CHART_ORDER_PROBE_SHEET)) {
    throw new Error("Лист " + DI3_CHART_ORDER_PROBE_SHEET + " уже существует.");
  }
  var sheet = ss.insertSheet(DI3_CHART_ORDER_PROBE_SHEET);
  var descending = [
    ["Товар", "Стоимость"],
    ["HIGH 1000", 1000], ["MID 500", 500], ["LOW 100", 100]
  ];
  var ascending = [
    ["Товар", "Стоимость"],
    ["LOW 100", 100], ["MID 500", 500], ["HIGH 1000", 1000]
  ];
  sheet.getRange("N1:O4").setValues(descending);
  sheet.getRange("Q1:R4").setValues(ascending);
  sheet.hideColumns(14, 2);
  sheet.hideColumns(17, 2);
  SpreadsheetApp.flush();

  var cases = [
    { title: "A — desc source / default", range: "N1:O4", reverse: false },
    { title: "B — desc source / reverseCategories", range: "N1:O4", reverse: true },
    { title: "C — asc source / default", range: "Q1:R4", reverse: false },
    { title: "D — asc source / reverseCategories", range: "Q1:R4", reverse: true }
  ];
  cases.forEach(function (item, index) {
    var builder = sheet.newChart().asBarChart();
    if (item.reverse) builder.reverseCategories();
    builder.addRange(sheet.getRange(item.range));
    builder.setNumHeaders(1);
    builder.setHiddenDimensionStrategy(Charts.ChartHiddenDimensionStrategy.SHOW_BOTH);
    builder.setPosition(6 + index * 18, 1, 0, 0);
    builder.setOption("title", item.title);
    builder.setOption("legend", { position: "none" });
    builder.setOption("width", 900);
    builder.setOption("height", 300);
    sheet.insertChart(builder.build());
  });
  SpreadsheetApp.flush();

  var result = {
    status: "PROBE_CREATED",
    sheet: DI3_CHART_ORDER_PROBE_SHEET,
    chart_count: sheet.getCharts().length,
    descending_source: sheet.getRange("N1:O4").getValues(),
    ascending_source: sheet.getRange("Q1:R4").getValues(),
    charts: sheet.getCharts().map(function (chart, index) {
      var ranges = [];
      try { ranges = chart.getRanges().map(function (r) { return r.getA1Notation(); }); } catch (e) {}
      var anchor = null;
      try {
        var info = chart.getContainerInfo();
        anchor = { row: info.getAnchorRow(), column: info.getAnchorColumn() };
      } catch (e) {}
      return { index: index + 1, ranges: ranges, anchor: anchor };
    })
  };
  Logger.log(JSON.stringify(result, null, 2));
  return result;
}

function di3RemoveWarehouseChartOrderProbe() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss && ss.getSheetByName(DI3_CHART_ORDER_PROBE_SHEET);
  if (!sheet) return { removed: false, reason: "Probe sheet not found." };
  ss.deleteSheet(sheet);
  return { removed: true, sheet: DI3_CHART_ORDER_PROBE_SHEET };
}
