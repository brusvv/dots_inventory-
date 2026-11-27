/** Pure regression tests for warehouse dashboard chart ranking and filtering. */
function di3RunWarehouseDashboardUnitTests() {
  var passed = 0;
  var failures = [];
  function test(name, callback) {
    try { callback(); passed++; }
    catch (error) { failures.push({ name: name, error: error.message || String(error) }); }
  }
  function equal(actual, expected, message) {
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      throw new Error((message || "Values differ") + ": expected " + JSON.stringify(expected) + ", got " + JSON.stringify(actual));
    }
  }
  function row(code, label, quantity, known, value, status) {
    return [code, label, quantity, known, Math.max(0, quantity - known), 10, value, 100, 15, 5, status || "Оценено", 10, 15];
  }

  test("warehouse value chart pairs each label with its own value and sorts descending", function () {
    var source = [
      row("PRD-0028", "KYUU DESIGN Lian, 6 мм", 80, 80, 840),
      row("PRD-0002", "Wallhack Black (Silent), 7 мм", 40, 40, 2100)
    ];
    equal(di3BuildWarehouseValueChartDataV2_(source), [
      ["Wallhack Black (Silent), 7 мм", 2100],
      ["KYUU DESIGN Lian, 6 мм", 840]
    ]);
  });

  test("warehouse value chart excludes zero-stock, zero-value, empty and unvalued products", function () {
    var source = [
      row("P1", "Positive", 10, 10, 100),
      row("P2", "Empty", 0, 0, 0),
      row("P3", "Zero value", 8, 8, 0),
      row("P4", "Unvalued", 5, 0, "", "Неполная оценка"),
      row("P5", "Partial", 5, 3, "", "Неполная оценка")
    ];
    equal(di3BuildWarehouseValueChartDataV2_(source), [["Positive", 100]]);
  });

  test("warehouse value chart is capped at Top 20", function () {
    var source = [];
    for (var i = 1; i <= 27; i++) source.push(row("P" + i, "Product " + i, 1, 1, i * 100));
    var result = di3BuildWarehouseValueChartDataV2_(source);
    equal(result.length, 20);
    equal(result[0], ["Product 27", 2700]);
    equal(result[19], ["Product 8", 800]);
  });

  test("warehouse value chart is stable for equal values", function () {
    var source = [row("P2", "Beta", 2, 2, 50), row("P1", "Alpha", 2, 2, 50)];
    equal(di3BuildWarehouseValueChartDataV2_(source), [["Alpha", 50], ["Beta", 50]]);
  });

  test("average known FIFO unit cost is calculated from known value and known units", function () {
    equal(di3CalculateAverageKnownUnitCost_(2940, 120), 24.5);
  });

  test("average known FIFO unit cost is null when no units are known", function () {
    equal(di3CalculateAverageKnownUnitCost_(0, 0), null);
    equal(di3CalculateAverageKnownUnitCost_(2940, 0), null);
  });

  test("warehouse value chart does not mutate the source table rows", function () {
    var source = [row("P1", "One", 1, 1, 10), row("P2", "Two", 1, 1, 20)];
    var before = JSON.stringify(source);
    di3BuildWarehouseValueChartDataV2_(source);
    equal(JSON.stringify(source), before);
  });

  test("stock journal shows a warning instead of disappearing while stock operations are pending", function () {
    var warning = di3BuildStockJournalPendingWarning_([
      { operation_type: "ORDER_DISPATCH", status: "RETRYABLE" },
      { operation_type: "SUPPLY_RECEIVE", status: "PREPARED" },
      { operation_type: "ORDER_RETURN", status: "QUARANTINED" },
      { operation_type: "MANUAL_STOCK_MOVEMENT", status: "RETRYABLE" }
    ]);
    equal(warning.indexOf("есть 4 незавершённых складских операций") >= 0, true);
    equal(warning.indexOf("и ещё 1") >= 0, true);
    equal(warning.indexOf("может быть неполным") >= 0, true);
    equal(di3BuildStockJournalPendingWarning_([]), "");
    var buildSource = di3BuildStockJournalRows_.toString();
    equal(buildSource.indexOf("options.allowPending !== true") >= 0, true);
    var refreshSource = di3RefreshStockJournal.toString();
    equal(refreshSource.indexOf("di3GetPendingStockOperations_()") >= 0, true);
    equal(refreshSource.indexOf("di3BuildStockJournalPendingWarning_") >= 0, true);
    equal(refreshSource.indexOf("allowPending: true") >= 0, true);
  });

  test("one failed warehouse view does not prevent other views from refreshing", function () {
    var originalDashboard = typeof di3RefreshWarehouseDashboard === "function" ? di3RefreshWarehouseDashboard : null;
    var originalJournal = typeof di3RefreshStockJournal === "function" ? di3RefreshStockJournal : null;
    var originalProducts = typeof di3RefreshProductsSheet === "function" ? di3RefreshProductsSheet : null;
    var originalFifo = typeof di3RefreshFifoHistorySheet === "function" ? di3RefreshFifoHistorySheet : null;
    try {
      di3RefreshWarehouseDashboard = function () { throw new Error("dashboard test failure"); };
      di3RefreshStockJournal = function () { throw new Error("journal test failure"); };
      di3RefreshProductsSheet = function () { return { rows: 65 }; };
      di3RefreshFifoHistorySheet = function () { return { rows: 10 }; };
      var result = di3RefreshWarehouseViews();
      equal(result.dashboard.status, "FAILED");
      equal(result.journal.status, "FAILED");
      equal(result.products.rows, 65);
      equal(result.fifo_history.rows, 10);
    } finally {
      di3RefreshWarehouseDashboard = originalDashboard || undefined;
      di3RefreshStockJournal = originalJournal || undefined;
      di3RefreshProductsSheet = originalProducts || undefined;
      di3RefreshFifoHistorySheet = originalFifo || undefined;
    }
  });

  return {
    status: failures.length ? "FAIL" : "PASS",
    passed: passed,
    failed: failures.length,
    failures: failures
  };
}
