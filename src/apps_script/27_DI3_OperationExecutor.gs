/**
 * Dots Inventory v3 — shared operation lifecycle executor.
 *
 * The executor owns operation registration, immutable-payload verification,
 * terminal status publication and recovery dispatch. Domain handlers remain
 * responsible for business-specific ledger/details/lots and document changes.
 */
var DI3_OPERATION_PENDING_STATUSES = Object.freeze(["PREPARED", "RETRYABLE"]);

function di3GetOperationHandlerRegistry_() {
  return {
    MANUAL_STOCK_MOVEMENT: di3ApplyManualStockOperation_,
    SUPPLY_RECEIVE: di3ApplySupplyReceiptOperation_,
    SUPPLY_DOCUMENT_EDIT: di3ApplySupplyDocumentEditOperation_,
    ORDER_DISPATCH: di3ApplyOrderDispatchOperation_,
    ORDER_RETURN: di3ApplyOrderReturnOperation_,
    ORDER_CREATE: di3ApplyOrderCreateOperation_
  };
}

/**
 * The manual-stock hash intentionally excludes recorded_at. That timestamp is
 * generated once during registration and persisted in the recovery envelope;
 * resubmitting the same user command must still match the original token.
 */
function di3BuildOperationPayloadHash_(operationType, payload) {
  var source = payload;
  if (String(operationType) === "MANUAL_STOCK_MOVEMENT" && payload && typeof payload === "object") {
    source = Object.assign({}, payload);
    delete source.recorded_at;
  }
  return di3BuildManualOperationPayloadHash_(source);
}

var DI3_OPERATION_PAYLOAD_MAX_CHARS = 45000;

/** Serialize an immutable operation payload while respecting the Sheets cell limit. */
function di3SerializeOperationPayloadForStorage_(payload) {
  var serialized;
  try {
    serialized = JSON.stringify(payload);
  } catch (error) {
    throw new Error("Payload операции не удалось сериализовать: " + (error && error.message ? error.message : String(error)));
  }
  if (typeof serialized !== "string") throw new Error("Payload операции не удалось сериализовать в JSON.");
  var maxChars = Number(DI3_OPERATION_PAYLOAD_MAX_CHARS) || 45000;
  if (serialized.length > maxChars) {
    throw new Error("Payload операции слишком велик для безопасной записи в OperationPayloads: " + serialized.length + " символов при лимите " + maxChars + ". Операция не зарегистрирована; сократи состав аудита или используй отдельное хранение снимка.");
  }
  return serialized;
}

function di3BuildOperationRecord_(rowNumber, values) {
  return { row_number: Number(rowNumber), values: values.slice() };
}

function di3QuarantineOperation_(operationRecord, reason) {
  var message = String(reason || "Операция помещена в карантин.");
  var currentStatus = operationRecord && operationRecord.values ? String(operationRecord.values[5] || "") : "";
  // Never rewrite a terminal operation's state. A committed record with damaged
  // audit payload is an integrity error, not an uncommitted operation.
  if (["COMMITTED", "REJECTED"].indexOf(currentStatus) === -1) {
    try {
      di3SetOperationStatus_(operationRecord.row_number, "QUARANTINED", "", message);
    } catch (statusError) {
      message += " Не удалось обновить статус: " + (statusError.message || String(statusError));
    }
  }
  var error = new Error(message);
  error.di3OperationQuarantined = true;
  throw error;
}

function di3ReadVerifiedOperationPayload_(operationRecord) {
  if (!operationRecord || !operationRecord.values || operationRecord.values.length < 7) {
    throw new Error("Некорректная запись Operations.");
  }
  var operationId = String(operationRecord.values[0] || "");
  var operationType = String(operationRecord.values[2] || "");
  var expectedHash = String(operationRecord.values[6] || "");
  if (!operationId || !operationType || !expectedHash) {
    di3QuarantineOperation_(operationRecord, "В Operations отсутствует operation_id, operation_type или payload_hash.");
  }
  var payloadRecord = di3FindRowByFirstColumn_("OperationPayloads", operationId);
  if (!payloadRecord) {
    di3QuarantineOperation_(operationRecord, "Не найден неизменяемый payload операции " + operationId + ".");
  }
  var payload;
  try {
    payload = JSON.parse(String(payloadRecord.values[1] || ""));
  } catch (parseError) {
    di3QuarantineOperation_(operationRecord, "Не удалось разобрать payload операции " + operationId + ": " + (parseError.message || String(parseError)));
  }
  var actualHash;
  try {
    actualHash = di3BuildOperationPayloadHash_(operationType, payload);
  } catch (hashError) {
    di3QuarantineOperation_(operationRecord, "Не удалось проверить payload операции " + operationId + ": " + (hashError.message || String(hashError)));
  }
  if (actualHash !== expectedHash) {
    di3QuarantineOperation_(operationRecord, "Контрольная сумма payload не совпадает с Operations.payload_hash. Изменённый payload не будет исполнен.");
  }
  return payload;
}

/**
 * Resolve the original initiator from the immutable Operations row.
 * A missing operation actor remains blank; recovery executor identity must not
 * be substituted for the initiator. Non-operation/manual events use the
 * currently available active-user identity.
 */
function di3GetOperationInitiatorActor_(operationId) {
  var id = String(operationId || "").trim();
  if (!id) return di3GetActorEmail_();
  var operation = di3FindRowByFirstColumn_("Operations", id);
  if (!operation || !operation.values) return "";
  return String(operation.values[10] || "").trim();
}

/**
 * Registers the immutable payload before the PREPARED row. Returns the existing
 * operation for a repeated idempotency key after verifying identity and hash.
 */
function di3RegisterPreparedOperation_(spec) {
  spec = spec || {};
  var idempotencyKey = String(spec.idempotency_key || "");
  var operationType = String(spec.operation_type || "");
  var documentType = String(spec.document_type || "");
  var documentId = String(spec.document_id || "");
  if (!idempotencyKey || !operationType || !documentType || !documentId) {
    throw new Error("Для регистрации операции обязательны idempotency_key, operation_type, document_type и document_id.");
  }
  if (!spec.payload || typeof spec.payload !== "object") {
    throw new Error("Для регистрации операции требуется объект payload.");
  }
  var hashSource = spec.hash_payload || spec.payload;
  var requestedHash = di3BuildOperationPayloadHash_(operationType, hashSource);
  var existing = di3FindRowByColumnValue_("Operations", 1, idempotencyKey);
  if (existing) {
    if (String(existing.values[2]) !== operationType ||
        String(existing.values[3]) !== documentType ||
        String(existing.values[4]) !== documentId) {
      throw new Error("Ключ идемпотентности уже связан с другой операцией или документом: " + idempotencyKey);
    }
    if (String(existing.values[6]) !== requestedHash) {
      throw new Error("Ключ идемпотентности уже использован с другим payload: " + idempotencyKey);
    }
    di3ReadVerifiedOperationPayload_(existing);
    return existing;
  }

  // Serialize and validate size before creating either durable row. OperationPayloads
  // is currently one JSON string per cell (Google Sheets limit: 50,000 chars).
  var payloadJson = di3SerializeOperationPayloadForStorage_(spec.payload);
  if (typeof di3AssertMoneyMinorUnitsReady_ === "function") di3AssertMoneyMinorUnitsReady_();
  var operationId = di3MakeUuid_();
  var startedAt = new Date();
  var actor = "";
  try { actor = di3GetActorEmail_(); } catch (ignoreActor) {}

  // Persist payload first. An orphan payload is harmless; PREPARED without a
  // payload would be an unrecoverable stock/document operation.
  di3AppendTableRows_("OperationPayloads", [[operationId, payloadJson, startedAt]]);
  di3AppendTableRows_("Operations", [[
    operationId, idempotencyKey, operationType, documentType, documentId,
    "PREPARED", requestedHash, startedAt, "", "", actor
  ]]);
  var created = di3FindRowByFirstColumn_("Operations", operationId);
  if (!created) throw new Error("Не удалось подтвердить создание записи Operations.");
  return created;
}


/** Read-only FIFO cost projection for the currently executing operation.
 * Public read helpers intentionally reject pending operations; this internal
 * variant is safe after the operation's FIFO run has been committed but before
 * the enclosing Operations row is finally marked COMMITTED.
 */
function di3GetMovementFifoCostWithinOperation_(movementId) {
  // StockAllocations is the active projection; query only the movement being committed.
  var rows = di3ReadRowsByColumnValue_("StockAllocations", 2, movementId).map(function (match) { return match.values; }).filter(function (row) {
    return String(row[5]) === "CONSUME";
  });
  var quantity = 0, knownQuantity = 0, unknownQuantity = 0, knownCostMinor = 0;
  rows.forEach(function (row) {
    var q = Number(row[6]) || 0;
    quantity += q;
    if (String(row[8]) === "UNKNOWN") unknownQuantity += q;
    else {
      knownQuantity += q;
      knownCostMinor += Number(di3MoneyGetAllocationCostMinor_(row) || 0);
    }
  });
  var knownCost = di3MoneyFromMinorUnits_(knownCostMinor);
  return {
    movement_id: String(movementId), quantity: quantity,
    known_quantity: knownQuantity, unknown_quantity: unknownQuantity,
    known_cost_minor: knownCostMinor, known_cost: knownCost,
    total_cost_minor: unknownQuantity === 0 ? knownCostMinor : null,
    total_cost: unknownQuantity === 0 ? knownCost : null,
    cost_status: unknownQuantity === 0 ? "COMPLETE" : (knownQuantity ? "PARTIAL" : "UNKNOWN")
  };
}

function di3GetMovementFinancialResultWithinOperation_(movementId) {
  var detail = di3FindRowByFirstColumn_("StockMovementDetails", movementId);
  if (!detail) throw new Error("Не найдено описание складского движения " + movementId + ".");
  var row = detail.values;
  var movementType = String(row[2]);
  var revenue = row[5] === "" || row[5] == null ? null : di3MoneyFromMinorUnits_(di3MoneyToMinorUnits_(row[5], "Выручка", false));
  var revenueMinor = revenue == null ? null : di3MoneyToMinorUnits_(revenue, "Выручка", false);
  var fifo = movementType === "OUT" ? di3GetMovementFifoCostWithinOperation_(movementId) : null;
  var grossProfitMinor = revenueMinor != null && fifo && fifo.total_cost_minor != null
    ? revenueMinor - fifo.total_cost_minor : null;
  return {
    movement_id: String(movementId), display_code: String(row[1] || ""),
    movement_type: movementType, reason_code: String(row[3] || ""), revenue: revenue, revenue_minor: revenueMinor,
    fifo_cost: fifo, gross_profit_minor: grossProfitMinor,
    gross_profit: grossProfitMinor == null ? null : di3MoneyFromMinorUnits_(grossProfitMinor),
    gross_profit_status: revenue == null ? "NO_REVENUE" : (fifo && fifo.total_cost != null ? "COMPLETE" : "INCOMPLETE_FIFO_COST")
  };
}

/** Execute one already-registered operation using only its persisted payload. */
function di3GetOperationAttemptRows_(operationId) {
  if (!operationId || !di3GetSpreadsheet_().getSheetByName("OperationAttempts")) return [];
  return di3ReadRowsByColumnValue_("OperationAttempts", 1, String(operationId));
}

function di3GetOperationRecoveryPolicy_() {
  var config = DI3_APP_CONFIG && DI3_APP_CONFIG.OPERATION_RECOVERY || {};
  var policy = {
    max_attempts: Number(config.MAX_ATTEMPTS) || 5,
    retry_base_delay_ms: Number(config.RETRY_BASE_DELAY_MS) || 30000,
    retry_max_delay_ms: Number(config.RETRY_MAX_DELAY_MS) || 1800000,
    stale_attempt_ms: Number(config.STALE_ATTEMPT_MS) || 900000
  };
  if (policy.max_attempts < 1 || !Number.isInteger(policy.max_attempts)) throw new Error("DI3_APP_CONFIG.OPERATION_RECOVERY.MAX_ATTEMPTS должен быть положительным целым числом.");
  if (policy.retry_base_delay_ms < 0 || policy.retry_max_delay_ms < policy.retry_base_delay_ms || policy.stale_attempt_ms < 1000) {
    throw new Error("Некорректные параметры DI3_APP_CONFIG.OPERATION_RECOVERY: проверь backoff и stale timeout.");
  }
  return policy;
}

/** A manual quarantine release begins a new bounded retry epoch without deleting history. */
function di3GetOperationAttemptExecutionRows_(attemptRows) {
  var rows = (attemptRows || []).slice().sort(function (a, b) { return a.row_number - b.row_number; });
  var lastManualReopen = -1;
  rows.forEach(function (item, index) {
    if (String(item.values[5]) === "MANUAL_REOPEN") lastManualReopen = index;
  });
  return rows.slice(lastManualReopen + 1).filter(function (item) {
    return Number(item.values[2]) > 0 && ["INITIAL", "RECOVERY"].indexOf(String(item.values[5])) !== -1;
  });
}

function di3GetOperationRetryDelayMs_(attemptNumber) {
  var policy = di3GetOperationRecoveryPolicy_();
  var exponent = Math.max(0, Math.min(30, Number(attemptNumber) - 1));
  return Math.min(policy.retry_max_delay_ms, policy.retry_base_delay_ms * Math.pow(2, exponent));
}

function di3GetOperationRetryState_(operationRecord, nowValue) {
  var now = nowValue instanceof Date ? nowValue : new Date(nowValue || new Date());
  var status = String(operationRecord && operationRecord.values ? operationRecord.values[5] : "");
  if (status !== "RETRYABLE") return { eligible: true, attempt_count: 0, next_retry_at: null };
  var operationId = String(operationRecord.values[0] || "");
  var attempts = di3GetOperationAttemptExecutionRows_(di3GetOperationAttemptRows_(operationId));
  var policy = di3GetOperationRecoveryPolicy_();
  var count = attempts.length;
  if (count >= policy.max_attempts) {
    return { eligible: false, exhausted: true, attempt_count: count, next_retry_at: null, reason: "MAX_ATTEMPTS_REACHED" };
  }
  if (!count) return { eligible: true, attempt_count: 0, next_retry_at: null };
  var last = attempts[attempts.length - 1];
  // Attempt rows are repository records shaped as {row_number, values}; never
  // read timestamps from ad-hoc properties because that would treat every
  // completed attempt as unfinished and permanently suppress retries.
  var lastValues = last.values || [];
  var lastStartedAtValue = lastValues[6];
  var lastFinishedAtValue = lastValues[7];
  var lastResultStatus = String(lastValues[8] || "");
  if (!lastFinishedAtValue || lastResultStatus === "STARTED") {
    var startedAt = lastStartedAtValue instanceof Date ? lastStartedAtValue : new Date(lastStartedAtValue);
    var staleAt = new Date(startedAt.getTime() + policy.stale_attempt_ms);
    return { eligible: false, attempt_count: count, next_retry_at: staleAt, reason: "INCOMPLETE_ATTEMPT" };
  }
  var finishedAt = lastFinishedAtValue instanceof Date ? lastFinishedAtValue : new Date(lastFinishedAtValue);
  var nextRetryAt = new Date(finishedAt.getTime() + di3GetOperationRetryDelayMs_(count));
  return {
    eligible: now.getTime() >= nextRetryAt.getTime(),
    attempt_count: count,
    next_retry_at: nextRetryAt,
    retry_delay_ms: di3GetOperationRetryDelayMs_(count),
    reason: now.getTime() >= nextRetryAt.getTime() ? "READY" : "BACKOFF"
  };
}

function di3StartOperationAttempt_(operationRecord) {
  if (!operationRecord || !operationRecord.values) throw new Error("Нельзя начать попытку без записи операции.");
  var operationId = String(operationRecord.values[0] || "");
  var attempts = di3GetOperationAttemptExecutionRows_(di3GetOperationAttemptRows_(operationId));
  var maxAttempt = attempts.reduce(function (max, item) {
    return Math.max(max, Number(item.values[2]) || 0);
  }, 0);
  var attemptId = di3MakeUuid_();
  var startedAt = new Date();
  var currentStatus = String(operationRecord.values[5] || "");
  var executionMode = maxAttempt === 0 ? "INITIAL" : "RECOVERY";
  var actor = "";
  try { actor = di3GetActorEmail_(); } catch (ignoreActor) {}
  var values = [attemptId, operationId, maxAttempt + 1, String(operationRecord.values[2] || ""),
    currentStatus, executionMode, startedAt, "", "STARTED", "", "", actor];
  // Audit row must be durable before the domain handler can write business data.
  di3AppendTableRows_("OperationAttempts", [values]);
  var created = di3FindRowByFirstColumn_("OperationAttempts", attemptId);
  if (!created) throw new Error("Не удалось подтвердить запись попытки OperationAttempts.");
  return created;
}

function di3FinishOperationAttempt_(attemptRecord, resultStatus, error) {
  if (!attemptRecord || !attemptRecord.values || !attemptRecord.row_number) {
    throw new Error("Некорректная запись попытки OperationAttempts.");
  }
  var values = attemptRecord.values.slice();
  while (values.length < DI3_TABLE_SCHEMAS.OperationAttempts.length) values.push("");
  values[7] = new Date();
  values[8] = String(resultStatus || "UNKNOWN");
  values[9] = error ? di3GetOperationErrorClass_(error) : "";
  values[10] = error ? String(error.message || error) : "";
  di3GetSheetOrThrow_("OperationAttempts").getRange(attemptRecord.row_number, 1, 1, values.length).setValues([values]);
  return { attempt_id: String(values[0]), result_status: values[8] };
}

function di3GetOperationAttemptStats_() {
  var stats = Object.create(null);
  var incomplete = [];
  var manualReviews = [];
  if (!di3GetSpreadsheet_().getSheetByName("OperationAttempts")) {
    return { by_operation_id: stats, incomplete: incomplete, manual_reviews: manualReviews };
  }
  di3ReadTableValues_("OperationAttempts").forEach(function (row, index) {
    var operationId = String(row[1] || "");
    if (!operationId) return;
    var item = {
      row_number: index + 2,
      attempt_id: String(row[0] || ""),
      operation_id: operationId,
      attempt_number: Number(row[2]) || 0,
      operation_type: String(row[3] || ""),
      status_before: String(row[4] || ""),
      execution_mode: String(row[5] || ""),
      started_at: row[6] || "",
      finished_at: row[7] || "",
      result_status: String(row[8] || ""),
      error_class: String(row[9] || ""),
      error_message: String(row[10] || ""),
      actor: String(row[11] || "")
    };
    if (item.execution_mode === "MANUAL_REOPEN") {
      manualReviews.push(item);
    } else if (!item.finished_at || item.result_status === "STARTED") {
      incomplete.push(item);
    }
    if (!stats[operationId]) stats[operationId] = { attempt_count: 0, manual_reopen_count: 0, last_attempt: null, all_attempts: [] };
    stats[operationId].all_attempts.push(item);
    if (item.execution_mode === "MANUAL_REOPEN") {
      stats[operationId].manual_reopen_count++;
    }
  });
  Object.keys(stats).forEach(function (operationId) {
    var active = di3GetOperationAttemptExecutionRows_(stats[operationId].all_attempts.map(function (item) {
      return { row_number: item.row_number, values: [item.attempt_id, item.operation_id, item.attempt_number, item.operation_type, item.status_before, item.execution_mode, item.started_at, item.finished_at, item.result_status, item.error_class, item.error_message, item.actor] };
    }));
    stats[operationId].attempt_count = active.length;
    if (active.length) {
      var last = active[active.length - 1];
      stats[operationId].last_attempt = {
        attempt_id: String(last.values[0]), operation_id: operationId,
        attempt_number: Number(last.values[2]) || 0, execution_mode: String(last.values[5] || ""),
        started_at: last.values[6] || "", finished_at: last.values[7] || "",
        result_status: String(last.values[8] || ""), error_class: String(last.values[9] || ""), error_message: String(last.values[10] || ""),
        actor: String(last.values[11] || "")
      };
    }
    delete stats[operationId].all_attempts;
  });
  return { by_operation_id: stats, incomplete: incomplete, manual_reviews: manualReviews };
}

/** Resolve old STARTED journal rows only after the configured stale timeout. */
function di3ResolveStaleOperationAttempts_(operationTypes, nowValue) {
  var allowed = null;
  if (Array.isArray(operationTypes)) {
    allowed = Object.create(null);
    operationTypes.forEach(function (type) { allowed[String(type)] = true; });
  }
  var now = nowValue instanceof Date ? nowValue : new Date(nowValue || new Date());
  var policy = di3GetOperationRecoveryPolicy_();
  var operations = di3ReadTableValues_("Operations");
  var operationMap = Object.create(null);
  operations.forEach(function (row, index) {
    if (row[0]) operationMap[String(row[0])] = { row_number: index + 2, values: row };
  });
  var attemptRows = di3ReadTableValues_("OperationAttempts");
  var resolved = [], waiting = [];
  attemptRows.forEach(function (row, index) {
    var resultStatus = String(row[8] || "");
    var finishedAt = row[7];
    if (resultStatus !== "STARTED" && finishedAt) return;
    var operationId = String(row[1] || "");
    var operation = operationMap[operationId];
    if (!operation || (allowed && !allowed[String(operation.values[2] || "")])) return;
    var startedAt = row[6] instanceof Date ? row[6] : new Date(row[6]);
    if (!Number.isFinite(startedAt.getTime())) {
      waiting.push({ attempt_id: String(row[0]), operation_id: operationId, reason: "INVALID_STARTED_AT" });
      return;
    }
    var ageMs = now.getTime() - startedAt.getTime();
    if (ageMs < policy.stale_attempt_ms) {
      waiting.push({ attempt_id: String(row[0]), operation_id: operationId, age_ms: ageMs,
        stale_after_ms: policy.stale_attempt_ms, reason: "NOT_STALE_YET" });
      return;
    }
    var attemptRecord = { row_number: index + 2, values: row.slice() };
    var currentStatus = String(operation.values[5] || "");
    if (currentStatus === "COMMITTED" || currentStatus === "REJECTED" || currentStatus === "QUARANTINED") {
      var terminalResult = currentStatus === "COMMITTED" ? "AUDIT_INCOMPLETE_AFTER_COMMIT" : "ABANDONED_" + currentStatus;
      di3FinishOperationAttempt_(attemptRecord, terminalResult, new Error("Выполнение прервано до завершения записи журнала попыток; операция уже имеет статус " + currentStatus + "."));
      resolved.push({ operation_id: operationId, attempt_id: String(row[0]), result: terminalResult, operation_status: currentStatus });
      return;
    }
    if (DI3_OPERATION_PENDING_STATUSES.indexOf(currentStatus) === -1) {
      waiting.push({ attempt_id: String(row[0]), operation_id: operationId, reason: "OPERATION_NOT_PENDING", operation_status: currentStatus });
      return;
    }
    var interruption = new Error("Apps Script не завершил попытку " + String(row[0]) + ". Срок ожидания истёк; разрешено безопасное recovery по неизменяемому payload.");
    interruption.di3OperationErrorClass = "EXECUTION_INTERRUPTED";
    di3FinishOperationAttempt_(attemptRecord, "INTERRUPTED", interruption);
    var executionRows = di3GetOperationAttemptExecutionRows_(di3GetOperationAttemptRows_(operationId));
    var nextStatus = executionRows.length >= policy.max_attempts ? "QUARANTINED" : "RETRYABLE";
    di3SetOperationStatus_(operation.row_number, nextStatus, "", di3FormatOperationError_(interruption));
    resolved.push({ operation_id: operationId, attempt_id: String(row[0]), result: "INTERRUPTED", operation_status: nextStatus });
  });
  return { resolved: resolved, waiting: waiting, counts: { resolved: resolved.length, waiting: waiting.length } };
}

function di3GetOperationErrorClass_(error) {
  if (error && error.di3OperationErrorClass) return String(error.di3OperationErrorClass);
  var message = String(error && error.message ? error.message : error || "");
  if (/service invoked too many times|service spreadsheets failed|internal error|temporarily unavailable|backend error|timed? ?out|exceeded maximum execution time|try again later/i.test(message)) {
    return "GOOGLE_SERVICE_TRANSIENT";
  }
  if (error && error.di3OperationDisposition) return String(error.di3OperationDisposition);
  if (error && error.di3OperationQuarantined) return "INTEGRITY_QUARANTINE";
  return "UNCLASSIFIED";
}

function di3ResolveOperationFailureStatus_(error, currentStatus) {
  var disposition = String(error && error.di3OperationDisposition || "").toUpperCase();
  if (disposition === "REJECTED" || disposition === "RETRYABLE" || disposition === "QUARANTINED") return disposition;
  if (error && error.di3OperationQuarantined) return "QUARANTINED";
  if (di3GetOperationErrorClass_(error) === "GOOGLE_SERVICE_TRANSIENT") return "RETRYABLE";
  return String(currentStatus) === "RETRYABLE" ? "RETRYABLE" : "PREPARED";
}

function di3FormatOperationError_(error) {
  var message = String(error && error.message ? error.message : error || "Неизвестная ошибка операции.");
  var errorClass = di3GetOperationErrorClass_(error);
  return "[" + errorClass + "] " + message;
}

function di3ExecutePreparedOperation_(operationRecord) {
  if (!operationRecord || !operationRecord.values) throw new Error("Не передана запись операции для исполнения.");
  var operationId = String(operationRecord.values[0] || "");
  var operationType = String(operationRecord.values[2] || "");
  var currentStatus = String(operationRecord.values[5] || "");
  if (currentStatus === "COMMITTED") return { status: "ALREADY_COMMITTED", operation_id: operationId };
  if (currentStatus === "REJECTED") throw new Error("Операция ранее отклонена: " + operationId + ". Создай новую команду с новым ключом идемпотентности.");
  if (currentStatus === "QUARANTINED") throw new Error("Операция находится в карантине и требует ручной проверки: " + operationId);
  if (DI3_OPERATION_PENDING_STATUSES.indexOf(currentStatus) === -1) {
    throw new Error("Недопустимый статус операции " + operationId + ": " + currentStatus);
  }

  var registry = di3GetOperationHandlerRegistry_();
  var handler = registry[operationType];
  if (typeof handler !== "function") {
    throw new Error("Для типа операции не зарегистрирован обработчик: " + operationType);
  }
  var retryState = di3GetOperationRetryState_(operationRecord, new Date());
  if (retryState.exhausted) {
    var exhaustedMessage = "Операция достигла лимита " + di3GetOperationRecoveryPolicy_().max_attempts + " попыток и помещена в карантин. Проверь складские события и восстановление вручную.";
    di3SetOperationStatus_(operationRecord.row_number, "QUARANTINED", "", exhaustedMessage);
    throw new Error(exhaustedMessage);
  }
  if (!retryState.eligible) {
    return { status: "RETRY_DEFERRED", operation_id: operationId, next_retry_at: retryState.next_retry_at, reason: retryState.reason };
  }
  var payload = di3ReadVerifiedOperationPayload_(operationRecord);
  // The attempt journal is written before any domain side effects. If this write
  // fails, the operation remains pending and its handler is not called.
  var attemptRecord = di3StartOperationAttempt_(operationRecord);
  try {
    var result = handler(operationRecord, payload);
    // The business handler must complete all required writes before this single
    // terminal transition. A failed status write leaves an idempotently resumable
    // PREPARED operation rather than falsely reporting success.
    di3SetOperationStatus_(operationRecord.row_number, "COMMITTED", new Date(), "");
    // Audit-log completion is best-effort after COMMITTED: a failure here must
    // never downgrade a business operation that is already durably committed.
    try { di3FinishOperationAttempt_(attemptRecord, "COMMITTED", null); } catch (attemptAuditError) {}
    if (result && typeof result === "object" && !result.operation_id) result.operation_id = operationId;
    return result;
  } catch (error) {
    // Explicit handler dispositions take precedence. Known temporary Google
    // service failures become RETRYABLE; unknown failures remain PREPARED so
    // recovery is possible but no unsafe automatic rejection is inferred.
    var failureStatus = di3ResolveOperationFailureStatus_(error, currentStatus);
    var maxAttempts = di3GetOperationRecoveryPolicy_().max_attempts;
    if (failureStatus === "RETRYABLE" && Number(attemptRecord.values[2]) >= maxAttempts) {
      failureStatus = "QUARANTINED";
      error.di3OperationErrorClass = "MAX_ATTEMPTS_REACHED";
      error.message = String(error.message || error) + " Лимит попыток исчерпан (" + maxAttempts + "); операция помещена в карантин.";
    }
    var statusPersisted = false;
    var attemptResultStatus = "STATUS_WRITE_FAILED";
    var durableCommitConfirmed = false;
    try {
      // Re-read the durable operation state before publishing a failure status.
      // A Sheets write can persist and still surface an acknowledgement error;
      // blindly writing failureStatus here could downgrade a committed business
      // operation to PREPARED/RETRYABLE after its final COMMITTED write succeeded.
      var latestOperation = di3FindRowByFirstColumn_("Operations", operationId);
      if (!latestOperation || !latestOperation.values) {
        throw new Error("Не удалось повторно прочитать операцию " + operationId + " перед фиксацией ошибки.");
      }
      var latestStatus = String(latestOperation.values[5] || "");
      if (["COMMITTED", "REJECTED", "QUARANTINED"].indexOf(latestStatus) !== -1) {
        // A terminal state is durable and takes precedence over the lost
        // acknowledgement. Never downgrade it because of a later exception.
        statusPersisted = true;
        attemptResultStatus = latestStatus;
        durableCommitConfirmed = latestStatus === "COMMITTED";
      } else {
        di3SetOperationStatus_(operationRecord.row_number, failureStatus, "", di3FormatOperationError_(error));
        statusPersisted = true;
        attemptResultStatus = failureStatus;
      }
    } catch (statusError) {
      // The failure-state write can also persist before its acknowledgement is
      // lost. Re-read once to report the durable result accurately; never issue
      // another status write from this recovery path.
      try {
        var afterStatusWrite = di3FindRowByFirstColumn_("Operations", operationId);
        var afterStatus = afterStatusWrite && afterStatusWrite.values
          ? String(afterStatusWrite.values[5] || "") : "";
        if (["COMMITTED", "REJECTED", "QUARANTINED"].indexOf(afterStatus) !== -1 || afterStatus === failureStatus) {
          statusPersisted = true;
          attemptResultStatus = afterStatus;
          durableCommitConfirmed = afterStatus === "COMMITTED";
        }
      } catch (verifyStatusError) {
        // Preserve the original operation error and the last visible journal state.
      }
    }
    try {
      di3FinishOperationAttempt_(attemptRecord, statusPersisted ? attemptResultStatus : "STATUS_WRITE_FAILED", error);
    } catch (attemptAuditError) {
      // Do not mask the operation error; a STARTED journal row remains visible.
    }
    if (durableCommitConfirmed) {
      // The business operation is already durably committed. Return success so
      // callers do not display a false failure and encourage duplicate retries.
      var committedResult = result && typeof result === "object" ? Object.assign({}, result) : {};
      if (!committedResult.status) committedResult.status = "COMMITTED";
      if (!committedResult.operation_id) committedResult.operation_id = operationId;
      committedResult.commit_ack_recovered = true;
      return committedResult;
    }
    throw error;
  }
}

function di3MarkOperationErrorDisposition_(error, disposition) {
  var target = error instanceof Error ? error : new Error(String(error));
  var value = String(disposition || "RETRYABLE").toUpperCase();
  if (["REJECTED", "RETRYABLE", "QUARANTINED"].indexOf(value) === -1) {
    throw new Error("Недопустимая disposition операции: " + value + ". Разрешены REJECTED, RETRYABLE, QUARANTINED.");
  }
  target.di3OperationDisposition = value;
  if (value === "QUARANTINED") target.di3OperationQuarantined = true;
  return target;
}

function di3RecoverPreparedOperations_(operationTypes) {
  var allowed = {};
  (operationTypes || []).forEach(function (type) { allowed[String(type)] = true; });
  var staleReport = di3ResolveStaleOperationAttempts_(operationTypes, new Date());
  var rows = di3ReadTableValues_("Operations");
  var attemptStats = di3GetOperationAttemptStats_();
  var incompleteByOperation = Object.create(null);
  attemptStats.incomplete.forEach(function (item) { incompleteByOperation[item.operation_id] = item; });
  var results = [];
  rows.forEach(function (row, index) {
    var operationId = String(row[0] || "");
    var type = String(row[2] || "");
    var status = String(row[5] || "");
    if (!allowed[type] || DI3_OPERATION_PENDING_STATUSES.indexOf(status) === -1) return;
    if (incompleteByOperation[operationId]) {
      results.push({ operation_id: operationId, status: "WAITING_FOR_STALE_ATTEMPT",
        operation_status: status, attempt_id: incompleteByOperation[operationId].attempt_id,
        reason: "INCOMPLETE_ATTEMPT_NOT_STALE" });
      return;
    }
    var record = di3BuildOperationRecord_(index + 2, row);
    try {
      results.push(di3ExecutePreparedOperation_(record));
    } catch (error) {
      var latest = di3GetSheetOrThrow_("Operations").getRange(index + 2, 6, 1, 1).getValue();
      results.push({
        operation_id: operationId,
        status: String(latest) === "QUARANTINED" ? "BLOCKED" : (String(latest) === "RETRYABLE" ? "RETRYABLE" : "FAILED"),
        operation_status: String(latest),
        error_class: di3GetOperationErrorClass_(error),
        error: error && error.message ? error.message : String(error)
      });
    }
  });
  return {
    recovered: results.filter(function (result) {
      return result.status === "COMMITTED" || result.status === "CREATED";
    }).length,
    stale_attempts: staleReport,
    results: results
  };
}

/** Manually release a quarantined operation only after explicit reconciliation by the owner. */
function di3RequeueQuarantinedOperation(operationId, confirmation, reason) {
  return di3WithLock_(function () {
    var id = String(operationId || "").trim();
    var why = di3NormalizeText_(reason);
    if (!id) throw new Error("Укажи operation_id операции.");
    if (String(confirmation || "") !== "RESUME_AFTER_RECONCILIATION") {
      throw new Error("Для ручного снятия карантина требуется confirmation=RESUME_AFTER_RECONCILIATION.");
    }
    if (!why || why.length < 20) throw new Error("Укажи подробную причину сверки (не менее 20 символов).");
    var record = di3FindRowByFirstColumn_("Operations", id);
    if (!record) throw new Error("Операция не найдена: " + id);
    var status = String(record.values[5] || "");
    if (status !== "QUARANTINED") throw new Error("Ручное снятие карантина допустимо только для QUARANTINED; текущий статус: " + status);
    var registry = di3GetOperationHandlerRegistry_();
    if (typeof registry[String(record.values[2] || "")] !== "function") throw new Error("Для этой операции нет зарегистрированного обработчика восстановления.");
    var attempts = di3GetOperationAttemptRows_(id);
    if (attempts.some(function (item) { return !item.values[7] || String(item.values[8]) === "STARTED"; })) {
      throw new Error("Нельзя снимать карантин: есть незавершённая попытка. Сначала дождись stale timeout и запусти recovery.");
    }
    // Re-verify immutable recovery payload before changing state.
    di3ReadVerifiedOperationPayload_(record);
    var now = new Date();
    var actor = "";
    try { actor = di3SettingsActor_(); } catch (ignoreActor) {}
    var reviewId = di3MakeUuid_();
    var auditMessage = "Manual quarantine release by " + (actor || "unknown actor") + ": " + why;
    // A review row is separate from execution attempts (attempt_number=0) and
    // starts a new bounded retry epoch without deleting earlier attempts.
    di3AppendTableRows_("OperationAttempts", [[reviewId, id, 0, String(record.values[2] || ""),
      "QUARANTINED", "MANUAL_REOPEN", now, now, "REQUEUE_REQUESTED", "MANUAL_REVIEW", auditMessage, actor]]);
    di3SetOperationStatus_(record.row_number, "RETRYABLE", "", auditMessage);
    return { status: "REQUEUED", operation_id: id, review_id: reviewId, reason: why, actor: actor };
  });
}

function di3PromptRequeueQuarantinedOperation() {
  var ui = SpreadsheetApp.getUi();
  var idPrompt = ui.prompt("Снятие карантина", "Введи operation_id после ручной сверки складских документов и событий.", ui.ButtonSet.OK_CANCEL);
  if (idPrompt.getSelectedButton() !== ui.Button.OK) return { status: "CANCELLED" };
  var reasonPrompt = ui.prompt("Причина снятия карантина", "Опиши, какие Ledger/Details/Lots/Allocations и документ были сверены (не менее 20 символов).", ui.ButtonSet.OK_CANCEL);
  if (reasonPrompt.getSelectedButton() !== ui.Button.OK) return { status: "CANCELLED" };
  return di3RequeueQuarantinedOperation(idPrompt.getResponseText(), "RESUME_AFTER_RECONCILIATION", reasonPrompt.getResponseText());
}

function di3FindUnregisteredPendingOperations_() {
  var registry = di3GetOperationHandlerRegistry_();
  return di3ReadTableValues_("Operations").reduce(function (result, row, index) {
    var status = String(row[5] || "");
    var type = String(row[2] || "");
    if (DI3_OPERATION_PENDING_STATUSES.indexOf(status) !== -1 && typeof registry[type] !== "function") {
      result.push({
        row_number: index + 2,
        operation_id: String(row[0]),
        operation_type: type,
        status: status,
        reason: "NO_RESUME_HANDLER"
      });
    }
    return result;
  }, []);
}


/** Read-only inventory of recoverable, quarantined, rejected and unsupported operations. */
function di3GetOperationRecoveryReport_() {
  var rows = di3ReadTableValues_("Operations");
  var registry = di3GetOperationHandlerRegistry_();
  var attemptStats = di3GetOperationAttemptStats_();
  var recoverable = [], quarantined = [], rejected = [], unsupported = [], other = [];
  rows.forEach(function (row, index) {
    var status = String(row[5] || "");
    var type = String(row[2] || "");
    if (!row[0]) return;
    var operationId = String(row[0]);
    var attempts = attemptStats.by_operation_id[operationId] || { attempt_count: 0, manual_reopen_count: 0, last_attempt: null };
    var retryState = status === "RETRYABLE" ? di3GetOperationRetryState_(di3BuildOperationRecord_(index + 2, row), new Date()) : { eligible: status === "PREPARED", next_retry_at: null, reason: status === "PREPARED" ? "PREPARED" : "NOT_PENDING" };
    var incompleteAttempt = attemptStats.incomplete.filter(function (attempt) { return attempt.operation_id === operationId; })[0] || null;
    var item = {
      row_number: index + 2,
      operation_id: operationId,
      operation_type: type,
      document_type: String(row[3] || ""),
      document_id: String(row[4] || ""),
      status: status,
      error: String(row[9] || ""),
      handler_available: typeof registry[type] === "function",
      attempt_count: attempts.attempt_count,
      manual_reopen_count: attempts.manual_reopen_count || 0,
      last_attempt: attempts.last_attempt,
      retry_ready: retryState.eligible,
      next_retry_at: retryState.next_retry_at || null,
      retry_reason: retryState.reason || "",
      incomplete_attempt: incompleteAttempt
    };
    if (status === "PREPARED" || status === "RETRYABLE") {
      recoverable.push(item);
      if (!item.handler_available) unsupported.push(Object.assign({}, item, { reason: "NO_RESUME_HANDLER" }));
    } else if (status === "QUARANTINED") quarantined.push(item);
    else if (status === "REJECTED") rejected.push(item);
    else if (status && status !== "COMMITTED") other.push(item);
  });
  return {
    recoverable: recoverable,
    quarantined: quarantined,
    rejected: rejected,
    unsupported: unsupported,
    other_nonterminal: other,
    incomplete_attempts: attemptStats.incomplete,
    manual_reviews: attemptStats.manual_reviews,
    counts: {
      recoverable: recoverable.length,
      quarantined: quarantined.length,
      rejected: rejected.length,
      unsupported: unsupported.length,
      other_nonterminal: other.length,
      incomplete_attempts: attemptStats.incomplete.length,
      manual_reviews: attemptStats.manual_reviews.length
    }
  };
}

/** Menu action: log operation details and show a compact status summary. */
function di3ShowOperationRecoveryReport() {
  var report = di3GetOperationRecoveryReport_();
  if (typeof Logger !== "undefined" && Logger && typeof Logger.log === "function") {
    Logger.log(JSON.stringify(report, null, 2));
  }
  var message = "К восстановлению: " + report.counts.recoverable +
    " · Карантин: " + report.counts.quarantined +
    " · Без обработчика: " + report.counts.unsupported +
    " · Отклонено: " + report.counts.rejected +
    " · Незавершённых попыток: " + report.counts.incomplete_attempts +
    " · Ручных снятий карантина: " + report.counts.manual_reviews +
    ". Подробности — в журнале выполнения.";
  try { di3GetSpreadsheet_().toast(message, "Состояние операций", 10); } catch (ignoreToast) {}
  return report;
}
