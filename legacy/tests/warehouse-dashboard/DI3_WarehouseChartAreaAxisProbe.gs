/**
 * Isolates chartArea width/height values independently.
 * Uses only a dedicated temporary sheet and synthetic values.
 */
var DI3_CHART_AREA_AXIS_PROBE_SHEET = "__DI3_CHART_AREA_AXIS__";

function di3RunWarehouseChartAreaAxisProbe() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error("Нет активной Google-таблицы.");
  if (ss.getSheetByName(DI3_CHART_AREA_AXIS_PROBE_SHEET)) {
    throw new Error("Лист " + DI3_CHART_AREA_AXIS_PROBE_SHEET + " уже существует.");
  }
  var sheet = ss.insertSheet(DI3_CHART_AREA_AXIS_PROBE_SHEET);
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
    { title: "A — baseline", opts: null },
    { title: "B — top only", opts: { top: 42 } },
    { title: "C — width 68 percent", opts: { width: "68%" } },
    { title: "D — height 82 percent", opts: { height: "82%" } },
    { title: "E — width numeric 650", opts: { width: 650 } },
    { title: "F — height numeric 270", opts: { height: 270 } },
    { title: "G — left + top", opts: { left: 285, top: 42 } },
    { title: "H — left + width percent", opts: { left: 285, width: "68%" } },
    { title: "I — left + height percent", opts: { left: 285, height: "82%" } }
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
    if (item.opts) builder.setOption("chartArea", item.opts);
    sheet.insertChart(builder.build());
  });
  SpreadsheetApp.flush();
  var result = {
    status: "PROBE_CREATED",
    sheet: DI3_CHART_AREA_AXIS_PROBE_SHEET,
    chart_count: sheet.getCharts().length,
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

function di3RemoveWarehouseChartAreaAxisProbe() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss && ss.getSheetByName(DI3_CHART_AREA_AXIS_PROBE_SHEET);
  if (!sheet) return { removed: false, reason: "Probe sheet not found." };
  ss.deleteSheet(sheet);
  return { removed: true, sheet: DI3_CHART_AREA_AXIS_PROBE_SHEET };
}
