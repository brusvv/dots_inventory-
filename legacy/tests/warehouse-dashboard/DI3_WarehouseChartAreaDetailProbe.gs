/**
 * Follow-up probe: isolate individual chartArea sub-options.
 * Dedicated temporary sheet only; never touches the real warehouse dashboard.
 */
var DI3_CHART_AREA_DETAIL_SHEET = "__DI3_CHART_AREA_DETAIL__";

function di3RunWarehouseChartAreaDetailProbe() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error("Нет активной Google-таблицы.");
  if (ss.getSheetByName(DI3_CHART_AREA_DETAIL_SHEET)) {
    throw new Error("Лист " + DI3_CHART_AREA_DETAIL_SHEET + " уже существует.");
  }
  var sheet = ss.insertSheet(DI3_CHART_AREA_DETAIL_SHEET);
  var rows = [
    ["Товар", "Стоимость, ₽"],
    ["Probe 01", 1881.24], ["Probe 02", 1350.13], ["Probe 03", 698.85],
    ["Probe 04", 559.29], ["Probe 05", 251.75], ["Probe 06", 70.50],
    ["Probe 07", 65.25], ["Probe 08", 40.00], ["Probe 09", 10.00]
  ];
  sheet.getRange("N1:O10").setValues(rows);
  sheet.hideColumns(14, 2);
  SpreadsheetApp.flush();

  var cases = [
    { title: "A — baseline", option: null },
    { title: "B — left only", option: { left: 285 } },
    { title: "C — width/height percent", option: { width: "68%", height: "82%" } },
    { title: "D — numeric geometry", option: { left: 285, top: 42, width: 650, height: 270 } },
    { title: "E — dashboard chartArea", option: { left: 285, top: 42, width: "68%", height: "82%" } }
  ];
  cases.forEach(function (item, index) {
    var builder = sheet.newChart().asBarChart();
    builder.reverseCategories();
    builder.addRange(sheet.getRange("N1:O10"));
    builder.setNumHeaders(1);
    builder.setHiddenDimensionStrategy(Charts.ChartHiddenDimensionStrategy.SHOW_BOTH);
    builder.setPosition(14 + index * 19, 1, 0, 0);
    builder.setOption("title", item.title);
    builder.setOption("legend", { position: "none" });
    builder.setOption("width", 980);
    builder.setOption("height", 340);
    if (item.option) builder.setOption("chartArea", item.option);
    sheet.insertChart(builder.build());
  });
  SpreadsheetApp.flush();
  var result = {
    status: "PROBE_CREATED",
    sheet: DI3_CHART_AREA_DETAIL_SHEET,
    chart_count: sheet.getCharts().length,
    charts: sheet.getCharts().map(function (chart, index) {
      var ranges = [];
      try { ranges = chart.getRanges().map(function (r) { return r.getA1Notation(); }); } catch (e) {}
      return { index: index + 1, ranges: ranges };
    })
  };
  Logger.log(JSON.stringify(result, null, 2));
  return result;
}

function di3RemoveWarehouseChartAreaDetailProbe() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss && ss.getSheetByName(DI3_CHART_AREA_DETAIL_SHEET);
  if (!sheet) return { removed: false, reason: "Probe sheet not found." };
  ss.deleteSheet(sheet);
  return { removed: true, sheet: DI3_CHART_AREA_DETAIL_SHEET };
}
