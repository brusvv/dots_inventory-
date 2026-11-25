/**
 * Read-only runtime check for C-10 integer ratio rounding on Apps Script V8.
 * Requires the production 30_DI3_MoneyCore.gs to be installed in the test copy.
 * Does not read or write spreadsheet data.
 */
function di3TmpC10MoneyRangeRuntimeProbe() {
  var vectors = [
    { total: 1000000000, part: 8999999999999999, whole: 9000000000000000, expected: 1000000000 },
    { total: 9007199254740991, part: 9007199254740990, whole: 9007199254740991, expected: 9007199254740990 },
    { total: 9007199254740991, part: 4503599627370496, whole: 9007199254740991, expected: 4503599627370496 },
    { total: 123456789012345, part: 7654321098765432, whole: 8000000000000000, expected: 118122238115378 },
    { total: 9007199254740991, part: 1, whole: 9007199254740991, expected: 1 },
    { total: 9007199254740991, part: 9007199254740991, whole: 9007199254740991, expected: 9007199254740991 },
    { total: 0, part: 9007199254740990, whole: 9007199254740991, expected: 0 },
    { total: 1, part: 1, whole: 2, expected: 1 },
    { total: 1, part: 2, whole: 2, expected: 1 },
    { total: 100, part: 1, whole: 3, expected: 33 },
    { total: 100, part: 2, whole: 3, expected: 67 }
  ];
  var rows = [];
  var failures = [];
  vectors.forEach(function (vector, index) {
    var actual = di3MoneyRoundRatioToInteger_(vector.total, vector.part, vector.whole);
    var passed = actual === vector.expected && Number.isSafeInteger(actual) && actual >= 0 && actual <= vector.total;
    rows.push({ case: index + 1, expected: vector.expected, actual: actual, status: passed ? "PASS" : "FAIL" });
    if (!passed) failures.push({ case: index + 1, expected: vector.expected, actual: actual });
  });
  var report = {
    probe: "C10_MONEY_RANGE_V1",
    status: failures.length ? "FAIL" : "PASS",
    read_only: true,
    spreadsheet_reads: 0,
    spreadsheet_writes: 0,
    vector_count: vectors.length,
    safe_integer_boundary_cases: 7,
    rounding_regression_cases: 4,
    passed: rows.length - failures.length,
    failed: failures.length,
    rows: rows,
    failures: failures
  };
  Logger.log(JSON.stringify(report));
  return report;
}
