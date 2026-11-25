/** Local structural regression tests for consequential System menu actions. */
function di3RunSystemSafetyUxUnitTests() {
  var passed = 0;
  var failed = [];
  function test(name, callback) {
    try { callback(); passed++; }
    catch (error) { failed.push({ name: name, error: error.message || String(error) }); }
  }
  function equal(actual, expected, message) {
    if (actual !== expected) throw new Error((message || "Values differ") + ": expected " + JSON.stringify(expected) + ", got " + JSON.stringify(actual));
  }
  function includes(source, fragment, message) {
    equal(String(source).indexOf(fragment) !== -1, true, message || ("Expected source to contain: " + fragment));
  }

  test("batch recovery performs a read-only preview before showing confirmation", function () {
    var source = di3RecoverAllPendingOperations.toString();
    var preview = source.indexOf("di3GetOperationRecoveryReport_()");
    var prompt = source.indexOf("ui.alert(");
    var lock = source.indexOf("di3WithLock_(");
    equal(preview >= 0 && prompt > preview && lock > prompt, true);
    includes(source, "CANCELLED_BY_USER");
  });
  test("recovery confirmation explains eligible, waiting, unsupported and quarantined operations", function () {
    var source = di3BuildRecoverPendingOperationsConfirmationText_.toString();
    ["PREPARED/RETRYABLE", "eligible", "handler_available", "retry_ready", "unsupported", "quarantined", "движения склада", "idempotency"].forEach(function (fragment) {
      includes(source, fragment);
    });
  });
  test("recovery counts only registered and currently eligible operations as ready", function () {
    var source = di3BuildRecoverPendingOperationsConfirmationText_.toString();
    includes(source, "item.handler_available && (item.retry_ready || String(item.status) === \"PREPARED\")");
  });
  test("money migration requires YES before any lock or migration work", function () {
    var source = di3RunMoneyMinorUnitsMigration.toString();
    var prompt = source.indexOf("ui.alert(");
    var lock = source.indexOf("di3WithLock_(");
    equal(prompt >= 0 && lock > prompt, true);
    includes(source, "CANCELLED_BY_USER");
    includes(source, "резервная копия");
    includes(source, "StockLedger не переписывается");
  });
  test("period reopen requires an explicit second confirmation after the reason is entered", function () {
    var source = di3PromptReopenAccountingPeriod.toString();
    var reason = source.indexOf("ui.prompt(");
    var confirm = source.indexOf("Подтверди повторное открытие периода");
    var reopen = source.indexOf("di3ReopenAccountingPeriod(");
    equal(reason >= 0 && confirm > reason && reopen > confirm, true);
    includes(source, "PeriodGuard");
    includes(source, "CANCELLED_BY_USER");
  });
  test("order transition domain enforces allowed source-to-target state edges", function () {
    equal(DI3_ORDER_ALLOWED_TRANSITIONS["Новый"].join("|"), "В пути|Отменен");
    equal(DI3_ORDER_ALLOWED_TRANSITIONS["В пути"].join("|"), "Завершен|Возвращается");
    equal(DI3_ORDER_ALLOWED_TRANSITIONS["Возвращается"].join("|"), "Возврат");
    equal(DI3_ORDER_ALLOWED_TRANSITIONS["Завершен"].length, 0);
  });
  test("order domain rejects transitions absent from the state machine", function () {
    var source = di3AdvanceOrderStatus.toString();
    includes(source, "DI3_ORDER_ALLOWED_TRANSITIONS");
    includes(source, "allowed.indexOf(nextStatus) === -1");
    includes(source, "Недопустимый переход статуса заказа");
  });
  test("mutating system menu items visibly indicate confirmation or deliberate action", function () {
    var source = di3BuildMenus_.toString();
    ["Восстановить незавершённые операции…", "Снять карантин после ручной сверки…", "Пересчитать FIFO в копейках…", "Перестроить FIFO полностью…", "Открыть последний закрытый месяц…", "Восстановить в новую таблицу…"].forEach(function (label) {
      includes(source, label);
    });
  });

  var report = { passed: passed, failed: failed.length, failures: failed };
  if (failed.length) throw new Error("System Safety UX tests failed: " + JSON.stringify(failed));
  return report;
}
