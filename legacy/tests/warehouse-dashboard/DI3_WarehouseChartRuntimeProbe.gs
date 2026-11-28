/**
 * Manual, isolated runtime probe for the warehouse dashboard chart.
 *
 * This file is NOT part of the production Apps Script source set.
 * Copy it into the Dots beta 4 test project only when ready to run.
 *
 * It creates one dedicated temporary sheet and two charts:
 *  1) visible source range A1:B11;
 *  2) hidden source range N1:O11 with SHOW_BOTH.
 *
 * It does not read or write the real warehouse dashboard, products, FIFO,
 * stock ledger, supplies, settings, or operations.
 */
var DI3_CHART_PROBE_SHEET_NAME = "__DI3_CHART_PROBE__";

function di3RunWarehouseChartRuntimeProbe() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error("Нет активной Google-таблицы.");
  if (ss.getSheetByName(DI3_CHART_PROBE_SHEET_NAME)) {
    throw new Error("Лист " + DI3_CHART_PROBE_SHEET_NAME +
      " уже существует. Сначала изучи его результаты или удали отдельной cleanup-функцией.");
  }

  var sheet = ss.insertSheet(DI3_CHART_PROBE_SHEET_NAME);
  var rows = [
    ["Товар", "Стоимость, ₽"],
    ["Probe item 01", 1881.24],
    ["Probe item 02", 1350.13],
    ["Probe item 03", 698.85],
    ["Probe item 04", 559.29],
    ["Probe item 05", 251.75],
    ["Probe item 06", 251.75],
    ["Probe item 07", 70.50],
    ["Probe item 08", 65.25],
    ["Probe item 09", 40.00],
    ["Probe item 10", 10.00]
  ];

  sheet.getRange(1, 1, rows.length, 2).setValues(rows);
  sheet.getRange(2, 2, rows.length - 1, 1).setNumberFormat("#,##0.00 ₽");
  sheet.getRange(1, 14, rows.length, 2).setValues(rows);
  sheet.getRange(2, 15, rows.length - 1, 1).setNumberFormat("#,##0.00 ₽");
  sheet.setColumnWidths(1, 2, 180);
  sheet.setColumnWidths(14, 2, 180);
  SpreadsheetApp.flush();

  var visibleChart = sheet.newChart()
    .asBarChart()
    .reverseCategories()
    .addRange(sheet.getRange(1, 1, rows.length, 2))
    .setNumHeaders(1)
    .setPosition(14, 1, 0, 0)
    .setOption("title", "PROBE A — visible source")
    .setOption("legend", { position: "none" })
    .setOption("width", 700)
    .setOption("height", 360)
    .build();
  sheet.insertChart(visibleChart);

  sheet.hideColumns(14, 2);
  var hiddenChart = sheet.newChart()
    .asBarChart()
    .reverseCategories()
    .addRange(sheet.getRange(1, 14, rows.length, 2))
    .setNumHeaders(1)
    .setHiddenDimensionStrategy(Charts.ChartHiddenDimensionStrategy.SHOW_BOTH)
    .setPosition(14, 8, 0, 0)
    .setOption("title", "PROBE B — hidden source with SHOW_BOTH")
    .setOption("legend", { position: "none" })
    .setOption("width", 700)
    .setOption("height", 360)
    .build();
  sheet.insertChart(hiddenChart);
  SpreadsheetApp.flush();

  var charts = sheet.getCharts();
  var chartResults = charts.map(function (chart, index) {
    var ranges = [];
    var chartType = "";
    var chartTypeError = "";
    try {
      ranges = chart.getRanges().map(function (range) {
        return range.getA1Notation();
      });
    } catch (error) {
      chartTypeError = "getRanges: " + String(error && error.message || error);
    }
    try {
      chartType = String(chart.getChartType());
    } catch (error) {
      chartTypeError += (chartTypeError ? "; " : "") +
        "getChartType: " + String(error && error.message || error);
    }
    return {
      index: index + 1,
      ranges: ranges,
      chart_type: chartType,
      chart_type_error: chartTypeError
    };
  });

  var result = {
    status: "PROBE_CREATED",
    sheet: DI3_CHART_PROBE_SHEET_NAME,
    expected_chart_count: 2,
    actual_chart_count: charts.length,
    visible_source_raw_values: sheet.getRange(1, 1, rows.length, 2).getValues(),
    hidden_source_raw_values: sheet.getRange(1, 14, rows.length, 2).getValues(),
    hidden_columns: {
      labels: sheet.isColumnHiddenByUser(14),
      values: sheet.isColumnHiddenByUser(15)
    },
    charts: chartResults
  };
  Logger.log(JSON.stringify(result, null, 2));
  return result;
}

/**
 * Explicit cleanup. Removes ONLY the dedicated probe sheet.
 * Run only after saving the probe log and confirming the sheet name.
 */
function di3RemoveWarehouseChartRuntimeProbe() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss && ss.getSheetByName(DI3_CHART_PROBE_SHEET_NAME);
  if (!sheet) return { removed: false, reason: "Probe sheet not found." };
  ss.deleteSheet(sheet);
  return { removed: true, sheet: DI3_CHART_PROBE_SHEET_NAME };
}
