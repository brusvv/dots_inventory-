/** Pure tests for the one-shot historical supply entry flow. */
function di3RunHistoricalSupplyUnitTests() {
  var passed = 0;
  var failed = [];
  function test(name, callback) {
    try { callback(); passed++; }
    catch (error) { failed.push({ name: name, error: error.message || String(error) }); }
  }
  function equal(actual, expected, message) {
    if (actual !== expected) throw new Error((message || "Values differ") + ": expected " + JSON.stringify(expected) + ", got " + JSON.stringify(actual));
  }
  function throws(callback, pattern) {
    var error = null;
    try { callback(); } catch (caught) { error = caught; }
    if (!error) throw new Error("Expected error matching " + pattern + ", but no error was thrown");
    if (pattern && !pattern.test(String(error.message || error))) {
      throw new Error("Expected error matching " + pattern + ", got: " + String(error.message || error));
    }
  }
  function validInput() {
    return {
      order_date: new Date(2024, 6, 2, 12, 0, 0),
      expected_date: new Date(2024, 6, 15, 12, 0, 0),
      sent_at: new Date(2024, 6, 4, 9, 30, 0),
      awaiting_at: new Date(2024, 6, 12, 16, 0, 0),
      received_at: new Date(2024, 6, 13, 11, 0, 0)
    };
  }

  test("historical entry accepts a complete past date chain", function () {
    var result = di3ValidateHistoricalSupplyDates_(validInput());
    equal(result.order_date.getDate(), 2);
    equal(result.sent_at.getDate(), 4);
    equal(result.awaiting_at.getDate(), 12);
    equal(result.received_at.getDate(), 13);
  });
  test("historical entry permits same-day order and dispatch", function () {
    var input = validInput();
    input.sent_at = new Date(2024, 6, 2, 0, 5, 0);
    var result = di3ValidateHistoricalSupplyDates_(input);
    equal(result.sent_at.getDate(), 2);
  });
  test("historical entry allows the optional expected arrival date to be empty", function () {
    var input = validInput();
    input.expected_date = "";
    equal(di3ValidateHistoricalSupplyDates_(input).expected_date, null);
  });
  test("historical entry requires the store order date", function () {
    var input = validInput();
    input.order_date = "";
    throws(function () { di3ValidateHistoricalSupplyDates_(input); }, /обязательно укажи дату заказа/);
  });
  test("historical entry requires all three factual stage dates", function () {
    ["sent_at", "awaiting_at", "received_at"].forEach(function (field) {
      var input = validInput();
      input[field] = "";
      throws(function () { di3ValidateHistoricalSupplyDates_(input); }, /Не указана фактическая дата этапа/);
    });
  });
  test("historical dispatch cannot precede the store order date", function () {
    var input = validInput();
    input.sent_at = new Date(2024, 6, 1, 23, 59, 0);
    throws(function () { di3ValidateHistoricalSupplyDates_(input); }, /Дата отправки G5 не может быть раньше даты заказа G2/);
  });
  test("historical awaiting date cannot precede dispatch", function () {
    var input = validInput();
    input.awaiting_at = new Date(2024, 6, 3, 9, 0, 0);
    throws(function () { di3ValidateHistoricalSupplyDates_(input); }, /Дата ожидания получения G6 не может быть раньше даты отправки G5/);
  });
  test("historical receipt date cannot precede awaiting date", function () {
    var input = validInput();
    input.received_at = new Date(2024, 6, 11, 23, 59, 0);
    throws(function () { di3ValidateHistoricalSupplyDates_(input); }, /Дата получения G7 не может быть раньше даты ожидания получения G6/);
  });
  test("historical expected arrival cannot precede the store order date", function () {
    var input = validInput();
    input.expected_date = new Date(2024, 6, 1, 12, 0, 0);
    throws(function () { di3ValidateHistoricalSupplyDates_(input); }, /Ожидаемая дата прибытия не может быть раньше даты создания заказа/);
  });
  test("historical factual stage dates cannot be in the future", function () {
    var input = validInput();
    var future = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);
    input.sent_at = new Date(2024, 6, 4, 9, 30, 0);
    input.awaiting_at = new Date(2024, 6, 12, 16, 0, 0);
    input.received_at = future;
    // Keep chronological order by placing G5 and G6 shortly before the future receipt.
    input.sent_at = new Date(future.getTime() - 3 * 24 * 60 * 60 * 1000);
    input.awaiting_at = new Date(future.getTime() - 2 * 24 * 60 * 60 * 1000);
    input.order_date = new Date(future.getTime() - 5 * 24 * 60 * 60 * 1000);
    input.expected_date = new Date(future.getTime() - 1 * 24 * 60 * 60 * 1000);
    throws(function () { di3ValidateHistoricalSupplyDates_(input); }, /не может быть в будущем/);
  });
  test("historical start and finalization do not rebuild unchanged form validations", function () {
    var start = di3StartHistoricalSupplyEntry.toString();
    var finish = di3FinalizeHistoricalSupplyReceipt_.toString();
    equal(start.indexOf("di3RefreshSupplyFormValidations()"), -1);
    equal(finish.indexOf("di3RefreshSupplyFormValidations()"), -1);
    includes(finish, 'receiptResult.status === "ALREADY_RECEIVED"');
  });
  test("historical mode routes receipt through the standard idempotent SUPPLY_RECEIVE pipeline", function () {
    // The public entry point performs preflight/confirmation; the locked worker
    // performs the actual receipt, so assert against the worker rather than wrapper.
    var commitSource = di3CommitHistoricalSupplyEntryLocked_.toString();
    var receiveCall = "di3ReceiveSupply_(supply, snapshot.received_at)";
    equal(commitSource.indexOf(receiveCall) !== -1, true,
      "Historical commit must use the standard receipt function with the confirmed receipt timestamp");
    equal(commitSource.indexOf(receiveCall), commitSource.lastIndexOf(receiveCall),
      "Historical commit must invoke the receipt pipeline exactly once");

    // The standard receipt function owns the stable key and operation lookup.
    var receiveSource = di3ReceiveSupply_.toString();
    equal(receiveSource.indexOf('var idempotencyKey = "SUPPLY_RECEIVE:" + supply.supply_id;') !== -1, true,
      "Standard receipt pipeline must derive its idempotency key from supply_id");
    equal(receiveSource.indexOf("di3GetSupplyReceiptOperation_(supply.supply_id)") !== -1, true,
      "Standard receipt pipeline must check for an existing receipt operation before creating one");
  });

  test("date panel clears stale stage validations before restoring saved values", function () {
    var source = di3RefreshSupplyDatePanel_.toString();
    var clearIndex = source.indexOf('sheet.getRange("G5:H7").clearDataValidations()');
    var dateWriteIndex = source.indexOf('sheet.getRange("G5:G7").setValues');
    var timeWriteIndex = source.indexOf('sheet.getRange("H5:H7").setValues');
    equal(clearIndex >= 0 && clearIndex < dateWriteIndex && clearIndex < timeWriteIndex, true,
      "Stage validations must be cleared before saved date/time values are restored");
  });

  var report = { passed: passed, failed: failed.length, failures: failed };
  if (failed.length) throw new Error("Historical supply tests failed: " + JSON.stringify(failed));
  return report;
}
