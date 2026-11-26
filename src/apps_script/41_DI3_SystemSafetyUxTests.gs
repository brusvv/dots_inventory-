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


  test("actor identity capture distinguishes identified and unavailable Sessions", function () {
    var identified = di3CaptureActorContext_({
      getActiveUser: function () { return { getEmail: function () { return "initiator@example.test"; } }; }
    });
    equal(identified.email, "initiator@example.test");
    equal(identified.identity_status, "IDENTIFIED");
    equal(identified.identity_source, "ACTIVE_USER");

    var empty = di3CaptureActorContext_({
      getActiveUser: function () { return { getEmail: function () { return ""; } }; }
    });
    equal(empty.email, "");
    equal(empty.identity_status, "UNAVAILABLE");
    equal(empty.identity_source, "NONE");

    var unavailable = di3CaptureActorContext_({
      getActiveUser: function () { throw new Error("identity unavailable"); }
    });
    equal(unavailable.email, "");
    equal(unavailable.identity_status, "UNAVAILABLE");
    equal(unavailable.identity_source, "NONE");

    var source = di3CaptureActorContext_.toString();
    equal(source.indexOf("getEffectiveUser"), -1, "Effective user must never be used as a fallback");
    includes(di3GetActorEmail_.toString(), "di3CaptureActorContext_()");
    includes(di3SettingsActor_.toString(), "di3GetActorEmail_()");
  });

  test("operation-backed domain audit uses the immutable initiator, not the recovery executor", function () {
    var originalFind = di3FindRowByFirstColumn_;
    var originalGetActor = di3GetActorEmail_;
    var originalInitiator = di3GetOperationInitiatorActor_;
    var originalCurrency = di3GetBaseCurrency_;
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

      di3GetOperationInitiatorActor_ = function () { return "user-a@example.test"; };
      di3GetBaseCurrency_ = function () { return "RUB"; };
      var dispatch = di3BuildOrderDispatchRows_("operation-a", {
        order_id: "order-1", order_number: "ORD-1", dispatched_at: "2026-11-25T10:00:00Z",
        recorded_at: "2026-11-25T10:01:00Z",
        lines: [{ movement_id: "move-out", event_key: "evt-out", product_id: "product-1", ledger_sequence: 1, quantity: 1,
          display_code: "P-1", sale_unit_price: 100, line_revenue: 100 }]
      });
      equal(dispatch.details[0][8], "user-a@example.test", "Dispatch detail must record the initiator");
      equal(dispatch.ledger[0][12], 1, "Dispatch ledger row must persist its assigned sequence");

      var returned = di3BuildOrderReturnRows_("operation-a", {
        order_id: "order-1", order_number: "ORD-1", returned_at: "2026-11-25T12:00:00Z",
        recorded_at: "2026-11-25T12:01:00Z",
        lines: [{ movement_id: "move-in", event_key: "evt-in", product_id: "product-1", ledger_sequence: 2, quantity: 1,
          display_code: "P-1", cost_status: "KNOWN", original_dispatch_movement_id: "move-out",
          source_lot_id: "lot-1", lot_id: "lot-return", pack_variant_id: "pack-1", unit_cost: 50, total_cost_minor: 5000 }]
      });
      equal(returned.details[0][8], "user-a@example.test", "Return detail must record the initiator");
      equal(returned.ledger[0][12], 2, "Return ledger row must persist its assigned sequence");

      var receipt = di3BuildSupplyReceiptRows_("operation-a", {
        supply_id: "supply-1", supply_number: "SUP-1",
        lines: [{ movement_id: "move-supply", event_key: "evt-supply", product_id: "product-1", ledger_sequence: 3,
          quantity: 1, display_code: "P-1", cost_status: "KNOWN",
          effective_at: "2026-11-25T12:00:00Z", recorded_at: "2026-11-25T12:01:00Z",
          lot_id: "lot-supply", pack_variant_id: "pack-1", unit_cost: 50, total_cost_minor: 5000,
          supply_item_id: "item-1" }]
      });
      equal(receipt.details[0][8], "user-a@example.test", "Supply receipt detail must record the initiator");
      equal(receipt.ledger[0][12], 3, "Supply ledger row must persist its assigned sequence");
    } finally {
      di3FindRowByFirstColumn_ = originalFind;
      di3GetActorEmail_ = originalGetActor;
      di3GetOperationInitiatorActor_ = originalInitiator;
      di3GetBaseCurrency_ = originalCurrency;
    }
    includes(di3EnsureOrderStatusHistory_.toString(), "di3GetOperationInitiatorActor_");
    includes(di3EnsureSupplyStatusHistory_.toString(), "di3GetOperationInitiatorActor_");
    includes(di3BuildSupplyReceiptRows_.toString(), "di3GetOperationInitiatorActor_");
    includes(di3ApplyManualStockOperation_.toString(), "di3GetOperationInitiatorActor_");
    includes(di3BuildOrderDispatchRows_.toString(), "di3GetOperationInitiatorActor_");
    includes(di3BuildOrderReturnRows_.toString(), "di3GetOperationInitiatorActor_");
  });

  test("remaining manual and administrative audit writers use the centralized actor accessor", function () {
    includes(di3RequeueQuarantinedOperation.toString(), "di3SettingsActor_()");
    includes(di3RequeueQuarantinedOperation.toString(), '"MANUAL_REOPEN"');
    includes(di3CloseAccountingPeriod.toString(), "di3GetActorEmail_()");
    includes(di3ReopenAccountingPeriod.toString(), "di3GetActorEmail_()");
    includes(di3CreateSchemaMigrationRecord_.toString(), "di3GetActorEmail_()");
    includes(di3BuildSupplyFullEditOperationPayload_.toString(), "edited_by: di3GetActorEmail_()");
    includes(di3ApplySupplyDocumentEditOperation_.toString(), "payload.edited_by");
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

  test("installation preflight blocks unknown populated tabs but ignores managed and blank tabs", function () {
    function fakeSheet(name, lastRow, lastColumn, charts, hidden) {
      return {
        getName: function () { return name; },
        getLastRow: function () { return lastRow; },
        getLastColumn: function () { return lastColumn; },
        getCharts: function () { return new Array(charts || 0); },
        isSheetHidden: function () { return !!hidden; }
      };
    }
    var unexpected = di3FindUnexpectedPopulatedTabs_([
      fakeSheet("StockLedger", 20, 13, 0),
      fakeSheet("Продукты", 30, 21, 0),
      fakeSheet("Sheet1", 0, 0, 0),
      fakeSheet("Sheet1", 2, 2, 0),
      fakeSheet("Scratch", 4, 3, 0, true),
      fakeSheet("Imported chart", 0, 0, 1)
    ]);
    equal(unexpected.length, 3);
    equal(unexpected[0].name, "Sheet1");
    equal(unexpected[1].name, "Scratch");
    equal(unexpected[1].hidden, true);
    equal(unexpected[2].name, "Imported chart");
  });

  test("clean baseline accepts a genuinely empty unversioned workbook", function () {
    var originalSpreadsheet = di3GetSpreadsheet_;
    var originalVersion = di3GetSchemaVersion_;
    var originalRows = di3GetSchemaMigrationRows_;
    try {
      di3GetSpreadsheet_ = function () { return { getSheetByName: function () { return null; } }; };
      di3GetSchemaVersion_ = function () { return 0; };
      di3GetSchemaMigrationRows_ = function () { return []; };
      var state = di3GetCleanBaselineState_();
      equal(state.eligible, true);
      equal(state.current_version, 0);
      equal(state.record, null);
    } finally {
      di3GetSpreadsheet_ = originalSpreadsheet;
      di3GetSchemaVersion_ = originalVersion;
      di3GetSchemaMigrationRows_ = originalRows;
    }
  });

  test("clean baseline rejects an unversioned workbook containing business rows", function () {
    var originalSpreadsheet = di3GetSpreadsheet_;
    var originalVersion = di3GetSchemaVersion_;
    var originalRows = di3GetSchemaMigrationRows_;
    try {
      var headers = DI3_TABLE_SCHEMAS.Products.slice();
      var productSheet = {
        getLastRow: function () { return 2; },
        getLastColumn: function () { return headers.length; },
        getMaxColumns: function () { return headers.length; },
        getRange: function () { return { getDisplayValues: function () { return [headers]; } }; }
      };
      di3GetSpreadsheet_ = function () {
        return { getSheetByName: function (name) { return name === "Products" ? productSheet : null; } };
      };
      di3GetSchemaVersion_ = function () { return 0; };
      di3GetSchemaMigrationRows_ = function () { return []; };
      equal(di3GetCleanBaselineState_().eligible, false);
    } finally {
      di3GetSpreadsheet_ = originalSpreadsheet;
      di3GetSchemaVersion_ = originalVersion;
      di3GetSchemaMigrationRows_ = originalRows;
    }
  });

  test("clean baseline rejects legacy or partially mismatched system headers", function () {
    var originalSpreadsheet = di3GetSpreadsheet_;
    var originalVersion = di3GetSchemaVersion_;
    var originalRows = di3GetSchemaMigrationRows_;
    try {
      var headers = DI3_TABLE_SCHEMAS.Products.slice();
      headers[0] = "legacy_product_id";
      var productSheet = {
        getLastRow: function () { return 1; },
        getLastColumn: function () { return headers.length; },
        getMaxColumns: function () { return headers.length; },
        getRange: function () { return { getDisplayValues: function () { return [headers]; } }; }
      };
      di3GetSpreadsheet_ = function () {
        return { getSheetByName: function (name) { return name === "Products" ? productSheet : null; } };
      };
      di3GetSchemaVersion_ = function () { return 0; };
      di3GetSchemaMigrationRows_ = function () { return []; };
      equal(di3GetCleanBaselineState_().eligible, false);
    } finally {
      di3GetSpreadsheet_ = originalSpreadsheet;
      di3GetSchemaVersion_ = originalVersion;
      di3GetSchemaMigrationRows_ = originalRows;
    }
  });

  test("completed clean baseline remains recognizable after normal business rows exist", function () {
    var originalSpreadsheet = di3GetSpreadsheet_;
    var originalVersion = di3GetSchemaVersion_;
    var originalRows = di3GetSchemaMigrationRows_;
    try {
      var headers = DI3_TABLE_SCHEMAS.Products.slice();
      var productSheet = {
        getLastRow: function () { return 2; },
        getLastColumn: function () { return headers.length; },
        getMaxColumns: function () { return headers.length; },
        getRange: function () { return { getDisplayValues: function () { return [headers]; } }; }
      };
      function headerOnlySheet(name) {
        var expected = DI3_TABLE_SCHEMAS[name];
        return {
          getLastRow: function () { return 1; },
          getLastColumn: function () { return expected.length; },
          getMaxColumns: function () { return expected.length; },
          getRange: function () { return { getDisplayValues: function () { return [expected]; } }; }
        };
      }
      var metaSheet = headerOnlySheet("_AppMeta");
      var migrationSheet = headerOnlySheet("SchemaMigrations");
      var record = { migration_key: DI3_CLEAN_BASELINE_MIGRATION_KEY, from_schema_version: 0,
        to_schema_version: DI3_SCHEMA_VERSION, status: "COMPLETED", row_number: 2 };
      di3GetSpreadsheet_ = function () {
        return { getSheetByName: function (name) {
          if (name === "Products") return productSheet;
          if (DI3_TABLE_SCHEMAS[name]) return headerOnlySheet(name);
          return null;
        } };
      };
      di3GetSchemaVersion_ = function () { return DI3_SCHEMA_VERSION; };
      di3GetSchemaMigrationRows_ = function () { return [record]; };
      var state = di3GetCleanBaselineState_();
      equal(state.eligible, true);
      equal(state.record.status, "COMPLETED");
    } finally {
      di3GetSpreadsheet_ = originalSpreadsheet;
      di3GetSchemaVersion_ = originalVersion;
      di3GetSchemaMigrationRows_ = originalRows;
    }
  });

  test("clean install Dry Run proposes one final baseline, not the RC8 migration chain", function () {
    var originalSpreadsheet = di3GetSpreadsheet_;
    var originalVersion = di3GetSchemaVersion_;
    var originalRows = di3GetSchemaMigrationRows_;
    try {
      di3GetSpreadsheet_ = function () { return { getSheetByName: function () { return null; } }; };
      di3GetSchemaVersion_ = function () { return 0; };
      di3GetSchemaMigrationRows_ = function () { return []; };
      var report = di3GetSchemaVersioningReport_();
      equal(report.status, "READY");
      equal(report.installation_path, "CLEAN_FINAL_BASELINE");
      equal(report.planned_changes.length, 1);
      equal(report.planned_changes[0].migration_key, DI3_CLEAN_BASELINE_MIGRATION_KEY);
      equal(report.planned_changes.some(function (item) { return String(item.migration_key).indexOf("RC8_") === 0; }), false);
    } finally {
      di3GetSpreadsheet_ = originalSpreadsheet;
      di3GetSchemaVersion_ = originalVersion;
      di3GetSchemaMigrationRows_ = originalRows;
    }
  });

  test("unversioned populated workbook is blocked instead of being adopted as clean or legacy", function () {
    var originalSpreadsheet = di3GetSpreadsheet_;
    var originalVersion = di3GetSchemaVersion_;
    var originalRows = di3GetSchemaMigrationRows_;
    try {
      var headers = DI3_TABLE_SCHEMAS.Products.slice();
      var productSheet = {
        getLastRow: function () { return 2; },
        getLastColumn: function () { return headers.length; },
        getMaxColumns: function () { return headers.length; },
        getRange: function () { return { getDisplayValues: function () { return [headers]; } }; }
      };
      di3GetSpreadsheet_ = function () {
        return { getSheetByName: function (name) { return name === "Products" ? productSheet : null; } };
      };
      di3GetSchemaVersion_ = function () { return 0; };
      di3GetSchemaMigrationRows_ = function () { return []; };
      var report = di3GetSchemaVersioningReport_();
      equal(report.status, "BLOCKED");
      equal(report.installation_path, "UNRECOGNIZED_OR_DAMAGED");
      equal(report.planned_changes.length, 0);
    } finally {
      di3GetSpreadsheet_ = originalSpreadsheet;
      di3GetSchemaVersion_ = originalVersion;
      di3GetSchemaMigrationRows_ = originalRows;
    }
  });

  test("interrupted clean baseline with STARTED record can resume after header revalidation", function () {
    var originalSpreadsheet = di3GetSpreadsheet_;
    var originalVersion = di3GetSchemaVersion_;
    var originalRows = di3GetSchemaMigrationRows_;
    try {
      var headers = DI3_TABLE_SCHEMAS.Products.slice();
      var productSheet = {
        getLastRow: function () { return 2; },
        getLastColumn: function () { return headers.length; },
        getMaxColumns: function () { return headers.length; },
        getRange: function () { return { getDisplayValues: function () { return [headers]; } }; }
      };
      function headerOnlySheet(name) {
        var expected = DI3_TABLE_SCHEMAS[name];
        return {
          getLastRow: function () { return 1; },
          getLastColumn: function () { return expected.length; },
          getMaxColumns: function () { return expected.length; },
          getRange: function () { return { getDisplayValues: function () { return [expected]; } }; }
        };
      }
      var record = { migration_key: DI3_CLEAN_BASELINE_MIGRATION_KEY, from_schema_version: 0,
        to_schema_version: DI3_SCHEMA_VERSION, status: "STARTED", row_number: 2 };
      di3GetSpreadsheet_ = function () {
        return { getSheetByName: function (name) {
          if (name === "Products") return productSheet;
          if (DI3_TABLE_SCHEMAS[name]) return headerOnlySheet(name);
          return null;
        } };
      };
      di3GetSchemaVersion_ = function () { return 0; };
      di3GetSchemaMigrationRows_ = function () { return [record]; };
      var state = di3GetCleanBaselineState_();
      equal(state.eligible, true);
      var report = di3GetSchemaVersioningReport_();
      equal(report.status, "READY");
      equal(report.planned_changes.length, 1);
      equal(report.planned_changes[0].type, "RESUME_CLEAN_FINAL_BASELINE");
    } finally {
      di3GetSpreadsheet_ = originalSpreadsheet;
      di3GetSchemaVersion_ = originalVersion;
      di3GetSchemaMigrationRows_ = originalRows;
    }
  });

  test("clean baseline rejects a duplicate or version-mismatched journal identity", function () {
    var originalSpreadsheet = di3GetSpreadsheet_;
    var originalVersion = di3GetSchemaVersion_;
    var originalRows = di3GetSchemaMigrationRows_;
    try {
      function headerOnlySheet(name) {
        var expected = DI3_TABLE_SCHEMAS[name];
        return {
          getLastRow: function () { return 1; },
          getLastColumn: function () { return expected.length; },
          getMaxColumns: function () { return expected.length; },
          getRange: function () { return { getDisplayValues: function () { return [expected]; } }; }
        };
      }
      di3GetSpreadsheet_ = function () {
        return { getSheetByName: function (name) {
          return DI3_TABLE_SCHEMAS[name] ? headerOnlySheet(name) : null;
        } };
      };
      di3GetSchemaVersion_ = function () { return DI3_SCHEMA_VERSION; };
      var record = { migration_key: DI3_CLEAN_BASELINE_MIGRATION_KEY, from_schema_version: 0,
        to_schema_version: DI3_SCHEMA_VERSION, status: "COMPLETED", row_number: 2 };
      di3GetSchemaMigrationRows_ = function () { return [record, Object.assign({}, record, { row_number: 3 })]; };
      equal(di3GetCleanBaselineState_().eligible, false, "Duplicate baseline rows must be rejected");
      di3GetSchemaMigrationRows_ = function () {
        return [{ migration_key: DI3_CLEAN_BASELINE_MIGRATION_KEY, from_schema_version: 0,
          to_schema_version: DI3_SCHEMA_VERSION, status: "STARTED", row_number: 2 }];
      };
      di3GetSchemaVersion_ = function () { return 1; };
      equal(di3GetCleanBaselineState_().eligible, false, "Unexpected version must be rejected");
    } finally {
      di3GetSpreadsheet_ = originalSpreadsheet;
      di3GetSchemaVersion_ = originalVersion;
      di3GetSchemaMigrationRows_ = originalRows;
    }
  });

  test("clean baseline rejects populated columns outside the target table schema", function () {
    var originalSpreadsheet = di3GetSpreadsheet_;
    var originalVersion = di3GetSchemaVersion_;
    var originalRows = di3GetSchemaMigrationRows_;
    try {
      var headers = DI3_TABLE_SCHEMAS.Products.slice();
      var productSheet = {
        getLastRow: function () { return 1; },
        getLastColumn: function () { return headers.length + 1; },
        getMaxColumns: function () { return headers.length + 1; },
        getRange: function () { return { getDisplayValues: function () { return [headers]; } }; }
      };
      di3GetSpreadsheet_ = function () {
        return { getSheetByName: function (name) { return name === "Products" ? productSheet : null; } };
      };
      di3GetSchemaVersion_ = function () { return 0; };
      di3GetSchemaMigrationRows_ = function () { return []; };
      equal(di3GetCleanBaselineState_().eligible, false);
    } finally {
      di3GetSpreadsheet_ = originalSpreadsheet;
      di3GetSchemaVersion_ = originalVersion;
      di3GetSchemaMigrationRows_ = originalRows;
    }
  });

  test("completed clean baseline blocks setup when a required system table is missing", function () {
    var originalSpreadsheet = di3GetSpreadsheet_;
    var originalVersion = di3GetSchemaVersion_;
    var originalRows = di3GetSchemaMigrationRows_;
    try {
      function headerOnlySheet(name) {
        var expected = DI3_TABLE_SCHEMAS[name];
        return {
          getLastRow: function () { return 1; },
          getLastColumn: function () { return expected.length; },
          getMaxColumns: function () { return expected.length; },
          getRange: function () { return { getDisplayValues: function () { return [expected]; } }; }
        };
      }
      di3GetSpreadsheet_ = function () {
        return { getSheetByName: function (name) {
          return name === "_AppMeta" || name === "SchemaMigrations" ? headerOnlySheet(name) : null;
        } };
      };
      di3GetSchemaVersion_ = function () { return DI3_SCHEMA_VERSION; };
      di3GetSchemaMigrationRows_ = function () {
        return [{ migration_key: DI3_CLEAN_BASELINE_MIGRATION_KEY, from_schema_version: 0,
          to_schema_version: DI3_SCHEMA_VERSION, status: "COMPLETED", row_number: 2 }];
      };
      var state = di3GetCleanBaselineState_();
      equal(state.eligible, false);
      equal(state.issues.some(function (issue) { return issue.indexOf("Products") >= 0; }), true);
    } finally {
      di3GetSpreadsheet_ = originalSpreadsheet;
      di3GetSchemaVersion_ = originalVersion;
      di3GetSchemaMigrationRows_ = originalRows;
    }
  });

  test("completed clean baseline rejects a system table whose entire header row was cleared", function () {
    var originalSpreadsheet = di3GetSpreadsheet_;
    var originalVersion = di3GetSchemaVersion_;
    var originalRows = di3GetSchemaMigrationRows_;
    try {
      function headerSheet(name, blankHeader) {
        var expected = DI3_TABLE_SCHEMAS[name];
        var values = blankHeader ? expected.map(function () { return ""; }) : expected.slice();
        return {
          getLastRow: function () { return name === "Products" ? 2 : 1; },
          getLastColumn: function () { return expected.length; },
          getMaxColumns: function () { return expected.length; },
          getRange: function () { return { getDisplayValues: function () { return [values]; } }; }
        };
      }
      di3GetSpreadsheet_ = function () {
        return { getSheetByName: function (name) {
          return DI3_TABLE_SCHEMAS[name] ? headerSheet(name, name === "Products") : null;
        } };
      };
      di3GetSchemaVersion_ = function () { return DI3_SCHEMA_VERSION; };
      di3GetSchemaMigrationRows_ = function () {
        return [{ migration_key: DI3_CLEAN_BASELINE_MIGRATION_KEY, from_schema_version: 0,
          to_schema_version: DI3_SCHEMA_VERSION, status: "COMPLETED", row_number: 2 }];
      };
      var state = di3GetCleanBaselineState_();
      equal(state.eligible, false);
      equal(state.issues.some(function (issue) {
        return issue.indexOf("Products") >= 0 && issue.indexOf("заголовков") >= 0;
      }), true);
    } finally {
      di3GetSpreadsheet_ = originalSpreadsheet;
      di3GetSchemaVersion_ = originalVersion;
      di3GetSchemaMigrationRows_ = originalRows;
    }
  });

  test("clean baseline adoption writes one final journal record and reruns idempotently", function () {
    var originals = {
      report: di3GetSchemaVersioningReport_,
      validate: di3ValidateExistingCoreSchemas_,
      spreadsheet: di3GetSpreadsheet_,
      state: di3GetCleanBaselineState_,
      version: di3GetSchemaVersion_,
      rows: di3GetSchemaMigrationRows_,
      create: di3CreateSchemaMigrationRecord_,
      setMeta: di3SetAppMetaValue_,
      setStatus: di3SetSchemaMigrationStatus_
    };
    var version = 0;
    var records = [];
    var createCount = 0;
    var statusWriteCount = 0;
    try {
      di3GetSchemaVersioningReport_ = function () { return { issues: [] }; };
      di3ValidateExistingCoreSchemas_ = function () { return []; };
      di3GetSpreadsheet_ = function () { return { getSheetByName: function () { return {}; } }; };
      di3GetCleanBaselineState_ = function () {
        return { eligible: true, record: records.length ? records[0] : null };
      };
      di3GetSchemaVersion_ = function () { return version; };
      di3GetSchemaMigrationRows_ = function () { return records; };
      di3CreateSchemaMigrationRecord_ = function (definition) {
        createCount++;
        records.push({
          migration_key: definition.key, from_schema_version: definition.from,
          to_schema_version: definition.to, status: "STARTED", row_number: 2
        });
        return records[0];
      };
      di3SetAppMetaValue_ = function (key, value) {
        equal(key, "schema_version");
        version = value;
      };
      di3SetSchemaMigrationStatus_ = function (rowNumber, status) {
        equal(rowNumber, 2);
        records[0].status = status;
        statusWriteCount++;
      };

      var first = di3EnsureSchemaVersioning_(null);
      equal(first.installation_path, "CLEAN_FINAL_BASELINE");
      equal(first.status, "INITIALIZED_CLEAN_BASELINE");
      equal(version, DI3_SCHEMA_VERSION);
      equal(records.length, 1);
      equal(records[0].migration_key, DI3_CLEAN_BASELINE_MIGRATION_KEY);
      equal(records[0].status, "COMPLETED");
      equal(createCount, 1);
      equal(statusWriteCount, 1);

      var second = di3EnsureSchemaVersioning_(null);
      equal(second.installation_path, "CLEAN_FINAL_BASELINE");
      equal(second.status, "CURRENT");
      equal(records.length, 1, "Rerun must not append another baseline record");
      equal(createCount, 1, "Rerun must not recreate the baseline");
      equal(statusWriteCount, 1, "Rerun must not rewrite a completed journal row");

      // Simulate interruption after schema_version was written but before
      // the clean-baseline journal row was marked COMPLETED.
      records[0].status = "STARTED";
      var resumed = di3EnsureSchemaVersioning_(null);
      equal(resumed.status, "RESUMED_CLEAN_BASELINE");
      equal(version, DI3_SCHEMA_VERSION, "Recovery must not rewrite an already-correct version");
      equal(records.length, 1, "Recovery must reuse the original baseline row");
      equal(createCount, 1, "Recovery must not create a duplicate baseline row");
      equal(records[0].status, "COMPLETED");
      equal(statusWriteCount, 2, "Recovery must complete the existing journal row once");
    } finally {
      di3GetSchemaVersioningReport_ = originals.report;
      di3ValidateExistingCoreSchemas_ = originals.validate;
      di3GetSpreadsheet_ = originals.spreadsheet;
      di3GetCleanBaselineState_ = originals.state;
      di3GetSchemaVersion_ = originals.version;
      di3GetSchemaMigrationRows_ = originals.rows;
      di3CreateSchemaMigrationRecord_ = originals.create;
      di3SetAppMetaValue_ = originals.setMeta;
      di3SetSchemaMigrationStatus_ = originals.setStatus;
    }
  });

  test("F-02 freezes business_date as the final v4 order column and a 3-to-4 migration", function () {
    equal(DI3_SCHEMA_VERSION, 4);
    equal(DI3_TABLE_SCHEMAS.V3_Orders.length, 30);
    equal(DI3_TABLE_SCHEMAS.V3_Orders[28], "commission_payer");
    equal(DI3_TABLE_SCHEMAS.V3_Orders[29], "business_date");
    var migration = DI3_SCHEMA_MIGRATION_DEFINITIONS.filter(function (item) {
      return item.key === "RC8_ORDER_BUSINESS_DATE_V4";
    })[0];
    equal(!!migration, true);
    equal(migration.from, 3);
    equal(migration.to, 4);
  });

  test("F-02 migration writes only column AD and preflight blocks ambiguous tail data", function () {
    var migrationSource = di3ApplyOrderBusinessDateMigration_.toString();
    includes(migrationSource, 'sheet.getRange(2, 30, updates.length, 1).setValues(updates)');
    includes(migrationSource, 'sheet.getRange(1, 30).setValue(targetHeader)');
    equal(migrationSource.indexOf('getRange(2, 1,') === -1, true,
      "Business-date backfill must not rewrite the existing order row prefix");
    var preflightSource = di3PreflightCoreSchemas_.toString();
    includes(preflightSource, "business_date");
    includes(preflightSource, "businessDateHeader");
    var historicalWorkflowSource = di3CreateHistoricalSale.toString();
    includes(historicalWorkflowSource, 'dispatchOperation.values[5]');
    includes(historicalWorkflowSource, 'persistedDispatchPayload.historical_mode !== true');
  });

  test("backup full-hash priority includes append-only FIFO archive and replay history", function () {
    ["StockLedger", "StockAllocations", "FifoAllocationRuns", "FifoAllocationArchive",
      "FifoLotCacheArchive", "FifoReplayEvents"].forEach(function (sheetName) {
      equal(DI3_BACKUP_HASH_PRIORITY_SHEETS.indexOf(sheetName) >= 0, true,
        "Backup priority must include " + sheetName);
    });
    includes(di3GetSpreadsheetBackupSnapshot_.toString(), "spreadsheet.getSheets()");
  });

  var report = { passed: passed, failed: failed.length, failures: failed };
  if (failed.length) throw new Error("System Safety UX tests failed: " + JSON.stringify(failed));
  return report;
}
