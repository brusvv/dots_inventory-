/**
 * Dots Inventory v3 RC8 — temporary, MUTATING C-04 fault-injection probe.
 *
 * Use ONLY on an isolated TEST COPY with a recent Drive backup.
 * Each invocation creates one real test business operation. It wraps one
 * production write, lets that write succeed, then throws once so the normal
 * executor records a failed attempt and the real recovery path can replay it.
 * This file is diagnostic-only and MUST NOT be copied into production modules.
 */

var DI3_TMP_C04_ALLOWED_TARGETS = Object.freeze({
  MANUAL_STOCK_MOVEMENT: [
    "APPEND:StockLedger", "APPEND:StockMovementDetails", "APPEND:StockLots", "FIFO_REBUILD",
    "OPERATION_COMMIT_ACK"
  ],
  SUPPLY_RECEIVE: [
    "APPEND:StockLedger", "APPEND:StockMovementDetails", "APPEND:StockLots",
    "APPEND:ProductCostHistory", "APPEND:DocumentStatusHistory",
    "SUPPLY_STATUS_PROJECTION", "PACK_VARIANT_PROJECTION", "FIFO_REBUILD",
    "OPERATION_COMMIT_ACK"
  ],
  ORDER_DISPATCH: [
    "APPEND:StockLedger", "APPEND:StockMovementDetails", "APPEND:DocumentStatusHistory",
    "ORDER_ITEM_DISPATCH_LINKS", "ORDER_STATUS_PROJECTION", "FIFO_REBUILD",
    "OPERATION_COMMIT_ACK"
  ],
  ORDER_RETURN: [
    "APPEND:StockLedger", "APPEND:StockMovementDetails", "APPEND:StockLots",
    "APPEND:DocumentStatusHistory", "ORDER_STATUS_PROJECTION", "FIFO_REBUILD",
    "OPERATION_COMMIT_ACK"
  ],
  ORDER_CREATE: [
    "APPEND:V3_Orders", "APPEND:V3_OrderItems", "APPEND:DocumentStatusHistory",
    "OPERATION_COMMIT_ACK"
  ]
});

function di3TmpC04InjectManualStock(command, target, confirmation) {
  return di3TmpC04RunCase_("MANUAL_STOCK_MOVEMENT", target, confirmation, function () {
    return di3PostManualStockMovement(command || {});
  });
}

function di3TmpC04InjectSupplyReceive(supplyNumber, effectiveAt, target, confirmation) {
  return di3TmpC04RunCase_("SUPPLY_RECEIVE", target, confirmation, function () {
    return di3ReceiveSupply(supplyNumber, effectiveAt);
  });
}

function di3TmpC04InjectOrderCreate(command, target, confirmation) {
  return di3TmpC04RunCase_("ORDER_CREATE", target, confirmation, function () {
    return di3CreateOrder(command || {});
  });
}

function di3TmpC04InjectOrderDispatch(orderNumber, effectiveAt, target, confirmation) {
  return di3TmpC04RunCase_("ORDER_DISPATCH", target, confirmation, function () {
    return di3AdvanceOrderStatus(orderNumber, DI3_ORDER_STATUS.IN_TRANSIT, effectiveAt);
  });
}

function di3TmpC04InjectOrderReturn(orderNumber, effectiveAt, target, confirmation) {
  return di3TmpC04RunCase_("ORDER_RETURN", target, confirmation, function () {
    return di3AdvanceOrderStatus(orderNumber, DI3_ORDER_STATUS.RETURNED, effectiveAt);
  });
}

function di3TmpC04RunCase_(operationType, target, confirmation, action) {
  if (String(confirmation || "") !== "TEST_COPY_ONLY") {
    throw new Error("Запуск заблокирован. Передай confirmation='TEST_COPY_ONLY' после создания резервной копии тестовой таблицы.");
  }
  operationType = String(operationType || "");
  target = String(target || "");
  var allowed = DI3_TMP_C04_ALLOWED_TARGETS[operationType] || [];
  if (allowed.indexOf(target) === -1) {
    throw new Error("Недопустимая точка отказа для " + operationType + ": " + target + ". Допустимые: " + allowed.join(", "));
  }
  if (typeof action !== "function") throw new Error("Не передана тестовая операция.");
  if (typeof DI3_TABLE_SCHEMAS === "undefined" || typeof di3GetSpreadsheet_ !== "function" ||
      typeof di3RecoverPreparedOperations_ !== "function" || typeof di3WithLock_ !== "function") {
    throw new Error("Не найдены production-компоненты C-04. Установи согласованный комплект RC8 на тестовую копию.");
  }

  var ss = di3GetSpreadsheet_();
  ["Operations", "OperationPayloads", "OperationAttempts"].forEach(function (name) {
    var sheet = ss.getSheetByName(name);
    if (!sheet || sheet.getLastRow() < 1) throw new Error("Отсутствует или не инициализирован системный лист " + name + ". Сначала выполни штатную установку на тестовой копии.");
  });
  if (target.indexOf("APPEND:") === 0) {
    var targetSheet = target.substring(7);
    if (!DI3_TABLE_SCHEMAS[targetSheet] || !ss.getSheetByName(targetSheet)) {
      throw new Error("Целевая таблица отсутствует или не описана схемой: " + targetSheet);
    }
  }

  var handlerRegistry = di3GetOperationHandlerRegistry_();
  if (!handlerRegistry || typeof handlerRegistry[operationType] !== "function") {
    throw new Error("Для operation type не найден production handler: " + operationType);
  }
  var baselineFifo = di3GetFifoIntegrityDiagnostics_();
  if (!baselineFifo || !baselineFifo.ok) {
    throw new Error("Базовая FIFO integrity проверка не пройдена. Fault injection заблокирован, сначала разберись с исходными ошибками: " +
      (baselineFifo && Array.isArray(baselineFifo.errors) ? baselineFifo.errors.slice(0, 5).join(" | ") : "diagnostics unavailable"));
  }

  var beforeRows = di3ReadTableValues_("Operations");
  var beforeIds = Object.create(null);
  beforeRows.forEach(function (row) { if (row[0]) beforeIds[String(row[0])] = true; });
  var pending = beforeRows.filter(function (row) {
    return ["PREPARED", "RETRYABLE", "QUARANTINED"].indexOf(String(row[5] || "")) !== -1;
  });
  if (pending.length) {
    throw new Error("Проба заблокирована: в Operations уже есть незавершённые/карантинные операции (" + pending.length + "). Сначала разберись с ними отдельно; проба не должна восстанавливать чужие документы.");
  }
  var attemptStatsBefore = di3GetOperationAttemptStats_();
  if (attemptStatsBefore.incomplete && attemptStatsBefore.incomplete.length) {
    throw new Error("Проба заблокирована: в OperationAttempts есть STARTED/незавершённые попытки (" + attemptStatsBefore.incomplete.length + "). Сначала проверь журнал отдельно.");
  }

  var state = { injected: false, target: target, injected_at: null };
  var restore = di3TmpC04InstallFault_(target, state);
  var triggerError = null;
  var actionResult = null;
  try {
    actionResult = action();
  } catch (error) {
    triggerError = String(error && error.message || error);
  } finally {
    restore();
  }

  var afterRows = di3ReadTableValues_("Operations");
  var created = [];
  afterRows.forEach(function (row, index) {
    var id = String(row[0] || "");
    if (!id || beforeIds[id] || String(row[2]) !== operationType) return;
    created.push({ row_number: index + 2, values: row });
  });
  if (!state.injected) {
    return di3TmpC04ProbePrint_({
      status: "INJECTION_NOT_REACHED",
      operation_type: operationType,
      target: target,
      trigger_error: triggerError,
      action_result_status: actionResult && actionResult.status || null,
      new_operations_of_type: created.length,
      note: "Точка не была достигнута. Ничего принудительно не восстанавливалось. Проверь подготовку документа/данных и выбери точку записи, которая реально выполняется."
    });
  }
  if (created.length !== 1) {
    return di3TmpC04ProbePrint_({
      status: "REVIEW_REQUIRED",
      operation_type: operationType,
      target: target,
      injection_reached: true,
      trigger_error: triggerError,
      new_operations_of_type: created.length,
      note: "После fault injection ожидалась ровно одна новая операция. Recovery автоматически не запускался, чтобы не затронуть неоднозначный набор документов."
    });
  }

  var operationId = String(created[0].values[0]);
  var operationRecord = di3BuildOperationRecord_(created[0].row_number, created[0].values);
  var pendingStatus = String(created[0].values[5] || "");
  if (target === "OPERATION_COMMIT_ACK" && pendingStatus === "COMMITTED") {
    // The final status write persisted, but the injected exception simulates a
    // lost acknowledgement. Recovery must not replay the domain handler or
    // downgrade COMMITTED; the executor should finish the attempt as COMMITTED.
    var committedAttempts = di3GetOperationAttemptRows_(operationId).slice().sort(function (a, b) { return a.row_number - b.row_number; });
    var committedPayload = di3ReadVerifiedOperationPayload_(di3FindRowByFirstColumn_("Operations", operationId));
    var committedVerification = di3TmpC04VerifyBusinessProjection_(operationType, operationId, committedPayload, created[0]);
    var singleCommittedAttempt = committedAttempts.length === 1 && String(committedAttempts[0].values[8]) === "COMMITTED";
    var callerReceivedCommit = !!(actionResult && actionResult.commit_ack_recovered === true &&
      String(actionResult.operation_id || "") === operationId);
    var committedStatus = singleCommittedAttempt && callerReceivedCommit && committedVerification.ok ? "PASS" : "REVIEW_REQUIRED";
    return di3TmpC04ProbePrint_({
      status: committedStatus,
      operation_type: operationType,
      target: target,
      injection_reached: state.injected,
      operation_id: operationId,
      operation_status_after_fault: pendingStatus,
      trigger_error: triggerError,
      action_result_status: actionResult && actionResult.status || null,
      action_result_commit_ack_recovered: !!(actionResult && actionResult.commit_ack_recovered),
      recovery_result: "NOT_REQUIRED_DURABLE_COMMIT",
      attempt_count: committedAttempts.length,
      attempt_statuses: committedAttempts.map(function (item) {
        return { attempt_number: Number(item.values[2]) || 0, mode: String(item.values[5] || ""),
          result_status: String(item.values[8] || ""), error_class: String(item.values[9] || "") };
      }),
      attempt_pattern_correct: singleCommittedAttempt,
      caller_received_commit: callerReceivedCommit,
      business_projection: committedVerification,
      warnings: [
        "Этот сценарий проверяет потерю подтверждения после записи COMMITTED; возвращается успешный исходный бизнес-ответ (например CREATED для создания заказа) с commit_ack_recovered=true, повторное исполнение обработчика не выполняется.",
        "Операция и созданные тестовые бизнес-строки остаются в тестовой копии для аудита."
      ]
    });
  }
  if (["PREPARED", "RETRYABLE"].indexOf(pendingStatus) === -1) {
    return di3TmpC04ProbePrint_({
      status: "REVIEW_REQUIRED",
      operation_type: operationType,
      target: target,
      operation_id: operationId,
      operation_status_after_fault: pendingStatus,
      trigger_error: triggerError,
      note: "Запись после fault injection не осталась в ожидаемом pending-состоянии. Не запускал автоматическое восстановление."
    });
  }

  var recovery = di3WithLock_(function () { return di3RecoverPreparedOperations_([operationType]); });
  var latest = di3FindRowByFirstColumn_("Operations", operationId);
  var attempts = di3GetOperationAttemptRows_(operationId).slice().sort(function (a, b) { return a.row_number - b.row_number; });
  var payload = di3ReadVerifiedOperationPayload_(latest || operationRecord);
  var verification = di3TmpC04VerifyBusinessProjection_(operationType, operationId, payload, latest);
  var attemptStatuses = attempts.map(function (item) {
    return {
      attempt_number: Number(item.values[2]) || 0,
      mode: String(item.values[5] || ""),
      result_status: String(item.values[8] || ""),
      error_class: String(item.values[9] || "")
    };
  });
  var recovered = recovery.results.filter(function (item) { return String(item.operation_id) === operationId; })[0] || null;
  var operationCommitted = !!latest && String(latest.values[5]) === "COMMITTED";
  var attemptPatternCorrect = attempts.length === 2 &&
    String(attempts[0].values[8]) === "PREPARED" && String(attempts[1].values[8]) === "COMMITTED";
  var status = operationCommitted && attemptPatternCorrect && verification.ok ? "PASS" : "REVIEW_REQUIRED";

  return di3TmpC04ProbePrint_({
    status: status,
    operation_type: operationType,
    target: target,
    injection_reached: state.injected,
    operation_id: operationId,
    operation_status_before_recovery: pendingStatus,
    operation_status_after_recovery: latest ? String(latest.values[5]) : "MISSING",
    trigger_error: triggerError,
    recovery_result: recovered ? String(recovered.status || "") : "NOT_RETURNED",
    attempt_count: attempts.length,
    attempt_statuses: attemptStatuses,
    attempt_pattern_correct: attemptPatternCorrect,
    business_projection: verification,
    warnings: [
      "Это реальное выполнение кода Apps Script на тестовой копии, но не доказательство атомарности Sheets API при сетевом/серверном обрыве.",
      "Операция и созданные тестовые бизнес-строки остаются в тестовой копии для сверки; проба не удаляет их и не трогает рабочую таблицу."
    ]
  });
}

function di3TmpC04InstallFault_(target, state) {
  function fault_() {
    state.injected = true;
    state.injected_at = new Date();
    var error = new Error("DI3_TEST_POST_WRITE_FAULT: " + target);
    error.di3OperationErrorClass = "TEST_INJECTED_POST_WRITE";
    throw error;
  }
  if (target.indexOf("APPEND:") === 0) {
    var expectedSheet = target.substring(7);
    var originalAppend = di3AppendTableRows_;
    di3AppendTableRows_ = function (sheetName, rows) {
      var result = originalAppend(sheetName, rows);
      if (!state.injected && String(sheetName) === expectedSheet && rows && rows.length) fault_();
      return result;
    };
    return function () { di3AppendTableRows_ = originalAppend; };
  }
  if (target === "SUPPLY_STATUS_PROJECTION") {
    var originalSupplyStatus = di3SetSupplyStatusCell_;
    di3SetSupplyStatusCell_ = function (supply, newStatus, effectiveAt) {
      var result = originalSupplyStatus(supply, newStatus, effectiveAt);
      if (!state.injected && String(newStatus) === String(DI3_SUPPLY_STATUS.RECEIVED)) fault_();
      return result;
    };
    return function () { di3SetSupplyStatusCell_ = originalSupplyStatus; };
  }
  if (target === "ORDER_ITEM_DISPATCH_LINKS") {
    var originalLinks = di3UpdateOrderItemsDispatchLinks_;
    di3UpdateOrderItemsDispatchLinks_ = function (payload) {
      var result = originalLinks(payload);
      if (!state.injected) fault_();
      return result;
    };
    return function () { di3UpdateOrderItemsDispatchLinks_ = originalLinks; };
  }
  if (target === "ORDER_STATUS_PROJECTION") {
    var originalOrderStatus = di3WriteOrderStatus_;
    di3WriteOrderStatus_ = function (order, newStatus, effectiveAt, operationId, note) {
      var result = originalOrderStatus(order, newStatus, effectiveAt, operationId, note);
      if (!state.injected && [DI3_ORDER_STATUS.IN_TRANSIT, DI3_ORDER_STATUS.RETURNED].indexOf(String(newStatus)) !== -1) fault_();
      return result;
    };
    return function () { di3WriteOrderStatus_ = originalOrderStatus; };
  }
  if (target === "FIFO_REBUILD") {
    var originalFifoRebuild = di3RebuildFifoAllocations_;
    di3RebuildFifoAllocations_ = function (reason, productIds) {
      var result = originalFifoRebuild(reason, productIds);
      if (!state.injected) fault_();
      return result;
    };
    return function () { di3RebuildFifoAllocations_ = originalFifoRebuild; };
  }
  if (target === "PACK_VARIANT_PROJECTION") {
    var originalPackProjection = di3SetCurrentPackVariantsFromReceipt_;
    di3SetCurrentPackVariantsFromReceipt_ = function (payload) {
      var result = originalPackProjection(payload);
      // A zero result means this receipt did not change any current variant,
      // therefore no projection write occurred and this is not a valid fault point.
      if (!state.injected && Number(result) > 0) fault_();
      return result;
    };
    return function () { di3SetCurrentPackVariantsFromReceipt_ = originalPackProjection; };
  }
  if (target === "OPERATION_COMMIT_ACK") {
    var originalOperationStatus = di3SetOperationStatus_;
    di3SetOperationStatus_ = function (rowNumber, status, committedAt, errorText) {
      var result = originalOperationStatus(rowNumber, status, committedAt, errorText);
      if (!state.injected && String(status) === "COMMITTED") fault_();
      return result;
    };
    return function () { di3SetOperationStatus_ = originalOperationStatus; };
  }
  throw new Error("Реализация fault wrapper отсутствует для target=" + target);
}

function di3TmpC04VerifyBusinessProjection_(operationType, operationId, payload, operationRecord) {
  var report = { ok: true, errors: [], ledger_rows: 0, detail_rows: 0, lot_rows: 0 };
  var isStock = operationType !== "ORDER_CREATE";
  if (!isStock) {
    var order = di3GetOrderById_(payload.order_id);
    var items = di3GetOrderItems_(payload.order_id);
    var history = di3ReadRowsByColumnValue_("DocumentStatusHistory", 2, payload.order_id).filter(function (match) {
      return String(match.values[1]) === "ORDER" && String(match.values[4]) === String(DI3_ORDER_STATUS.NEW);
    });
    report.order_exists = !!order;
    report.order_item_count = items.length;
    report.expected_order_item_count = payload.item_rows.length;
    report.status_history_exists = history.length > 0;
    if (!order) report.errors.push("ORDER_NOT_FOUND");
    if (items.length !== payload.item_rows.length) report.errors.push("ORDER_ITEM_COUNT_MISMATCH");
    if (!history.length) report.errors.push("ORDER_NEW_STATUS_HISTORY_MISSING");
    report.ok = report.errors.length === 0;
    return report;
  }

  var movementIds = [];
  if (operationType === "MANUAL_STOCK_MOVEMENT") movementIds = [String(operationRecord.values[4])];
  else movementIds = (payload.lines || []).map(function (line) { return String(line.movement_id); });
  var ledger = di3ReadRowsByColumnValue_("StockLedger", 1, operationId);
  var details = [];
  var lots = [];
  movementIds.forEach(function (movementId) {
    details = details.concat(di3ReadRowsByColumnValue_("StockMovementDetails", 0, movementId));
    lots = lots.concat(di3ReadRowsByColumnValue_("StockLots", 2, movementId));
  });
  var expectedMovements = movementIds.length;
  var expectedLots = 0;
  if (operationType === "SUPPLY_RECEIVE" || operationType === "ORDER_RETURN") expectedLots = movementIds.length;
  if (operationType === "MANUAL_STOCK_MOVEMENT" && String(payload.direction) === "IN") expectedLots = 1;
  report.ledger_rows = ledger.length;
  report.detail_rows = details.length;
  report.lot_rows = lots.length;
  report.expected_movement_rows = expectedMovements;
  report.expected_lot_rows = expectedLots;
  if (ledger.length !== expectedMovements) report.errors.push("LEDGER_ROW_COUNT_MISMATCH");
  if (details.length !== expectedMovements) report.errors.push("DETAIL_ROW_COUNT_MISMATCH");
  if (lots.length !== expectedLots) report.errors.push("LOT_ROW_COUNT_MISMATCH");

  if (operationType === "SUPPLY_RECEIVE") {
    var supply = di3GetSupplyById_(payload.supply_id);
    report.supply_status = supply ? String(supply.status || "") : "MISSING";
    report.received_at_present = !!(supply && supply.received_at);
    var supplyHistory = di3ReadRowsByColumnValue_("DocumentStatusHistory", 2, payload.supply_id).filter(function (match) {
      return String(match.values[1]) === "SUPPLY" && String(match.values[4]) === String(DI3_SUPPLY_STATUS.RECEIVED);
    });
    report.received_status_history_exists = supplyHistory.length > 0;
    if (!supply || String(supply.status) !== String(DI3_SUPPLY_STATUS.RECEIVED) || !supply.received_at) {
      report.errors.push("SUPPLY_RECEIPT_PROJECTION_INCOMPLETE");
    }
    if (!supplyHistory.length) report.errors.push("SUPPLY_RECEIVED_HISTORY_MISSING");
    var expectedCurrentVariantByProduct = Object.create(null);
    (payload.lines || []).forEach(function (line) {
      expectedCurrentVariantByProduct[String(line.product_id)] = String(line.pack_variant_id);
    });
    var packVariantIndex = di3LoadPackVariantIndex_();
    var packVariantProjectionValid = Object.keys(expectedCurrentVariantByProduct).every(function (productId) {
      var variantId = expectedCurrentVariantByProduct[productId];
      var variant = packVariantIndex.byId[variantId];
      return !!variant && String(variant.product_id) === productId &&
        (variant.is_current === true || String(variant.is_current).toLowerCase() === "true");
    });
    report.current_pack_variants_valid = packVariantProjectionValid;
    if (!packVariantProjectionValid) report.errors.push("CURRENT_PACK_VARIANT_PROJECTION_INCOMPLETE");
  }
  if (operationType === "ORDER_DISPATCH" || operationType === "ORDER_RETURN") {
    var orderRecord = di3GetOrderById_(payload.order_id);
    var expectedStatus = operationType === "ORDER_DISPATCH" ? DI3_ORDER_STATUS.IN_TRANSIT : DI3_ORDER_STATUS.RETURNED;
    report.order_status = orderRecord ? String(orderRecord.status || "") : "MISSING";
    var orderHistory = di3ReadRowsByColumnValue_("DocumentStatusHistory", 2, payload.order_id).filter(function (match) {
      return String(match.values[1]) === "ORDER" && String(match.values[4]) === String(expectedStatus);
    });
    report.order_status_history_exists = orderHistory.length > 0;
    if (!orderRecord || String(orderRecord.status) !== String(expectedStatus)) report.errors.push("ORDER_STATUS_PROJECTION_INCOMPLETE");
    if (!orderHistory.length) report.errors.push("ORDER_STATUS_HISTORY_MISSING");
    if (operationType === "ORDER_DISPATCH") {
      var itemsById = Object.create(null);
      di3GetOrderItems_(payload.order_id).forEach(function (item) { itemsById[String(item.order_item_id)] = item; });
      var linksValid = (payload.lines || []).every(function (line) {
        var item = itemsById[String(line.order_item_id)];
        return !!item && String(item.dispatch_movement_id || "") === String(line.movement_id);
      });
      report.dispatch_links_valid = linksValid;
      if (!linksValid) report.errors.push("ORDER_ITEM_DISPATCH_LINK_MISSING");
    }
  }
  try {
    var fifo = di3GetFifoIntegrityDiagnostics_();
    report.fifo_integrity_ok = !!fifo.ok;
    report.fifo_integrity_error_count = Array.isArray(fifo.errors) ? fifo.errors.length : null;
    if (!fifo.ok) report.errors.push("FIFO_INTEGRITY_DIAGNOSTICS_FAILED");
  } catch (fifoError) {
    report.fifo_integrity_ok = false;
    report.errors.push("FIFO_DIAGNOSTICS_ERROR: " + String(fifoError && fifoError.message || fifoError));
  }
  report.ok = report.errors.length === 0;
  return report;
}

function di3TmpC04ProbePrint_(report) {
  Logger.log(JSON.stringify(report, null, 2));
  return report;
}
