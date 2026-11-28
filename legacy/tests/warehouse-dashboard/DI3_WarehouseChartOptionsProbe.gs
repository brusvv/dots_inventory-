/**
 * Isolated chart-options probe for the warehouse dashboard.
 * Adds four charts to a dedicated temporary sheet; does not touch "Склад".
 * Run di3RunWarehouseChartOptionsProbe(), inspect all four rendered charts and log.
 */
var DI3_CHART_OPTIONS_PROBE_SHEET = "__DI3_CHART_OPTIONS__";

function di3RunWarehouseChartOptionsProbe() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error("Нет активной Google-таблицы.");
  if (ss.getSheetByName(DI3_CHART_OPTIONS_PROBE_SHEET)) {
    throw new Error("Лист " + DI3_CHART_OPTIONS_PROBE_SHEET + " уже существует.");
  }
  var sheet = ss.insertSheet(DI3_CHART_OPTIONS_PROBE_SHEET);
  var rows = [
    ["Товар", "Стоимость оценённых остатков, ₽"],
    ["Probe item 01", 1881.24], ["Probe item 02", 1350.13],
    ["Probe item 03", 698.85], ["Probe item 04", 559.29],
    ["Probe item 05", 251.75], ["Probe item 06", 251.75],
    ["Probe item 07", 70.50], ["Probe item 08", 65.25],
    ["Probe item 09", 40.00], ["Probe item 10", 10.00]
  ];
  sheet.getRange(1, 14, rows.length, 2).setValues(rows);
  sheet.getRange(2, 15, rows.length - 1, 1).setNumberFormat("#,##0.00 ₽");
  sheet.hideColumns(14, 2);
  SpreadsheetApp.flush();

  var cases = [
    { title: "A — baseline", chartArea: false, hAxis: false },
    { title: "B — chartArea only", chartArea: true, hAxis: false },
    { title: "C — hAxis only", chartArea: false, hAxis: true },
    { title: "D — dashboard options", chartArea: true, hAxis: true }
  ];
  cases.forEach(function (item, index) {
    var builder = sheet.newChart().asBarChart();
    builder.reverseCategories();
    builder.addRange(sheet.getRange(1, 14, rows.length, 2));
    builder.setNumHeaders(1);
    builder.setHiddenDimensionStrategy(Charts.ChartHiddenDimensionStrategy.SHOW_BOTH);
    builder.setPosition(14 + index * 19, 1, 0, 0);
    builder.setOption("title", item.title);
    builder.setOption("legend", { position: "none" });
    builder.setOption("width", 980);
    builder.setOption("height", 340);
    if (item.chartArea) {
      builder.setOption("chartArea", { left: 285, top: 42, width: "68%", height: "82%" });
    }
    if (item.hAxis) {
      builder.setOption("hAxis", { title: "Стоимость, ₽", minValue: 0, format: "#,##0" });
    }
    sheet.insertChart(builder.build());
  });
  SpreadsheetApp.flush();

  var result = {
    status: "PROBE_CREATED",
    sheet: DI3_CHART_OPTIONS_PROBE_SHEET,
    chart_count: sheet.getCharts().length,
    source_range: "N1:O11",
    hidden_columns: {
      labels: sheet.isColumnHiddenByUser(14),
      values: sheet.isColumnHiddenByUser(15)
    },
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

function di3RemoveWarehouseChartOptionsProbe() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss && ss.getSheetByName(DI3_CHART_OPTIONS_PROBE_SHEET);
  if (!sheet) return { removed: false, reason: "Probe sheet not found." };
  ss.deleteSheet(sheet);
  return { removed: true, sheet: DI3_CHART_OPTIONS_PROBE_SHEET };
}
