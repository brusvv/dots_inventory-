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
    equal(di3BuildWarehouseValueChartData_(source), [
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
    equal(di3BuildWarehouseValueChartData_(source), [["Positive", 100]]);
  });

  test("warehouse value chart is capped at Top 20", function () {
    var source = [];
    for (var i = 1; i <= 27; i++) source.push(row("P" + i, "Product " + i, 1, 1, i * 100));
    var result = di3BuildWarehouseValueChartData_(source);
    equal(result.length, 20);
    equal(result[0], ["Product 27", 2700]);
    equal(result[19], ["Product 8", 800]);
  });

  test("warehouse value chart is stable for equal values", function () {
    var source = [row("P2", "Beta", 2, 2, 50), row("P1", "Alpha", 2, 2, 50)];
    equal(di3BuildWarehouseValueChartData_(source), [["Alpha", 50], ["Beta", 50]]);
  });

  test("warehouse value chart does not mutate the source table rows", function () {
    var source = [row("P1", "One", 1, 1, 10), row("P2", "Two", 1, 1, 20)];
    var before = JSON.stringify(source);
    di3BuildWarehouseValueChartData_(source);
    equal(JSON.stringify(source), before);
  });

  return {
    status: failures.length ? "FAIL" : "PASS",
    passed: passed,
    failed: failures.length,
    failures: failures
  };
}
