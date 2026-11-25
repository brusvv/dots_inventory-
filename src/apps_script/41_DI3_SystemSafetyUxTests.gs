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
  test("manual warehouse movement confirms before posting the stock operation", function () {
    var source = di3SubmitWarehouseManagerForm.toString();
    var normalize = source.indexOf("di3BuildManualMovementCommand_(command)");
    var prompt = source.indexOf("ui.alert(");
    var post = source.indexOf("di3PostManualStockMovement(command)");
    var clear = source.indexOf('sheet.getRange("B5:B11").clearContent()');
    equal(normalize >= 0 && prompt > normalize && post > prompt && clear > post, true);
    includes(source, "CANCELLED_BY_USER");
  });
  test("manual warehouse confirmation describes inbound and outbound FIFO effects", function () {
    var source = di3BuildWarehouseManualMovementConfirmationText_.toString();
    ["StockLedger", "StockLots", "FIFO-партия", "списано со склада", "FIFO-распределения расхода", "Количество:"].forEach(function (fragment) {
      includes(source, fragment);
    });
  });
  test("manual offline sale confirmation displays unit price and total revenue", function () {
    var source = di3BuildWarehouseManualMovementConfirmationText_.toString();
    includes(source, "OFFLINE_SALE");
    includes(source, "Выручка вне системы");
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

  test("period close and reopen append immutable PeriodLocks events", function () {
    var closeSource = di3CloseAccountingPeriod.toString();
    var reopenSource = di3ReopenAccountingPeriod.toString();
    includes(closeSource, 'di3AppendTableRows_("PeriodLocks", [row])');
    includes(reopenSource, 'di3AppendTableRows_("PeriodLocks", [row])');
    equal(closeSource.indexOf(".setValues("), -1, "Period close must not overwrite an event");
    equal(reopenSource.indexOf(".setValues("), -1, "Period reopen must not overwrite an event");
  });
  test("PeriodGuard derives current state from the last event for each period", function () {
    var latestSource = di3GetLatestLockedPeriod_.toString();
    var eventSource = di3GetLatestPeriodEvents_.toString();
    includes(latestSource, "di3GetLatestPeriodEvents_()");
    includes(latestSource, 'item.status === "LOCKED"');
    includes(eventSource, "item.row_number > previous.row_number");
  });
  test("period status exposes one latest event per period with actor and reason", function () {
    var source = di3GetPeriodGuardStatus.toString();
    includes(source, "di3GetLatestPeriodEvents_()");
    ["locked_by", "reopened_by", "reopen_reason"].forEach(function (field) { includes(source, field); });
  });


  test("actor identity is captured centrally and never falls back to effective user", function () {
    var source = di3CaptureActorContext_.toString();
    includes(source, "Session.getActiveUser().getEmail()");
    includes(source, 'identity_status: email ? "IDENTIFIED" : "UNAVAILABLE"');
    includes(source, 'identity_source: email ? "ACTIVE_USER" : "NONE"');
    equal(source.indexOf("getEffectiveUser"), -1, "Effective user must never be used as a fallback");
    includes(di3GetActorEmail_.toString(), "di3CaptureActorContext_()");
    includes(di3SettingsActor_.toString(), "di3GetActorEmail_()");
  });

  test("operation-backed domain audit uses the immutable initiator, not the recovery executor", function () {
    var originalFind = di3FindRowByFirstColumn_;
    var originalGetActor = di3GetActorEmail_;
    try {
      di3FindRowByFirstColumn_ = function (table, operationId) {
        equal(table, "Operations");
        if (operationId === "operation-a") return { values: ["operation-a", "", "", "", "", "COMMITTED", "", "", "", "", "user-a@example.test"] };
        if (operationId === "operation-empty") return { values: ["operation-empty", "", "", "", "", "COMMITTED", "", "", "", "", ""] };
        return null;
      };
      di3GetActorEmail_ = function () { return "recovery-user-b@example.test"; };
      equal(di3GetOperationInitiatorActor_("operation-a"), "user-a@example.test");
      equal(di3GetOperationInitiatorActor_("operation-empty"), "", "A blank persisted initiator must stay blank");
      equal(di3GetOperationInitiatorActor_(""), "recovery-user-b@example.test", "Non-operation events use the current actor");
      equal(di3GetOperationInitiatorActor_("missing-operation"), "", "A missing operation must not be attributed to the current executor");
    } finally {
      di3FindRowByFirstColumn_ = originalFind;
      di3GetActorEmail_ = originalGetActor;
    }
    includes(di3EnsureOrderStatusHistory_.toString(), "di3GetOperationInitiatorActor_");
    includes(di3EnsureSupplyStatusHistory_.toString(), "di3GetOperationInitiatorActor_");
    includes(di3BuildOrderDispatchRows_.toString(), "di3GetOperationInitiatorActor_");
    includes(di3BuildOrderReturnRows_.toString(), "di3GetOperationInitiatorActor_");
  });

  test("operation attempt diagnostics preserve the executor actor across recovery and manual review", function () {
    var originalGetSpreadsheet = di3GetSpreadsheet_;
    var originalReadTableValues = di3ReadTableValues_;
    try {
      di3GetSpreadsheet_ = function () {
        return { getSheetByName: function (name) { return name === "OperationAttempts" ? {} : null; } };
      };
      di3ReadTableValues_ = function (name) {
        if (name !== "OperationAttempts") throw new Error("Unexpected table read: " + name);
        return [
          ["attempt-a", "operation-1", 1, "ORDER_DISPATCH", "PREPARED", "INITIAL",
            "2026-11-25T10:00:00Z", "2026-11-25T10:00:01Z", "INTERRUPTED", "EXECUTION_INTERRUPTED", "timeout", "user-a@example.test"],
          ["review-c", "operation-1", 0, "ORDER_DISPATCH", "QUARANTINED", "MANUAL_REOPEN",
            "2026-11-25T10:05:00Z", "2026-11-25T10:05:00Z", "REQUEUE_REQUESTED", "MANUAL_REVIEW", "reviewed", "user-c@example.test"],
          ["attempt-b", "operation-1", 2, "ORDER_DISPATCH", "RETRYABLE", "RECOVERY",
            "2026-11-25T10:06:00Z", "2026-11-25T10:06:02Z", "COMMITTED", "", "", "user-b@example.test"]
        ];
      };
      var report = di3GetOperationAttemptStats_();
      var stats = report.by_operation_id["operation-1"];
      equal(stats.attempt_count, 1, "Only attempts after the latest manual reopen belong to the active retry epoch");
      equal(stats.last_attempt.actor, "user-b@example.test", "Latest recovery executor must be exposed");
      equal(stats.last_attempt.execution_mode, "RECOVERY");
      equal(report.manual_reviews.length, 1);
      equal(report.manual_reviews[0].actor, "user-c@example.test", "Manual reviewer must remain visible");
      equal(report.manual_reviews[0].execution_mode, "MANUAL_REOPEN");
    } finally {
      di3GetSpreadsheet_ = originalGetSpreadsheet;
      di3ReadTableValues_ = originalReadTableValues;
    }
  });

  var report = { passed: passed, failed: failed.length, failures: failed };
  if (failed.length) throw new Error("System Safety UX tests failed: " + JSON.stringify(failed));
  return report;
}
