/** Dots Inventory v3 — incremental FIFO state, product-scoped replay and allocation compaction. */
var DI3_FIFO_STATE_VERSION = "4";


/** Return matching repository rows tagged with their physical sheet row number. */
function di3ReadTaggedRowsByColumnValue_(sheetName, columnIndexZeroBased, value) {
  return di3ReadRowsByColumnValue_(sheetName, columnIndexZeroBased, value).map(function (match) {
    var row = match.values;
    row._di3RowNumber = Number(match.row_number);
    return row;
  });
}

/** Return matching rows for several keys, retaining physical sheet row numbers. */
function di3ReadTaggedRowsByColumnValues_(sheetName, columnIndexZeroBased, values) {
  return di3ReadRowsByColumnValues_(sheetName, columnIndexZeroBased, values).map(function (match) {
    var row = match.values;
    row._di3RowNumber = Number(match.row_number);
    return row;
  });
}

/** Validate immutable ledger sequences and retain physical row locations only for reads. */
function di3ReadLedgerSequenceIndex_() {
  var sequenceIndex = DI3_TABLE_SCHEMAS.StockLedger.indexOf("ledger_sequence");
  if (sequenceIndex < 0) throw new Error("StockLedger schema has no ledger_sequence column.");
  var sheet = di3GetSheetOrThrow_("StockLedger");
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return { max_sequence: 0, rows: [], movement_count: 0 };
  var count = lastRow - 1;
  var movementIds = sheet.getRange(2, 1, count, 1).getValues();
  var productIds = sheet.getRange(2, 4, count, 1).getValues();
  var sequences = sheet.getRange(2, sequenceIndex + 1, count, 1).getValues();
  var seen = Object.create(null), rows = [], maxSequence = 0, movementCount = 0;
  for (var i = 0; i < count; i++) {
    var movementId = String(movementIds[i][0] == null ? "" : movementIds[i][0]).trim();
    var productId = String(productIds[i][0] == null ? "" : productIds[i][0]).trim();
    var raw = sequences[i][0], blankSequence = raw === "" || raw == null;
    if (!movementId && !productId && blankSequence) continue;
    if (!movementId) throw new Error("StockLedger: заполненная строка без movement_id (строка " + (i + 2) + ").");
    if (!productId) throw new Error("StockLedger: пустой product_id у движения " + movementId + " (строка " + (i + 2) + ").");
    if (blankSequence) throw new Error("StockLedger: отсутствует ledger_sequence у движения " + movementId + " (строка " + (i + 2) + ").");
    var sequence = Number(raw);
    if (!Number.isSafeInteger(sequence) || sequence <= 0) throw new Error("StockLedger: ledger_sequence должен быть положительным целым числом у движения " + movementId + ".");
    if (Object.prototype.hasOwnProperty.call(seen, String(sequence))) {
      throw new Error("StockLedger: повторяется ledger_sequence " + sequence + " у движений " + seen[String(sequence)] + " и " + movementId + ".");
    }
    seen[String(sequence)] = movementId;
    rows.push({ row_number: i + 2, movement_id: movementId, product_id: productId, sequence: sequence });
    maxSequence = Math.max(maxSequence, sequence);
    movementCount++;
  }
  return { max_sequence: maxSequence, rows: rows, movement_count: movementCount };
}

/** Allocate a unique sequence block while the caller owns the ScriptLock. */
function di3AllocateLedgerSequenceBlock_(count) {
  count = Number(count);
  if (!Number.isInteger(count) || count < 1) throw new Error("Для выделения ledger sequence требуется положительное целое количество.");
  if (typeof DI3_SCRIPT_LOCK_DEPTH_ !== "number" || DI3_SCRIPT_LOCK_DEPTH_ < 1) throw new Error("ledger_sequence можно выделять только внутри ScriptLock.");
  di3AssertNoPendingFifoRuns_();
  var index = di3ReadLedgerSequenceIndex_();
  if (index.max_sequence + count > Number.MAX_SAFE_INTEGER) throw new Error("Исчерпан диапазон безопасных целых чисел для ledger_sequence.");
  var sequences = [];
  for (var i = 1; i <= count; i++) sequences.push(index.max_sequence + i);
  return sequences;
}

/** Store sequence identities in the immutable operation payload before ledger append. */
function di3AssignLedgerSequencesToLines_(lines) {
  if (!Array.isArray(lines) || !lines.length) throw new Error("Не переданы строки для назначения ledger_sequence.");
  var sequences = di3AllocateLedgerSequenceBlock_(lines.length);
  lines.forEach(function (line, index) { line.ledger_sequence = sequences[index]; });
  return sequences;
}

/** Fail before a domain handler appends an event whose immutable sequence is absent or invalid. */
function di3RequireLedgerSequence_(value, movementId) {
  var sequence = Number(value);
  if (!Number.isSafeInteger(sequence) || sequence <= 0) {
    throw new Error("Для складского движения " + String(movementId || "") + " отсутствует корректный ledger_sequence.");
  }
  return sequence;
}

/** Read full rows only for events whose immutable sequence exceeds the committed cursor. */
function di3ReadFifoLedgerTail_(cursor, sequenceIndex) {
  cursor = Number(cursor);
  if (!Number.isSafeInteger(cursor) || cursor < 0) throw new Error("Некорректный FIFO ledger sequence cursor.");
  var index = sequenceIndex || di3ReadLedgerSequenceIndex_();
  var selected = index.rows.filter(function (item) { return item.sequence > cursor; })
    .sort(function (a, b) { return a.row_number - b.row_number; });
  if (!selected.length) return [];
  var sheet = di3GetSheetOrThrow_("StockLedger"), width = DI3_TABLE_SCHEMAS.StockLedger.length;
  var selectedByRow = Object.create(null);
  selected.forEach(function (item) { selectedByRow[String(item.row_number)] = item; });
  var rows = [], groupStart = selected[0].row_number, groupEnd = groupStart;
  function flushGroup_() {
    var block = sheet.getRange(groupStart, 1, groupEnd - groupStart + 1, width).getValues();
    block.forEach(function (row, offset) {
      var rowNumber = groupStart + offset;
      var expected = selectedByRow[String(rowNumber)];
      if (!expected || String(row[0]) !== expected.movement_id ||
          String(row[3]) !== expected.product_id || Number(row[12]) !== expected.sequence) {
        throw new Error("StockLedger изменился во время чтения FIFO tail (строка " + rowNumber + "). Повтори операцию после завершения сортировки или редактирования журнала.");
      }
      row._di3RowNumber = rowNumber;
      rows.push(row);
    });
  }
  for (var i = 1; i < selected.length; i++) {
    var rowNumber = selected[i].row_number;
    if (rowNumber === groupEnd + 1) groupEnd = rowNumber;
    else { flushGroup_(); groupStart = rowNumber; groupEnd = rowNumber; }
  }
  flushGroup_();
  rows.sort(function (a, b) { return Number(a[12]) - Number(b[12]); });
  return rows;
}

function di3FifoEventCompare_(a, b) {
  var byEffective = di3ToMillis_(a.effective_at) - di3ToMillis_(b.effective_at);
  if (byEffective) return byEffective;
  var byRecorded = di3ToMillis_(a.recorded_at) - di3ToMillis_(b.recorded_at);
  if (byRecorded) return byRecorded;
  return String(a.movement_id).localeCompare(String(b.movement_id));
}

function di3GetFifoEventsForProduct_(productId, ledgerRows, detailRows, lotRows) {
  var detailByMovement = {};
  (detailRows || []).forEach(function (row) {
    detailByMovement[String(row[0])] = row;
  });
  var lotByMovement = {};
  (lotRows || []).forEach(function (row) {
    if (String(row[1]) === String(productId)) lotByMovement[String(row[2])] = row;
  });
  var events = [];
  (ledgerRows || []).forEach(function (row, index) {
    if (String(row[3]) !== String(productId)) return;
    var detail = detailByMovement[String(row[0])];
    if (!detail) throw new Error("Для движения " + row[0] + " отсутствует StockMovementDetails.");
    var delta = Number(row[6]);
    if (!Number.isFinite(delta) || delta === 0) throw new Error("Некорректное количество у движения " + row[0] + ".");
    var type = String(detail[2]);
    if ((type === "IN" && delta <= 0) || (type === "OUT" && delta >= 0) || ["IN", "OUT"].indexOf(type) === -1) {
      throw new Error("Неверный тип или знак движения " + row[0] + ".");
    }
    var event = {
      movement_id: String(row[0]), product_id: String(productId), movement_type: type,
      quantity: Math.abs(delta), effective_at: di3ToDate_(row[7], "StockLedger.effective_at"),
      recorded_at: di3ToDate_(row[8], "StockLedger.recorded_at"), row_number: Number(row._di3RowNumber || index + 2)
    };
    if (type === "IN") {
      var lot = lotByMovement[event.movement_id];
      if (!lot) throw new Error("Для прихода " + event.movement_id + " отсутствует FIFO-партия.");
      if (Number(lot[8]) !== event.quantity) throw new Error("Количество партии не совпадает с приходом " + event.movement_id + ".");
      event.lot = lot;
    }
    events.push(event);
  });
  events.sort(di3FifoEventCompare_);
  return events;
}

function di3BuildProductFifoReplayPlan_(productId, ledgerRows, detailRows, lotRows) {
  var filteredLedger = (ledgerRows || []).filter(function (row) { return String(row[3]) === String(productId); });
  var movementIds = {};
  filteredLedger.forEach(function (row) { movementIds[String(row[0])] = true; });
  var filteredDetails = (detailRows || []).filter(function (row) { return movementIds[String(row[0])]; });
  var filteredLots = (lotRows || []).filter(function (row) { return String(row[1]) === String(productId); });
  return di3BuildFifoReplayPlan_(filteredLedger, filteredDetails, filteredLots, null);
}

function di3BuildFifoAllocationRows_(runId, allocations, replayId) {
  return (allocations || []).map(function (allocation, index) {
    var allocationId = replayId
      ? "F06:" + String(replayId) + ":" + String(index + 1).padStart(6, "0")
      : di3MakeUuid_();
    return [
      allocationId, runId, allocation.movement_id, allocation.lot_id,
      allocation.product_id, allocation.allocation_type, allocation.quantity,
      allocation.unit_cost == null ? "" : allocation.unit_cost,
      allocation.cost_status,
      allocation.allocated_cost == null ? "" : allocation.allocated_cost,
      allocation.effective_at, allocation.recorded_at, "",
      allocation.allocated_cost_minor == null ? "" : allocation.allocated_cost_minor
    ];
  });
}

function di3UpdateLotRemainingRows_(lotRows, remainingByLotId) {
  var updates = [];
  (lotRows || []).forEach(function (row, index) {
    var lotId = String(row[0]);
    if (!Object.prototype.hasOwnProperty.call(remainingByLotId, lotId)) return;
    var remaining = Number(remainingByLotId[lotId]);
    if (!Number.isFinite(remaining) || remaining < 0) throw new Error("Некорректный остаток партии " + lotId + ".");
    var values = row.slice();
    values[13] = remaining;
    if (row[13] === "" || row[13] == null || Number(row[13]) !== remaining) {
      updates.push({ row_number: Number(row._di3RowNumber || index + 2), values: values });
    }
  });
  if (updates.length) di3ApplyContiguousRowUpdates_("StockLots", updates);
  (lotRows || []).forEach(function (row) {
    var lotId = String(row[0]);
    if (Object.prototype.hasOwnProperty.call(remainingByLotId, lotId)) row[13] = Number(remainingByLotId[lotId]);
  });
  return updates.length;
}

function di3DeleteStockAllocationRows_(predicate, productId) {
  var sheet = di3GetSheetOrThrow_("StockAllocations");
  var rows = productId
    ? di3ReadTaggedRowsByColumnValue_("StockAllocations", 4, productId)
    : di3ReadTableValues_("StockAllocations");
  var rowNumbers = [];
  rows.forEach(function (row, index) {
    if (predicate(row)) rowNumbers.push(Number(row._di3RowNumber || index + 2));
  });
  if (!rowNumbers.length) return 0;
  // Delete contiguous blocks from bottom to top so row numbers remain stable.
  var blocks = [];
  rowNumbers.sort(function (a, b) { return a - b; }).forEach(function (rowNumber) {
    var last = blocks.length ? blocks[blocks.length - 1] : null;
    if (last && rowNumber === last.start + last.count) last.count++;
    else blocks.push({ start: rowNumber, count: 1 });
  });
  for (var i = blocks.length - 1; i >= 0; i--) sheet.deleteRows(blocks[i].start, blocks[i].count);
  return rowNumbers.length;
}

function di3SetAllLotRemainingFromReplay_(lotRows, replayPlan) {
  var remaining = {};
  (replayPlan.remaining_lots || []).forEach(function (lot) { remaining[String(lot.lot_id)] = Number(lot.remaining_quantity); });
  (lotRows || []).forEach(function (row) {
    if (!Object.prototype.hasOwnProperty.call(remaining, String(row[0]))) remaining[String(row[0])] = Number(row[8]);
  });
  return di3UpdateLotRemainingRows_(lotRows, remaining);
}


/** Pure selector for an interrupted FIFO run; ambiguous or changed identity fails closed. */
function di3SelectReusableFifoRun_(candidateRows, options) {
  options = options || {};
  var operationId = String(options.operation_id || "");
  var scopeType = String(options.scope_type || (options.full_replay ? "FULL" : "PRODUCT_SET"));
  var scopeJson = String(options.scope_json || "[]");
  var inputFingerprint = String(options.input_fingerprint || "");
  var pending = (candidateRows || []).filter(function (match) {
    var row = match.values || match;
    var status = String(row[2] || "");
    if (status !== "PREPARED" && status !== "FAILED") return false;
    if (operationId) return String(row[10] || "") === operationId;
    return !String(row[10] || "") && String(row[12] || "") === scopeType;
  });
  if (!pending.length) return null;
  if (pending.length !== 1) throw new Error("Найдено несколько незавершённых FIFO run для одной операции/области. Автоматическое продолжение запрещено.");
  var match = pending[0], row = match.values || match;
  var emptyTailResume = !!options.allow_resume_empty_tail && !!operationId &&
    scopeType === "PRODUCT_SET" && scopeJson === "[]";
  if (String(row[12] || "") !== scopeType || String(row[13] || "") !== scopeJson ||
      String(row[14] || "") !== inputFingerprint) {
    if (!emptyTailResume || String(row[12] || "") !== "PRODUCT_SET") {
      throw new Error("Незавершённый FIFO run имеет другой scope или input fingerprint. Новое исполнение заблокировано до сверки.");
    }
  }
  return {
    run_id: String(row[0]), run_sequence: Number(row[1]), row_number: Number(match.row_number || 0), created_at: row[4],
    operation_id: String(row[10] || ""), replay_id: String(row[11] || ""),
    scope_type: String(row[12] || ""), scope_json: String(row[13] || ""),
    input_fingerprint: String(row[14] || ""), status: String(row[2] || ""),
    resumed_after_cursor_advance: emptyTailResume
  };
}

function di3GetPendingFifoRunForOperation_(operationId) {
  if (!operationId) return null;
  var matches = di3ReadRowsByColumnValue_("FifoAllocationRuns", 10, operationId)
    .filter(function (match) {
      var status = String(match.values[2] || "");
      return status === "PREPARED" || status === "FAILED";
    });
  if (matches.length > 1) throw new Error("Для операции найдено несколько незавершённых FIFO run: " + operationId + ".");
  if (!matches.length) return null;
  var row = matches[0].values;
  return {
    run_id: String(row[0]), status: String(row[2]), scope_type: String(row[12] || ""),
    scope_json: String(row[13] || ""), input_fingerprint: String(row[14] || "")
  };
}

function di3AssertNoConflictingPendingFifoRuns_(reusableRunId) {
  var sheet = di3GetSheetOrThrow_("FifoAllocationRuns");
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return true;
  var count = lastRow - 1;
  var runIds = sheet.getRange(2, 1, count, 1).getValues();
  var statuses = sheet.getRange(2, 3, count, 1).getValues();
  var conflicts = [];
  for (var i = 0; i < count; i++) {
    var status = String(statuses[i][0] || "");
    var runId = String(runIds[i][0] || "");
    if ((status === "PREPARED" || status === "FAILED") && runId !== String(reusableRunId || "")) conflicts.push(runId);
  }
  if (conflicts.length) {
    throw new Error("Обнаружен другой незавершённый FIFO run (" + conflicts.join(", ") +
      "). Сначала восстанови именно его; параллельный full/product replay запрещён.");
  }
  return true;
}

/** Stable SHA-256 fingerprint for replay inputs and projection snapshots. */
function di3BuildFifoFingerprint_(value) {
  if (typeof di3BuildManualOperationPayloadHash_ !== "function") {
    throw new Error("FIFO fingerprint helper is unavailable; load StockCore before replay.");
  }
  return di3BuildManualOperationPayloadHash_(value);
}

/** Fingerprint immutable replay inputs; mutable StockLots.remaining_quantity is excluded. */
function di3BuildFifoReplayInputFingerprint_(productId, ledgerRows, detailRows, lotRows) {
  var scopedLedger = (ledgerRows || []).filter(function (row) {
    return productId == null || String(row[3]) === String(productId);
  }).slice().sort(function (a, b) { return Number(a[12]) - Number(b[12]); });
  var movementIds = Object.create(null);
  scopedLedger.forEach(function (row) { movementIds[String(row[0])] = true; });
  var scopedDetails = (detailRows || []).filter(function (row) {
    return Object.prototype.hasOwnProperty.call(movementIds, String(row[0]));
  }).slice().sort(function (a, b) { return String(a[0]).localeCompare(String(b[0])); });
  var scopedLots = (lotRows || []).filter(function (row) {
    return productId == null || String(row[1]) === String(productId);
  }).map(function (row) {
    return row.slice(0, 13).concat(row.slice(14));
  }).sort(function (a, b) { return String(a[0]).localeCompare(String(b[0])); });
  return di3BuildFifoFingerprint_({
    product_id: productId == null ? "FULL" : String(productId),
    ledger: scopedLedger,
    details: scopedDetails,
    lots: scopedLots
  });
}

function di3BuildFifoAllocationSnapshotFingerprint_(allocationRows) {
  var stableRows = (allocationRows || []).map(function (row) { return row.slice(0, 14); })
    .sort(function (a, b) { return String(a[0]).localeCompare(String(b[0])); });
  return di3BuildFifoFingerprint_(stableRows);
}

function di3BuildFifoLotCacheSnapshot_(lotRows, remainingByLotId, productId) {
  return (lotRows || []).filter(function (row) {
    return productId == null || String(row[1]) === String(productId);
  }).map(function (row) {
    var lotId = String(row[0]);
    var remaining = remainingByLotId && Object.prototype.hasOwnProperty.call(remainingByLotId, lotId)
      ? remainingByLotId[lotId] : row[13];
    return [lotId, String(row[1]), remaining];
  }).sort(function (a, b) { return String(a[0]).localeCompare(String(b[0])); });
}

function di3AppendFifoArchiveRowsIdempotently_(tableName, rows) {
  if (!rows || !rows.length) return 0;
  var ids = rows.map(function (row) { return String(row[0]); });
  var expectedIds = Object.create(null);
  ids.forEach(function (id) {
    if (!id || expectedIds[id]) throw new Error(tableName + ": duplicate or blank expected archive_row_id " + id + ".");
    expectedIds[id] = true;
  });
  var existing = di3ReadRowsByColumnValues_(tableName, 0, ids);
  var existingById = Object.create(null);
  existing.forEach(function (match) {
    var id = String(match.values[0]);
    if (existingById[id]) throw new Error(tableName + ": duplicate archive_row_id " + id + ".");
    existingById[id] = match.values;
  });
  var missing = [];
  rows.forEach(function (row) {
    var id = String(row[0]), saved = existingById[id];
    if (!saved) { missing.push(row); return; }
    if (di3BuildFifoFingerprint_(saved) !== di3BuildFifoFingerprint_(row)) {
      throw new Error(tableName + ": archive row content mismatch for " + id + ".");
    }
  });
  di3AppendTableRows_(tableName, missing);
  return missing.length;
}

function di3GetLatestFifoReplayEvent_(replayId) {
  var matches = di3ReadRowsByColumnValue_("FifoReplayEvents", 1, replayId);
  if (!matches.length) return null;
  matches.forEach(function (match) {
    var sequence = Number(match.values[2]);
    if (!Number.isSafeInteger(sequence) || sequence <= 0) {
      throw new Error("FifoReplayEvents: invalid event_sequence for replay " + replayId + ".");
    }
  });
  matches.sort(function (a, b) { return Number(a.values[2]) - Number(b.values[2]); });
  for (var i = 1; i < matches.length; i++) {
    if (Number(matches[i - 1].values[2]) === Number(matches[i].values[2])) {
      throw new Error("FifoReplayEvents: duplicate event_sequence for replay " + replayId + ".");
    }
  }
  return matches[matches.length - 1];
}

function di3AppendFifoReplayEvent_(context, eventType, fingerprints, details) {
  var latest = di3GetLatestFifoReplayEvent_(context.replay_id);
  if (latest) {
    var latestRow = latest.values;
    if (String(latestRow[8]) !== String(context.input_fingerprint) ||
        String(latestRow[9]) !== String(fingerprints.source_allocations) ||
        String(latestRow[10]) !== String(fingerprints.target_allocations) ||
        String(latestRow[11]) !== String(fingerprints.source_lots) ||
        String(latestRow[12]) !== String(fingerprints.target_lots)) {
      throw new Error("FIFO replay " + context.replay_id + " уже существует с другими fingerprint-значениями.");
    }
    if (String(latestRow[3]) === eventType || String(latestRow[3]) === "COMMITTED") return latest;
    if (String(latestRow[3]) !== "PREPARED") {
      throw new Error("FIFO replay " + context.replay_id + " находится в терминальном состоянии " + latestRow[3] + ".");
    }
  }
  var eventSequence = latest ? Number(latest.values[2]) + 1 : 1;
  var row = [
    di3MakeUuid_(), context.replay_id, eventSequence, eventType,
    context.fifo_run_id, context.operation_id || "", context.scope_type,
    context.scope_json, context.input_fingerprint,
    fingerprints.source_allocations, fingerprints.target_allocations,
    fingerprints.source_lots, fingerprints.target_lots,
    new Date(), JSON.stringify(details || {})
  ];
  di3AppendTableRows_("FifoReplayEvents", [row]);
  return { row_number: di3GetSheetOrThrow_("FifoReplayEvents").getLastRow(), values: row };
}

function di3ReadFifoReplayArchiveSnapshots_(replayId) {
  var allocationMatches = di3ReadRowsByColumnValue_("FifoAllocationArchive", 1, replayId);
  var lotMatches = di3ReadRowsByColumnValue_("FifoLotCacheArchive", 1, replayId);
  var allocationIds = Object.create(null), lotIds = Object.create(null);
  allocationMatches.forEach(function (match) {
    var id = String(match.values[0]);
    if (allocationIds[id]) throw new Error("FifoAllocationArchive: duplicate archive row " + id + ".");
    allocationIds[id] = true;
  });
  lotMatches.forEach(function (match) {
    var id = String(match.values[0]);
    if (lotIds[id]) throw new Error("FifoLotCacheArchive: duplicate archive row " + id + ".");
    lotIds[id] = true;
  });
  allocationMatches.sort(function (a, b) { return String(a.values[4]).localeCompare(String(b.values[4])); });
  lotMatches.sort(function (a, b) { return String(a.values[2]).localeCompare(String(b.values[2])); });
  return {
    allocation_rows: allocationMatches.map(function (match) { return match.values.slice(4, 18); }),
    allocation_archive_rows: allocationMatches.map(function (match) { return match.values; }),
    lot_archive_rows: lotMatches.map(function (match) { return match.values; })
  };
}

function di3RestoreFifoReplaySourceSnapshot_(predicate, productId, sourceRows, lotArchiveRows, lotRows) {
  di3DeleteStockAllocationRows_(predicate, productId);
  if (sourceRows && sourceRows.length) {
    di3AppendTableRows_("StockAllocations", sourceRows.map(function (row) { return row.slice(0, 14); }));
  }
  var sourceRemaining = Object.create(null);
  (lotArchiveRows || []).forEach(function (row) { sourceRemaining[String(row[2])] = row[4]; });
  di3UpdateLotRemainingRows_(lotRows, sourceRemaining);
  return { allocations: (sourceRows || []).length, lots: Object.keys(sourceRemaining).length };
}

/** Persist source snapshots and PREPARED before any active FIFO projection write. */
function di3PrepareFifoReplay_(context, predicate, productId, currentRows) {
  var currentAllocationRows = (currentRows || []).map(function (row) { return row.slice(0, 14); });
  var currentAllocationFingerprint = di3BuildFifoAllocationSnapshotFingerprint_(currentAllocationRows);
  var currentLotSnapshot = di3BuildFifoLotCacheSnapshot_(context.lot_rows, null, productId);
  var currentLotFingerprint = di3BuildFifoFingerprint_(currentLotSnapshot);
  var targetAllocationFingerprint = di3BuildFifoAllocationSnapshotFingerprint_(context.target_rows);
  var targetLotSnapshot = di3BuildFifoLotCacheSnapshot_(context.lot_rows, context.target_remaining, productId);
  var targetLotFingerprint = di3BuildFifoFingerprint_(targetLotSnapshot);
  var fingerprints = {
    source_allocations: "",
    target_allocations: targetAllocationFingerprint,
    source_lots: "",
    target_lots: targetLotFingerprint
  };
  var latest = di3GetLatestFifoReplayEvent_(context.replay_id);
  var sourceRows, lotArchiveRows, sourceAllocationFingerprint, sourceLotFingerprint;
  if (latest) {
    var event = latest.values;
    if (String(event[4]) !== String(context.fifo_run_id) ||
        String(event[5] || "") !== String(context.operation_id || "") ||
        String(event[6]) !== String(context.scope_type) ||
        String(event[7]) !== String(context.scope_json) ||
        String(event[8]) !== String(context.input_fingerprint) ||
        String(event[10]) !== targetAllocationFingerprint ||
        String(event[12]) !== targetLotFingerprint) {
      throw new Error("FIFO replay identity/fingerprint mismatch for " + context.replay_id + ".");
    }
    var archive = di3ReadFifoReplayArchiveSnapshots_(context.replay_id);
    sourceRows = archive.allocation_rows;
    lotArchiveRows = archive.lot_archive_rows;
    sourceAllocationFingerprint = di3BuildFifoAllocationSnapshotFingerprint_(sourceRows);
    var sourceLotSnapshot = lotArchiveRows.map(function (row) { return [String(row[2]), String(row[3]), row[4]]; });
    sourceLotFingerprint = di3BuildFifoFingerprint_(sourceLotSnapshot);
    if (sourceAllocationFingerprint !== String(event[9]) || sourceLotFingerprint !== String(event[11])) {
      throw new Error("FIFO replay archive is incomplete or inconsistent for " + context.replay_id + ".");
    }
    if (String(event[3]) === "COMMITTED") {
      if (currentAllocationFingerprint !== targetAllocationFingerprint || currentLotFingerprint !== targetLotFingerprint) {
        throw new Error("COMMITTED FIFO replay projection no longer matches its target fingerprint: " + context.replay_id + ".");
      }
      return { already_target: true, already_committed: true, source_rows: sourceRows, lot_archive_rows: lotArchiveRows, fingerprints: fingerprints };
    }
    if (String(event[3]) !== "PREPARED") {
      throw new Error("FIFO replay cannot resume from state " + event[3] + ".");
    }
    fingerprints.source_allocations = sourceAllocationFingerprint;
    fingerprints.source_lots = sourceLotFingerprint;
    var isTarget = currentAllocationFingerprint === targetAllocationFingerprint && currentLotFingerprint === targetLotFingerprint;
    var isSource = currentAllocationFingerprint === sourceAllocationFingerprint && currentLotFingerprint === sourceLotFingerprint;
    if (isTarget) return { already_target: true, source_rows: sourceRows, lot_archive_rows: lotArchiveRows, fingerprints: fingerprints };
    if (!isSource) {
      di3RestoreFifoReplaySourceSnapshot_(predicate, productId, sourceRows, lotArchiveRows, context.lot_rows);
    }
    return { already_target: false, source_rows: sourceRows, lot_archive_rows: lotArchiveRows, fingerprints: fingerprints };
  }

  sourceRows = currentAllocationRows;
  sourceAllocationFingerprint = currentAllocationFingerprint;
  var archivedAt = context.archived_at || new Date();
  var allocationArchiveRows = sourceRows.map(function (row) {
    if (!row[0]) throw new Error("Нельзя архивировать StockAllocations без allocation_id.");
    return ["F06A:" + context.replay_id + ":" + String(row[0]), context.replay_id, archivedAt, context.reason || "FIFO_REPLAY"]
      .concat(row);
  });
  var lotArchiveRowsToWrite = currentLotSnapshot.map(function (row) {
    return ["F06L:" + context.replay_id + ":" + row[0], context.replay_id, row[0], row[1], row[2], archivedAt];
  });
  di3AppendFifoArchiveRowsIdempotently_("FifoAllocationArchive", allocationArchiveRows);
  di3AppendFifoArchiveRowsIdempotently_("FifoLotCacheArchive", lotArchiveRowsToWrite);
  var verifiedArchive = di3ReadFifoReplayArchiveSnapshots_(context.replay_id);
  var verifiedSourceAllocationFingerprint = di3BuildFifoAllocationSnapshotFingerprint_(verifiedArchive.allocation_rows);
  var verifiedSourceLotSnapshot = verifiedArchive.lot_archive_rows.map(function (row) {
    return [String(row[2]), String(row[3]), row[4]];
  });
  var verifiedSourceLotFingerprint = di3BuildFifoFingerprint_(verifiedSourceLotSnapshot);
  if (verifiedSourceAllocationFingerprint !== sourceAllocationFingerprint || verifiedSourceLotFingerprint !== currentLotFingerprint) {
    throw new Error("FIFO archive snapshot does not exactly match the active source projection for " + context.replay_id + ".");
  }
  fingerprints.source_allocations = sourceAllocationFingerprint;
  fingerprints.source_lots = currentLotFingerprint;
  di3AppendFifoReplayEvent_(context, "PREPARED", fingerprints, {
    archive_allocations: allocationArchiveRows.length,
    archive_lots: lotArchiveRowsToWrite.length
  });
  return {
    already_target: false, source_rows: sourceRows,
    lot_archive_rows: lotArchiveRowsToWrite, fingerprints: fingerprints
  };
}

function di3GetPendingFifoReplayEventsForRun_(runId) {
  var matches = di3ReadRowsByColumnValue_("FifoReplayEvents", 4, runId);
  var latestByReplay = Object.create(null);
  matches.forEach(function (match) {
    var row = match.values, replayId = String(row[1]);
    if (!Number.isSafeInteger(Number(row[2])) || Number(row[2]) <= 0) {
      throw new Error("FifoReplayEvents: invalid event_sequence for replay " + replayId + ".");
    }
    var previous = latestByReplay[replayId];
    if (previous && Number(row[2]) === Number(previous.values[2])) {
      throw new Error("FifoReplayEvents: duplicate event_sequence for replay " + replayId + ".");
    }
    if (!previous || Number(row[2]) > Number(previous.values[2])) latestByReplay[replayId] = match;
  });
  return Object.keys(latestByReplay).map(function (id) { return latestByReplay[id]; })
    .filter(function (match) { return String(match.values[3]) === "PREPARED"; });
}

/** Recover every durable PREPARED replay before processing any new tail rows. */
function di3RecoverPendingFifoReplaysForRun_(run, reason) {
  var pending = di3GetPendingFifoReplayEventsForRun_(run.run_id);
  if (!pending.length) return { recovered: 0, products: [], full_replay: false };
  var ledgerRows = di3ReadTableValues_("StockLedger");
  var detailRows = di3ReadTableValues_("StockMovementDetails");
  var lotRows = di3ReadTableValues_("StockLots");
  var recoveredProducts = Object.create(null);
  var fullReplayRecovered = false;
  var replayedMovements = 0, recoveredAllocations = 0, recoveredRemoved = 0, recoveredLots = 0;

  pending.forEach(function (match) {
    var event = match.values;
    var context = {
      replay_id: String(event[1]), fifo_run_id: String(event[4]), operation_id: String(event[5] || ""),
      scope_type: String(event[6]), scope_json: String(event[7]), input_fingerprint: String(event[8]),
      reason: "RECOVERY:" + String(reason || "FIFO"), archived_at: run.created_at,
      lot_rows: lotRows
    };
    var fingerprints = {
      source_allocations: String(event[9]), target_allocations: String(event[10]),
      source_lots: String(event[11]), target_lots: String(event[12])
    };
    try {
      if (context.scope_type === "PRODUCT") {
        var scope = JSON.parse(context.scope_json);
        if (!Array.isArray(scope) || scope.length !== 1 || !scope[0]) throw new Error("Некорректный PRODUCT replay scope.");
        var productId = String(scope[0]);
        var actualInputFingerprint = di3BuildFifoReplayInputFingerprint_(productId, ledgerRows, detailRows, lotRows);
        if (actualInputFingerprint !== context.input_fingerprint) throw new Error("Изменился immutable input fingerprint товара " + productId + ".");
        var replay = di3BuildProductFifoReplayPlan_(productId, ledgerRows, detailRows, lotRows);
        var targetRows = di3BuildFifoAllocationRows_(run.run_id, replay.allocations, context.replay_id);
        var remaining = {};
        replay.remaining_lots.forEach(function (lot) { remaining[String(lot.lot_id)] = Number(lot.remaining_quantity); });
        lotRows.filter(function (row) { return String(row[1]) === productId; }).forEach(function (row) {
          if (!Object.prototype.hasOwnProperty.call(remaining, String(row[0]))) remaining[String(row[0])] = Number(row[8]);
        });
        context.target_rows = targetRows;
        context.target_remaining = remaining;
        var productReplace = di3ReplaceFifoProjectionSafely_(function (row) { return String(row[4]) === productId; },
          targetRows, lotRows, remaining, productId, context);
        recoveredAllocations += Number(productReplace.allocations_written || productReplace.allocations_already_present || 0);
        recoveredRemoved += Number(productReplace.allocations_removed || 0);
        recoveredLots += Object.keys(remaining).length;
        var productLedgerRows = ledgerRows.filter(function (row) { return String(row[3]) === productId; });
        di3UpsertFifoProductStateRows_(di3BuildFifoProductStateRows_([productId], productLedgerRows, lotRows));
        recoveredProducts[productId] = true;
        replayedMovements += replay.movement_count;
      } else if (context.scope_type === "FULL") {
        if (context.scope_json !== "FULL") throw new Error("Некорректный FULL replay scope.");
        var fullInputFingerprint = di3BuildFifoReplayInputFingerprint_(null, ledgerRows, detailRows, lotRows);
        if (fullInputFingerprint !== context.input_fingerprint) throw new Error("Изменился immutable input fingerprint полного FIFO replay.");
        var fullReplay = di3BuildFifoReplayPlan_(ledgerRows, detailRows, lotRows, null);
        var fullTargetRows = di3BuildFifoAllocationRows_(run.run_id, fullReplay.allocations, context.replay_id);
        var fullRemaining = {};
        fullReplay.remaining_lots.forEach(function (lot) { fullRemaining[String(lot.lot_id)] = Number(lot.remaining_quantity); });
        lotRows.forEach(function (row) {
          if (!Object.prototype.hasOwnProperty.call(fullRemaining, String(row[0]))) fullRemaining[String(row[0])] = Number(row[8]);
        });
        context.target_rows = fullTargetRows;
        context.target_remaining = fullRemaining;
        var fullReplace = di3ReplaceFifoProjectionSafely_(function () { return true; }, fullTargetRows, lotRows, fullRemaining, null, context);
        recoveredAllocations += Number(fullReplace.allocations_written || fullReplace.allocations_already_present || 0);
        recoveredRemoved += Number(fullReplace.allocations_removed || 0);
        recoveredLots += Object.keys(fullRemaining).length;
        var allProductIds = Array.from(new Set(ledgerRows.map(function (row) { return String(row[3] || ""); }).filter(Boolean)));
        di3UpsertFifoProductStateRows_(di3BuildFifoProductStateRows_(allProductIds, ledgerRows, lotRows));
        fullReplayRecovered = true;
        replayedMovements += fullReplay.movement_count;
      } else {
        throw new Error("Unsupported FIFO replay scope type: " + context.scope_type);
      }
    } catch (recoveryError) {
      try {
        di3AppendFifoReplayEvent_(context, "QUARANTINED", fingerprints, {
          recovery_error: recoveryError && recoveryError.message ? recoveryError.message : String(recoveryError)
        });
      } catch (ignoreQuarantineWrite) {}
      throw new Error("FIFO replay " + context.replay_id + " помещён в quarantine: " +
        (recoveryError && recoveryError.message ? recoveryError.message : String(recoveryError)));
    }
  });
  return {
    recovered: pending.length,
    products: Object.keys(recoveredProducts),
    full_replay: fullReplayRecovered,
    movements_replayed: replayedMovements,
    allocations_written: recoveredAllocations,
    allocations_removed: recoveredRemoved,
    lots_updated: recoveredLots
  };
}

/** Block new stock events while an earlier FIFO run is unresolved. */
function di3AssertNoPendingFifoRuns_() {
  var sheet = di3GetSheetOrThrow_("FifoAllocationRuns");
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return true;
  var statuses = sheet.getRange(2, 3, lastRow - 1, 1).getValues();
  for (var i = 0; i < statuses.length; i++) {
    var status = String(statuses[i][0] || "");
    if (status === "PREPARED" || status === "FAILED") {
      throw new Error("Незавершённый FIFO run обнаружен. Сначала восстанови или проверь run в журнале FIFO: строка " + (i + 2) + ".");
    }
  }
  return true;
}

function di3CommitFifoReplayEventsForRun_(runId) {
  var matches = di3ReadRowsByColumnValue_("FifoReplayEvents", 4, runId);
  var latestByReplay = Object.create(null);
  matches.forEach(function (match) {
    var row = match.values, replayId = String(row[1]);
    if (!Number.isSafeInteger(Number(row[2])) || Number(row[2]) <= 0) {
      throw new Error("FifoReplayEvents: invalid event_sequence for replay " + replayId + ".");
    }
    var previous = latestByReplay[replayId];
    if (previous && Number(row[2]) === Number(previous.values[2])) {
      throw new Error("FifoReplayEvents: duplicate event_sequence for replay " + replayId + ".");
    }
    if (!previous || Number(row[2]) > Number(previous.values[2])) latestByReplay[replayId] = match;
  });
  Object.keys(latestByReplay).forEach(function (replayId) {
    var row = latestByReplay[replayId].values;
    if (String(row[3]) !== "PREPARED") return;
    var context = {
      replay_id: String(row[1]), fifo_run_id: String(row[4]), operation_id: String(row[5] || ""),
      scope_type: String(row[6]), scope_json: String(row[7]), input_fingerprint: String(row[8])
    };
    di3AppendFifoReplayEvent_(context, "COMMITTED", {
      source_allocations: String(row[9]), target_allocations: String(row[10]),
      source_lots: String(row[11]), target_lots: String(row[12])
    }, { committed_by_run: String(runId) });
  });
  return Object.keys(latestByReplay).length;
}

function di3CreateFifoRun_(reason, ledgerCount, allocationCount, productCount, options) {
  options = options || {};
  var sheet = di3GetSheetOrThrow_("FifoAllocationRuns");
  var lastRow = sheet.getLastRow();
  var operationId = String(options.operation_id || "");
  var scopeType = String(options.scope_type || (options.full_replay ? "FULL" : "PRODUCT_SET"));
  var scopeJson = String(options.scope_json || "[]");
  var inputFingerprint = String(options.input_fingerprint || "");
  var candidates = operationId
    ? di3ReadRowsByColumnValue_("FifoAllocationRuns", 10, operationId)
    : di3ReadRowsByColumnValue_("FifoAllocationRuns", 12, scopeType).filter(function (match) {
        return !String(match.values[10] || "");
      });
  var reusable = di3SelectReusableFifoRun_(candidates, {
    operation_id: operationId, scope_type: scopeType, scope_json: scopeJson,
    input_fingerprint: inputFingerprint, full_replay: !!options.full_replay,
    allow_resume_empty_tail: !!options.allow_resume_empty_tail
  });
  if (reusable) {
    di3AssertNoConflictingPendingFifoRuns_(reusable.run_id);
    if (reusable.status === "FAILED") di3UpdateFifoRunStatus_(reusable.row_number, "PREPARED", "", "", null);
    reusable.status = "PREPARED";
    return reusable;
  }
  di3AssertNoConflictingPendingFifoRuns_("");
  // Run records are append-only. Read the last sequence, not the entire history.
  var lastSequence = lastRow >= 2 ? Number(sheet.getRange(lastRow, 2, 1, 1).getValue()) : 0;
  if (!Number.isFinite(lastSequence) || lastSequence < 0) {
    // Defensive compatibility fallback for a malformed final row; read only sequence column.
    var sequenceRows = lastRow >= 2 ? sheet.getRange(2, 2, lastRow - 1, 1).getValues() : [];
    lastSequence = sequenceRows.reduce(function (max, row) { return Math.max(max, Number(row[0]) || 0); }, 0);
  }
  var sequence = lastSequence + 1;
  var runId = di3MakeUuid_();
  var replayId = String(options.replay_id || (operationId ? "OP:" + operationId : "FULL:" + runId));
  var row = [runId, sequence, "PREPARED", reason || "INCREMENTAL_FIFO", new Date(), "",
    ledgerCount, allocationCount, productCount, "", operationId, replayId, scopeType, scopeJson, inputFingerprint];
  di3AppendTableRows_("FifoAllocationRuns", [row]);
  return { run_id: runId, run_sequence: sequence, row_number: sheet.getLastRow(), created_at: row[4],
    operation_id: operationId, replay_id: replayId, scope_type: scopeType, scope_json: scopeJson,
    input_fingerprint: inputFingerprint };
}

function di3GetFifoProductState_(stateRows, productId) {
  for (var i = 0; i < (stateRows || []).length; i++) {
    if (String(stateRows[i][0]) === String(productId)) return stateRows[i];
  }
  return null;
}

function di3CompareEventToState_(event, stateRow) {
  if (!stateRow) return 1;
  var byEffective = di3ToMillis_(event.effective_at) - di3ToMillis_(stateRow[1]);
  if (byEffective) return byEffective;
  var byRecorded = di3ToMillis_(event.recorded_at) - di3ToMillis_(stateRow[2]);
  if (byRecorded) return byRecorded;
  return String(event.movement_id).localeCompare(String(stateRow[3]));
}

function di3BuildFifoTailPlanForProduct_(productId, tailLedgerRows, detailRows, lotRows, activeAllocationRows, stateRows) {
  var events = di3GetFifoEventsForProduct_(productId, tailLedgerRows, detailRows, lotRows);
  if (!events.length) return { mode: "NO_NEW_EVENTS", allocations: [], remaining_by_lot: {}, events: [] };
  var state = di3GetFifoProductState_(stateRows, productId);
  var productLots = (lotRows || []).filter(function (row) { return String(row[1]) === String(productId); });
  var newInboundIds = {};
  events.forEach(function (event) { if (event.movement_type === "IN") newInboundIds[event.movement_id] = true; });

  if (productLots.some(function (row) { return !newInboundIds[String(row[2])] && (row[13] === "" || row[13] == null || !Number.isFinite(Number(row[13]))); })) {
    return { mode: "PRODUCT_REPLAY_REQUIRED", reason: "MISSING_REMAINING_CACHE", events: events };
  }
  if (!state && productLots.some(function (row) { return !newInboundIds[String(row[2])]; })) {
    return { mode: "PRODUCT_REPLAY_REQUIRED", reason: "MISSING_PRODUCT_STATE", events: events };
  }
  if (state && events.some(function (event) { return di3CompareEventToState_(event, state) < 0; })) {
    return { mode: "PRODUCT_REPLAY_REQUIRED", reason: "BACKDATED_EVENT", events: events };
  }

  var allocationByMovement = {};
  (activeAllocationRows || []).forEach(function (row) {
    if (String(row[4]) !== String(productId)) return;
    var movementId = String(row[2]);
    if (!allocationByMovement[movementId]) allocationByMovement[movementId] = [];
    allocationByMovement[movementId].push(row);
  });
  // A movement with prior allocations is a retry after a partial commit. Replaying only this product
  // reconstructs both allocation rows and lot balances from the immutable ledger.
  if (events.some(function (event) { return event.movement_type === "OUT" && allocationByMovement[event.movement_id] && allocationByMovement[event.movement_id].length; })) {
    return { mode: "PRODUCT_REPLAY_REQUIRED", reason: "PARTIALLY_APPLIED_MOVEMENT", events: events };
  }

  var availableLots = [];
  var remainingByLot = {};
  productLots.forEach(function (row) {
    if (newInboundIds[String(row[2])]) return;
    var remaining = Number(row[13]);
    remainingByLot[String(row[0])] = remaining;
    if (remaining > 0) availableLots.push({
      lot_id: String(row[0]), product_id: String(productId),
      effective_at: row[6], recorded_at: row[7], remaining_quantity: remaining,
      initial_quantity: Number(row[8]), consumed_quantity: Number(row[8]) - remaining,
      unit_cost: row[9] === "" || row[9] == null ? null : Number(row[9]),
      total_cost_minor: di3MoneyGetLotTotalCostMinor_(row),
      cost_status: String(row[10] || "UNKNOWN")
    });
  });

  function sortLots() {
    availableLots.sort(function (a, b) {
      var byEffective = di3ToMillis_(a.effective_at) - di3ToMillis_(b.effective_at);
      if (byEffective) return byEffective;
      var byRecorded = di3ToMillis_(a.recorded_at) - di3ToMillis_(b.recorded_at);
      if (byRecorded) return byRecorded;
      return String(a.lot_id).localeCompare(String(b.lot_id));
    });
  }
  sortLots();
  var allocations = [];
  var movementCosts = {};
  events.forEach(function (event) {
    if (event.movement_type === "IN") {
      var lotRow = event.lot;
      var lotId = String(lotRow[0]);
      // If remaining_quantity is already populated, a previous attempt already applied this receipt.
      var alreadyApplied = lotRow[13] !== "" && lotRow[13] != null && Number.isFinite(Number(lotRow[13]));
      var lot = {
        lot_id: lotId, product_id: String(productId), effective_at: lotRow[6], recorded_at: lotRow[7],
        remaining_quantity: alreadyApplied ? Number(lotRow[13]) : Number(lotRow[8]),
        initial_quantity: Number(lotRow[8]),
        consumed_quantity: alreadyApplied ? Number(lotRow[8]) - Number(lotRow[13]) : 0,
        unit_cost: lotRow[9] === "" || lotRow[9] == null ? null : Number(lotRow[9]),
        total_cost_minor: di3MoneyGetLotTotalCostMinor_(lotRow),
        cost_status: String(lotRow[10] || "UNKNOWN")
      };
      remainingByLot[lotId] = lot.remaining_quantity;
      if (lot.remaining_quantity > 0) availableLots.push(lot);
      sortLots();
      return;
    }
    var needed = event.quantity;
    var knownQuantity = 0, unknownQuantity = 0, knownCostMinor = 0;
    var movementAllocations = [];
    for (var i = 0; i < availableLots.length && needed > 0; i++) {
      var currentLot = availableLots[i];
      if (currentLot.remaining_quantity <= 0) continue;
      var take = Math.min(needed, currentLot.remaining_quantity);
      var status = currentLot.cost_status;
      var unitCost = status === "UNKNOWN" ? null : (status === "FREE" ? 0 : Number(currentLot.unit_cost));
      if (status === "KNOWN" && (!Number.isFinite(unitCost) || unitCost < 0)) throw new Error("Некорректная себестоимость партии " + currentLot.lot_id + ".");
      var allocatedCostMinor = status === "UNKNOWN" ? null : di3MoneyAllocateLotCostMinor_(
        Number(currentLot.total_cost_minor), Number(currentLot.initial_quantity),
        Number(currentLot.consumed_quantity), take);
      var allocatedCost = allocatedCostMinor == null ? null : di3MoneyFromMinorUnits_(allocatedCostMinor);
      var allocation = {
        movement_id: event.movement_id, lot_id: currentLot.lot_id, product_id: String(productId),
        allocation_type: "CONSUME", quantity: take, unit_cost: unitCost,
        cost_status: status, allocated_cost: allocatedCost, allocated_cost_minor: allocatedCostMinor,
        effective_at: event.effective_at, recorded_at: event.recorded_at
      };
      allocations.push(allocation);
      movementAllocations.push(allocation);
      if (status === "UNKNOWN") unknownQuantity += take;
      else { knownQuantity += take; knownCostMinor += allocatedCostMinor; }
      currentLot.consumed_quantity += take;
      currentLot.remaining_quantity -= take;
      remainingByLot[currentLot.lot_id] = currentLot.remaining_quantity;
      needed -= take;
    }
    if (needed > 0) throw new Error("Недостаточно остатка для расхода " + event.movement_id + ": не хватает " + needed + " шт. на дату операции.");
    movementCosts[event.movement_id] = {
      movement_id: event.movement_id, quantity: event.quantity,
      known_quantity: knownQuantity, unknown_quantity: unknownQuantity,
      known_cost_minor: knownCostMinor,
      known_cost: di3MoneyFromMinorUnits_(knownCostMinor),
      total_cost_minor: unknownQuantity === 0 ? knownCostMinor : null,
      total_cost: unknownQuantity === 0 ? di3MoneyFromMinorUnits_(knownCostMinor) : null,
      cost_status: unknownQuantity === 0 ? "COMPLETE" : (knownQuantity ? "PARTIAL" : "UNKNOWN"),
      allocation_count: movementAllocations.length
    };
  });
  availableLots.forEach(function (lot) { remainingByLot[lot.lot_id] = lot.remaining_quantity; });
  return { mode: "INCREMENTAL_TAIL", events: events, allocations: allocations, remaining_by_lot: remainingByLot, movement_costs: movementCosts };
}

function di3RestoreLotRemainingSnapshot_(lotRows) {
  if (!lotRows || !lotRows.length) return;
  var sheet = di3GetSheetOrThrow_("StockLots");
  // The supplied product-scoped snapshot is immutable during the write phase.
  // Restore by physical row instead of downloading the entire StockLots table.
  lotRows.forEach(function (row, index) {
    var rowNumber = Number(row._di3RowNumber || index + 2);
    sheet.getRange(rowNumber, 14).setValue(row[13]);
  });
}

/** Replaces one FIFO projection after a durable source snapshot and PREPARED event. */
function di3ReplaceFifoProjectionSafely_(predicate, newAllocationRows, lotRows, remainingByLotId, productId, replayContext) {
  var previousRows = (productId
    ? di3ReadTaggedRowsByColumnValue_("StockAllocations", 4, productId)
    : di3ReadTableValues_("StockAllocations")).filter(predicate);
  var prepared = replayContext
    ? di3PrepareFifoReplay_(replayContext, predicate, productId, previousRows)
    : null;
  if (prepared && prepared.already_target) {
    return { allocations_removed: 0, allocations_written: 0, allocations_already_present: (newAllocationRows || []).length,
      replay_id: replayContext.replay_id, replay_already_applied: true };
  }
  if (prepared) previousRows = prepared.source_rows.map(function (row) { return row.slice(0, 14); });
  var removed = 0;
  try {
    removed = di3DeleteStockAllocationRows_(predicate, productId);
    if (newAllocationRows && newAllocationRows.length) di3AppendTableRows_("StockAllocations", newAllocationRows);
    di3UpdateLotRemainingRows_(lotRows, remainingByLotId || {});
    return { allocations_removed: removed, allocations_written: (newAllocationRows || []).length,
      replay_id: replayContext ? replayContext.replay_id : "" };
  } catch (writeError) {
    var rollbackError = null;
    try {
      di3DeleteStockAllocationRows_(predicate, productId);
      if (previousRows.length) di3AppendTableRows_("StockAllocations", previousRows.map(function (row) { return row.slice(0, 14); }));
      di3RestoreLotRemainingSnapshot_(lotRows);
    } catch (restoreError) {
      rollbackError = restoreError;
    }
    if (rollbackError) {
      throw new Error("FIFO-проекция не записана; автоматический откат также завершился ошибкой. Исходная ошибка: " +
        (writeError && writeError.message ? writeError.message : String(writeError)) + ". Ошибка отката: " +
        (rollbackError && rollbackError.message ? rollbackError.message : String(rollbackError)));
    }
    throw writeError;
  }
}

function di3ApplyIncrementalFifoForProduct_(productId, runId, tailLedgerRows, detailRows, lotRows, activeAllocationRows, stateRows, allLedgerRows, operationId, runCreatedAt) {
  var plan = di3BuildFifoTailPlanForProduct_(productId, tailLedgerRows, detailRows, lotRows, activeAllocationRows, stateRows);
  if (plan.mode === "NO_NEW_EVENTS") return { mode: plan.mode, movements_replayed: 0, allocations_created: 0, allocations_replaced: 0, lots_updated: 0, movement_costs: {} };
  if (plan.mode === "PRODUCT_REPLAY_REQUIRED") {
    var ledgerRows = Array.isArray(allLedgerRows) ? allLedgerRows : di3ReadTableValues_("StockLedger");
    var replay = di3BuildProductFifoReplayPlan_(productId, ledgerRows, detailRows, lotRows);
    var replayId = operationId ? "OP:" + String(operationId) + ":PRODUCT:" + String(productId) : "RUN:" + String(runId) + ":PRODUCT:" + String(productId);
    var allocationRows = di3BuildFifoAllocationRows_(runId, replay.allocations, replayId);
    var remainingFromReplay = {};
    replay.remaining_lots.forEach(function (lot) { remainingFromReplay[String(lot.lot_id)] = Number(lot.remaining_quantity); });
    (lotRows || []).filter(function (row) { return String(row[1]) === String(productId); }).forEach(function (row) {
      if (!Object.prototype.hasOwnProperty.call(remainingFromReplay, String(row[0]))) remainingFromReplay[String(row[0])] = Number(row[8]);
    });
    // Pass the full sheet row set: di3UpdateLotRemainingRows_ maps array indexes to physical row numbers.
    // The remaining map itself contains only this product's lot IDs, so other products stay untouched.
    var replayContext = {
      replay_id: replayId,
      fifo_run_id: String(runId),
      operation_id: String(operationId || ""),
      scope_type: "PRODUCT",
      scope_json: JSON.stringify([String(productId)]),
      input_fingerprint: di3BuildFifoReplayInputFingerprint_(productId, ledgerRows, detailRows, lotRows),
      reason: "PRODUCT_REPLAY:" + String(plan.reason || "REPLAY"),
      archived_at: runCreatedAt,
      target_rows: allocationRows,
      target_remaining: remainingFromReplay,
      lot_rows: lotRows || []
    };
    var replaceResult = di3ReplaceFifoProjectionSafely_(function (row) { return String(row[4]) === String(productId); },
      allocationRows, lotRows || [], remainingFromReplay, productId, replayContext);
    return {
      mode: "PRODUCT_REPLAY", replay_reason: plan.reason, movements_replayed: replay.movement_count,
      allocations_created: allocationRows.length, allocations_replaced: replaceResult.allocations_removed,
      lots_updated: (lotRows || []).filter(function (row) { return String(row[1]) === String(productId); }).length,
      movement_costs: replay.movement_costs
    };
  }
  var rowsToWrite = di3BuildFifoAllocationRows_(runId, plan.allocations);
  if (rowsToWrite.length) di3AppendTableRows_("StockAllocations", rowsToWrite);
  var updated = di3UpdateLotRemainingRows_(lotRows, plan.remaining_by_lot);
  return {
    mode: "INCREMENTAL", movements_replayed: plan.events.length,
    allocations_created: rowsToWrite.length, allocations_replaced: 0,
    lots_updated: updated, movement_costs: plan.movement_costs
  };
}

function di3PreflightFifoForProducts_(candidateLedgerRows, candidateDetailRows, candidateLotRows, productIds, existingLedgerRows) {
  // Callers that already loaded the current ledger can pass that exact pre-write
  // snapshot; avoid an otherwise redundant full-table read during preflight.
  var currentLedgerRows = Array.isArray(existingLedgerRows) ? existingLedgerRows : di3ReadTableValues_("StockLedger");
  var currentIds = {};
  currentLedgerRows.forEach(function (row) { currentIds[String(row[0])] = true; });
  var newRows = (candidateLedgerRows || []).filter(function (row) { return !currentIds[String(row[0])]; });
  var newProductIds = {};
  newRows.forEach(function (row) { if (row[3]) newProductIds[String(row[3])] = true; });
  (productIds || []).forEach(function (id) { if (id && newProductIds[String(id)]) newProductIds[String(id)] = true; });
  var stateRows = di3ReadTableValues_("FifoProductState");
  var activeAllocations = di3ReadTableValues_("StockAllocations");
  Object.keys(newProductIds).forEach(function (productId) {
    var tailRows = newRows.filter(function (row) { return String(row[3]) === productId; });
    var plan = di3BuildFifoTailPlanForProduct_(productId, tailRows, candidateDetailRows, candidateLotRows, activeAllocations, stateRows);
    if (plan.mode === "PRODUCT_REPLAY_REQUIRED") {
      di3BuildProductFifoReplayPlan_(productId, candidateLedgerRows, candidateDetailRows, candidateLotRows);
    }
  });
  return { products_checked: Object.keys(newProductIds).length, tail_movements_checked: newRows.length };
}


/** Preflight candidate events while loading only histories/projections for affected products. */
function di3PreflightFifoForProductsScoped_(candidateLedgerRows, candidateDetailRows, candidateLotRows, productIds) {
  var productSet = Object.create(null);
  (productIds || []).forEach(function (id) { if (id != null && String(id)) productSet[String(id)] = true; });
  (candidateLedgerRows || []).forEach(function (row) { if (row[3]) productSet[String(row[3])] = true; });
  var productKeys = Object.keys(productSet);
  if (!productKeys.length) return { products_checked: 0, tail_movements_checked: 0 };

  // Load the complete history only for the affected products. Preserve physical row numbers
  // because a backdated event can require deterministic product replay.
  var currentLedger = di3ReadTaggedRowsByColumnValues_("StockLedger", 3, productKeys);
  var currentMovementIds = Object.create(null);
  currentLedger.forEach(function (row) { currentMovementIds[String(row[0])] = true; });
  var currentLedgerLastRow = di3GetSheetOrThrow_("StockLedger").getLastRow();
  var newRows = [];
  (candidateLedgerRows || []).forEach(function (row, index) {
    var productId = String(row[3] || "");
    if (!productSet[productId] || currentMovementIds[String(row[0])]) return;
    var copy = row.slice();
    copy._di3RowNumber = currentLedgerLastRow + newRows.length + 1;
    newRows.push(copy);
    currentMovementIds[String(copy[0])] = true;
  });
  if (!newRows.length) return { products_checked: 0, tail_movements_checked: 0 };

  var ledgerRows = currentLedger.concat(newRows);
  var movementIds = [];
  var movementSet = Object.create(null);
  ledgerRows.forEach(function (row) {
    var id = String(row[0] || "");
    if (id && !movementSet[id]) { movementSet[id] = true; movementIds.push(id); }
  });
  var detailRows = di3ReadTaggedRowsByColumnValues_("StockMovementDetails", 0, movementIds);
  var detailIds = Object.create(null);
  detailRows.forEach(function (row) { detailIds[String(row[0])] = true; });
  var detailLastRow = di3GetSheetOrThrow_("StockMovementDetails").getLastRow();
  (candidateDetailRows || []).forEach(function (row, index) {
    var id = String(row[0] || "");
    if (!id || detailIds[id] || !movementSet[id]) return;
    var copy = row.slice();
    copy._di3RowNumber = detailLastRow + 1;
    detailRows.push(copy);
    detailIds[id] = true;
  });

  var lotRows = di3ReadTaggedRowsByColumnValues_("StockLots", 1, productKeys);
  var lotMovementIds = Object.create(null);
  lotRows.forEach(function (row) { lotMovementIds[String(row[2])] = true; });
  var lotLastRow = di3GetSheetOrThrow_("StockLots").getLastRow();
  (candidateLotRows || []).forEach(function (row, index) {
    var movementId = String(row[2] || "");
    if (!movementId || lotMovementIds[movementId] || !movementSet[movementId]) return;
    var copy = row.slice();
    copy._di3RowNumber = lotLastRow + 1;
    lotRows.push(copy);
    lotMovementIds[movementId] = true;
  });

  var stateRows = di3ReadTaggedRowsByColumnValues_("FifoProductState", 0, productKeys);
  var activeAllocations = di3ReadTaggedRowsByColumnValues_("StockAllocations", 4, productKeys);
  var productsChecked = 0;
  var tailCount = 0;
  var newProductIds = Object.create(null);
  newRows.forEach(function (row) { newProductIds[String(row[3])] = true; });
  Object.keys(newProductIds).forEach(function (productId) {
    var tailRows = newRows.filter(function (row) { return String(row[3]) === productId; });
    tailCount += tailRows.length;
    var plan = di3BuildFifoTailPlanForProduct_(productId, tailRows, detailRows, lotRows, activeAllocations, stateRows);
    if (plan.mode === "PRODUCT_REPLAY_REQUIRED") {
      di3BuildProductFifoReplayPlan_(productId, ledgerRows, detailRows, lotRows);
    }
    productsChecked++;
  });
  return { products_checked: productsChecked, tail_movements_checked: tailCount };
}


/** Preflight one candidate stock movement using only that product's history and current FIFO projection. */
function di3PreflightFifoForProductScoped_(productId, candidateLedgerRow, candidateDetailRow, candidateLotRow, existingLedgerMatch) {
  // The caller already performs an exact event_key lookup. Reuse that record and
  // avoid a product-wide Ledger scan unless a backdated/repair replay is required.
  var candidate = existingLedgerMatch ? existingLedgerMatch.values.slice() : candidateLedgerRow.slice();
  if (existingLedgerMatch) candidate._di3RowNumber = Number(existingLedgerMatch.row_number);
  else if (candidateLedgerRow._di3RowNumber) candidate._di3RowNumber = Number(candidateLedgerRow._di3RowNumber);
  else candidate._di3RowNumber = di3GetSheetOrThrow_("StockLedger").getLastRow() + 1;

  var productLots = di3ReadTaggedRowsByColumnValue_("StockLots", 1, productId);
  if (candidateLotRow) {
    var candidateLotExists = productLots.some(function (row) { return String(row[0]) === String(candidateLotRow[0]); });
    if (!candidateLotExists) {
      var newLot = candidateLotRow.slice();
      newLot._di3RowNumber = di3GetSheetOrThrow_("StockLots").getLastRow() + 1;
      productLots.push(newLot);
    }
  }
  var detailRows = di3ReadTaggedRowsByColumnValue_("StockMovementDetails", 0, candidate[0]);
  if (candidateDetailRow && !detailRows.some(function (row) { return String(row[0]) === String(candidateDetailRow[0]); })) {
    detailRows.push(candidateDetailRow.slice());
  }
  // Only allocations belonging to this movement can indicate a partial retry.
  var allocations = di3ReadTaggedRowsByColumnValue_("StockAllocations", 2, candidate[0]);
  var stateRows = di3ReadTaggedRowsByColumnValue_("FifoProductState", 0, productId);
  var tailPlan = di3BuildFifoTailPlanForProduct_(productId, [candidate], detailRows, productLots, allocations, stateRows);
  if (tailPlan.mode === "PRODUCT_REPLAY_REQUIRED") {
    var productLedgerRows = di3ReadTaggedRowsByColumnValue_("StockLedger", 3, productId);
    if (!productLedgerRows.some(function (row) { return String(row[0]) === String(candidate[0]); })) {
      productLedgerRows.push(candidate);
    }
    var movementIds = productLedgerRows.map(function (row) { return String(row[0]); });
    var allDetails = di3ReadTaggedRowsByColumnValues_("StockMovementDetails", 0, movementIds);
    if (candidateDetailRow && !allDetails.some(function (row) { return String(row[0]) === String(candidateDetailRow[0]); })) {
      allDetails.push(candidateDetailRow.slice());
    }
    di3BuildProductFifoReplayPlan_(productId, productLedgerRows, allDetails, productLots);
  }
  return { status: "READY", mode: tailPlan.mode, product_id: String(productId) };
}

function di3SetFifoLedgerSequenceCursor_(sequence) {
  sequence = Number(sequence);
  if (!Number.isSafeInteger(sequence) || sequence < 0) throw new Error("Некорректный fifo_ledger_sequence_cursor.");
  di3SetAppMetaValue_("fifo_ledger_sequence_cursor", sequence);
}

function di3BuildFifoProductStateRows_(productIds, ledgerRows, lotRows) {
  var ids = {};
  (productIds || []).forEach(function (id) { if (id) ids[String(id)] = true; });
  var aggregates = {};
  Object.keys(ids).forEach(function (id) {
    aggregates[id] = { product_id: id, last: null, last_sequence: 0, movement_count: 0, remaining: 0, unknown_remaining: false };
  });
  (ledgerRows || []).forEach(function (row) {
    var id = String(row[3] || "");
    if (!ids[id]) return;
    var sequence = Number(row[12]);
    if (!Number.isSafeInteger(sequence) || sequence <= 0) throw new Error("Невалидный ledger_sequence при построении FifoProductState для движения " + row[0] + ".");
    var event = { movement_id: String(row[0]), effective_at: row[7], recorded_at: row[8] };
    var agg = aggregates[id];
    agg.movement_count++;
    agg.last_sequence = Math.max(agg.last_sequence, sequence);
    if (!agg.last || di3FifoEventCompare_(event, agg.last) > 0) agg.last = event;
  });
  (lotRows || []).forEach(function (row) {
    var id = String(row[1] || "");
    if (!ids[id]) return;
    if (row[13] === "" || row[13] == null || !Number.isFinite(Number(row[13]))) aggregates[id].unknown_remaining = true;
    else aggregates[id].remaining += Number(row[13]);
  });
  return Object.keys(aggregates).map(function (id) {
    var agg = aggregates[id];
    return [id, agg.last ? agg.last.effective_at : "", agg.last ? agg.last.recorded_at : "",
      agg.last ? agg.last.movement_id : "", agg.last_sequence, agg.movement_count,
      agg.unknown_remaining ? "" : agg.remaining, new Date()];
  });
}

function di3BuildIncrementalFifoProductStateRow_(productId, tailLedgerRows, lotRows, previousStateRow) {
  var lastEvent = previousStateRow ? {
    movement_id: String(previousStateRow[3]), effective_at: previousStateRow[1], recorded_at: previousStateRow[2]
  } : null;
  var movementCount = previousStateRow ? Number(previousStateRow[5]) || 0 : 0;
  var lastProcessedSequence = previousStateRow ? Number(previousStateRow[4]) || 0 : 0;
  (tailLedgerRows || []).forEach(function (row) {
    var sequence = Number(row[12]);
    if (!Number.isSafeInteger(sequence) || sequence <= 0) throw new Error("Невалидный ledger_sequence при обновлении FifoProductState для движения " + row[0] + ".");
    var event = { movement_id: String(row[0]), effective_at: row[7], recorded_at: row[8] };
    movementCount++;
    lastProcessedSequence = Math.max(lastProcessedSequence, sequence);
    if (!lastEvent || di3FifoEventCompare_(event, lastEvent) > 0) lastEvent = event;
  });
  var remaining = 0, unknownRemaining = false;
  (lotRows || []).forEach(function (row) {
    if (row[13] === "" || row[13] == null || !Number.isFinite(Number(row[13]))) unknownRemaining = true;
    else remaining += Number(row[13]);
  });
  return [String(productId), lastEvent ? lastEvent.effective_at : "", lastEvent ? lastEvent.recorded_at : "",
    lastEvent ? lastEvent.movement_id : "", lastProcessedSequence, movementCount,
    unknownRemaining ? "" : remaining, new Date()];
}

function di3UpsertFifoProductStateRows_(stateRowsToWrite) {
  if (!stateRowsToWrite || !stateRowsToWrite.length) return 0;
  var productIds = stateRowsToWrite.map(function (row) { return String(row[0]); });
  var existing = di3ReadRowsByColumnValues_("FifoProductState", 0, productIds);
  var rowById = {};
  existing.forEach(function (match) { rowById[String(match.values[0])] = Number(match.row_number); });
  var sheet = di3GetSheetOrThrow_("FifoProductState");
  var append = [];
  stateRowsToWrite.forEach(function (row) {
    var rowNumber = rowById[String(row[0])];
    if (rowNumber) sheet.getRange(rowNumber, 1, 1, DI3_TABLE_SCHEMAS.FifoProductState.length).setValues([row]);
    else append.push(row);
  });
  if (append.length) di3AppendTableRows_("FifoProductState", append);
  return stateRowsToWrite.length;
}

function di3RebuildFifoAllocations_(reason, affectedProductIds, options) {
  options = options || {};
  var operationId = String(options.operation_id || "");
  var ledgerSheet = di3GetSheetOrThrow_("StockLedger");
  var ledgerCount = Math.max(0, ledgerSheet.getLastRow() - 1);
  var sequenceIndex = di3ReadLedgerSequenceIndex_();
  var maxLedgerSequence = sequenceIndex.max_sequence;
  var isFullReplay = !Array.isArray(affectedProductIds) || !affectedProductIds.length;
  var pendingOperationRun = di3GetPendingFifoRunForOperation_(operationId);
  if (pendingOperationRun) {
    if (pendingOperationRun.scope_type === "FULL") isFullReplay = true;
    else if (isFullReplay) throw new Error("Нельзя запускать отдельный full rebuild поверх незавершённого operation-backed FIFO run.");
  }
  var cursorRaw = di3GetAppMetaValue_("fifo_ledger_sequence_cursor");
  var cursor = cursorRaw == null || cursorRaw === "" ? null : Number(cursorRaw);
  var stateVersion = di3GetAppMetaValue_("fifo_state_version");
  if (!isFullReplay && (String(stateVersion) !== DI3_FIFO_STATE_VERSION ||
      !Number.isSafeInteger(cursor) || cursor < 0 || cursor > maxLedgerSequence)) isFullReplay = true;

  var ledgerRows = null, detailRows = null, lotRows = null, newLedgerRows = [];
  var productIds = [], candidateReplay = null;
  if (isFullReplay) {
    ledgerRows = di3ReadTableValues_("StockLedger");
    detailRows = di3ReadTableValues_("StockMovementDetails");
    lotRows = di3ReadTableValues_("StockLots");
    productIds = Array.from(new Set(ledgerRows.map(function (row) { return String(row[3] || ""); }).filter(Boolean)));
    candidateReplay = di3BuildFifoReplayPlan_(ledgerRows, detailRows, lotRows, null);
  } else {
    // Scan narrow identity columns, then read full rows only for sequences beyond the cursor.
    newLedgerRows = di3ReadFifoLedgerTail_(cursor, sequenceIndex);
    productIds = Array.from(new Set(newLedgerRows.map(function (row) { return String(row[3] || ""); }).filter(Boolean)));
  }

  var fingerprintLedgerRows = (isFullReplay ? ledgerRows : newLedgerRows).slice()
    .sort(function (a, b) { return Number(a[12]) - Number(b[12]); });
  var runInputFingerprint = isFullReplay
    ? di3BuildFifoReplayInputFingerprint_(null, ledgerRows, detailRows, lotRows)
    : di3BuildFifoFingerprint_({ mode: "INCREMENTAL_TAIL", ledger: fingerprintLedgerRows });
  var run = di3CreateFifoRun_(isFullReplay ? "FULL_REPLAY:" + (reason || "MANUAL") : (reason || "INCREMENTAL"),
    ledgerCount, 0, productIds.length, {
      operation_id: operationId,
      scope_type: isFullReplay ? "FULL" : "PRODUCT_SET",
      scope_json: isFullReplay ? "FULL" : JSON.stringify(productIds.slice().sort()),
      input_fingerprint: runInputFingerprint,
      full_replay: isFullReplay,
      allow_resume_empty_tail: !isFullReplay && !newLedgerRows.length
    });
  var runProductIds = productIds.slice();
  if (run.scope_type === "PRODUCT_SET" && run.scope_json) {
    try {
      var savedScope = JSON.parse(run.scope_json);
      if (Array.isArray(savedScope)) runProductIds = savedScope.map(String);
    } catch (ignoreScopeJson) {
      throw new Error("FifoAllocationRuns содержит некорректный scope_json у run " + run.run_id + ".");
    }
  }
  var created = 0, replaced = 0, replayedMovements = 0, updatedLots = 0;
  var fullReplayStateRows = null;
  try {
    var recoveredReplay = di3RecoverPendingFifoReplaysForRun_(run, reason);
    created += Number(recoveredReplay.allocations_written || 0);
    replaced += Number(recoveredReplay.allocations_removed || 0);
    updatedLots += Number(recoveredReplay.lots_updated || 0);
    replayedMovements += Number(recoveredReplay.movements_replayed || 0);
    if (isFullReplay) {
      var fullRows = di3BuildFifoAllocationRows_(run.run_id, candidateReplay.allocations, run.replay_id);
      var remaining = {};
      candidateReplay.remaining_lots.forEach(function (lot) { remaining[String(lot.lot_id)] = Number(lot.remaining_quantity); });
      lotRows.forEach(function (row) { if (!Object.prototype.hasOwnProperty.call(remaining, String(row[0]))) remaining[String(row[0])] = Number(row[8]); });
      var fullReplayContext = {
        replay_id: run.replay_id,
        fifo_run_id: String(run.run_id),
        operation_id: operationId,
        scope_type: "FULL",
        scope_json: "FULL",
        input_fingerprint: di3BuildFifoReplayInputFingerprint_(null, ledgerRows, detailRows, lotRows),
        reason: "FULL_REPLAY:" + String(reason || "MANUAL"),
        archived_at: run.created_at,
        target_rows: fullRows,
        target_remaining: remaining,
        lot_rows: lotRows
      };
      var fullReplace = di3ReplaceFifoProjectionSafely_(function () { return true; }, fullRows, lotRows, remaining, null, fullReplayContext);
      updatedLots = lotRows.filter(function (row) { return Object.prototype.hasOwnProperty.call(remaining, String(row[0])); }).length;
      created = fullRows.length;
      replaced = fullReplace.allocations_removed;
      replayedMovements = candidateReplay.movement_count;
      fullReplayStateRows = di3BuildFifoProductStateRows_(productIds, ledgerRows, lotRows.map(function (row) {
        var copy = row.slice(); copy[13] = Object.prototype.hasOwnProperty.call(remaining, String(row[0])) ? remaining[String(row[0])] : row[8];
        if (row._di3RowNumber) copy._di3RowNumber = row._di3RowNumber;
        return copy;
      }));
    } else {
      var stateRowsToWrite = [];
      productIds.forEach(function (productId) {
        var ledgerTailForProduct = newLedgerRows.filter(function (row) { return String(row[3]) === productId; });
        var productLots = di3ReadTaggedRowsByColumnValue_("StockLots", 1, productId);
        var productStateRows = di3ReadTaggedRowsByColumnValue_("FifoProductState", 0, productId);
        var productState = productStateRows.length ? productStateRows[0] : null;
        // Recovery may resume after the product state was written but before the
        // global ledger cursor. Ignore tail rows already represented by that state.
        var lastProcessedSequence = productState ? Number(productState[4]) || 0 : 0;
        var tailRows = ledgerTailForProduct.filter(function (row) { return Number(row[12]) > lastProcessedSequence; });
        if (!tailRows.length) return;
        var tailMovementIds = tailRows.map(function (row) { return String(row[0]); });
        var tailDetails = di3ReadTaggedRowsByColumnValues_("StockMovementDetails", 0, tailMovementIds);
        var productAllocations = di3ReadTaggedRowsByColumnValues_("StockAllocations", 2, tailMovementIds);
        var tailPlan = di3BuildFifoTailPlanForProduct_(productId, tailRows, tailDetails, productLots, productAllocations, productStateRows);
        var productLedgerRows = null;
        var productDetails = tailDetails;
        if (tailPlan.mode === "PRODUCT_REPLAY_REQUIRED") {
          productLedgerRows = di3ReadTaggedRowsByColumnValue_("StockLedger", 3, productId);
          productDetails = di3ReadTaggedRowsByColumnValues_("StockMovementDetails", 0,
            productLedgerRows.map(function (row) { return String(row[0]); }));
        }
        var result = di3ApplyIncrementalFifoForProduct_(productId, run.run_id, tailRows, productDetails,
          productLots, productAllocations, productStateRows, productLedgerRows, operationId, run.created_at);
        created += result.allocations_created;
        replaced += result.allocations_replaced;
        replayedMovements += result.movements_replayed;
        updatedLots += result.lots_updated;
        if (productLedgerRows) {
          stateRowsToWrite.push.apply(stateRowsToWrite,
            di3BuildFifoProductStateRows_([productId], productLedgerRows, productLots));
        } else {
          stateRowsToWrite.push(di3BuildIncrementalFifoProductStateRow_(productId, tailRows, productLots, productState));
        }
      });
      if (stateRowsToWrite.length) di3UpsertFifoProductStateRows_(stateRowsToWrite);
      if (runProductIds.length && typeof di3RefreshAllOrderFifoSnapshots_ === "function") {
        di3RefreshAllOrderFifoSnapshots_(reason || "FIFO_RECALCULATION", run.run_id, runProductIds);
      }
    }
    if (isFullReplay && typeof di3RefreshAllOrderFifoSnapshots_ === "function") {
      di3RefreshAllOrderFifoSnapshots_(reason || "FIFO_FULL_REBUILD", run.run_id, productIds);
    }
    if (fullReplayStateRows) di3UpsertFifoProductStateRows_(fullReplayStateRows);
    di3SetFifoLedgerSequenceCursor_(maxLedgerSequence);
    di3SetAppMetaValue_("fifo_state_version", DI3_FIFO_STATE_VERSION);
    di3CommitFifoReplayEventsForRun_(run.run_id);
    di3UpdateFifoRunStatus_(run.row_number, "COMMITTED", new Date(), "", created);
    return {
      run_id: run.run_id, run_sequence: run.run_sequence,
      allocations_created: created, allocations_replaced: replaced,
      movements_replayed: replayedMovements, products_replayed: productIds.length,
      lots_updated: updatedLots, mode: isFullReplay ? "FULL_REPLAY" : "INCREMENTAL_TAIL"
    };
  } catch (error) {
    try { di3UpdateFifoRunStatus_(run.row_number, "FAILED", "", error && error.stack ? error.stack : String(error), created); } catch (ignore) {}
    throw error;
  }
}

/** Ensures the incremental FIFO projection is bootstrapped. Full replay remains the verification baseline. */
function di3EnsureIncrementalFifoReady_() {
  if (!di3GetSpreadsheet_().getSheetByName("_AppMeta")) return { status: "SCHEMAS_NOT_READY" };
  var version = di3GetAppMetaValue_("fifo_state_version");
  var cursorRaw = di3GetAppMetaValue_("fifo_ledger_sequence_cursor");
  var cursor = cursorRaw === "" || cursorRaw == null ? null : Number(cursorRaw);
  var sequenceIndex = di3ReadLedgerSequenceIndex_();
  var maxLedgerSequence = sequenceIndex.max_sequence;
  if (String(version) === DI3_FIFO_STATE_VERSION && Number.isSafeInteger(cursor) &&
      cursor >= 0 && cursor <= maxLedgerSequence) {
    return { status: cursor === maxLedgerSequence ? "ALREADY_READY" : "PENDING_LEDGER_TAIL",
      cursor: cursor, max_ledger_sequence: maxLedgerSequence, ledger_rows: sequenceIndex.movement_count };
  }
  if (sequenceIndex.movement_count && typeof di3GetPendingStockOperations_ === "function") {
    var pending = di3GetPendingStockOperations_();
    if (pending.length) return { status: "PENDING_OPERATIONS", pending_operations: pending.length,
      message: "FIFO bootstrap отложен: сначала восстанови незавершённые складские операции." };
  }
  var result = sequenceIndex.movement_count
    ? di3RebuildFifoAllocations_("FIFO_INCREMENTAL_BOOTSTRAP", null)
    : { mode: "EMPTY", allocations_created: 0, movements_replayed: 0 };
  di3SetAppMetaValue_("fifo_state_version", DI3_FIFO_STATE_VERSION);
  di3SetFifoLedgerSequenceCursor_(maxLedgerSequence);
  if (!sequenceIndex.movement_count) di3UpsertFifoProductStateRows_([]);
  return { status: "READY", bootstrap: result, max_ledger_sequence: maxLedgerSequence };
}

/** Full FIFO reconstruction is mutating and therefore always requires a menu confirmation. */
function di3RunFullFifoRebuild() {
  var ui = SpreadsheetApp.getUi();
  var answer = ui.alert("Полная перестройка FIFO",
    "Это не проверка. Будет создана резервная копия, затем полностью перестроены FIFO-распределения и связанные складские проекции на основании StockLedger. Операция изменяет системные данные и может занять время. Продолжить?",
    ui.ButtonSet.YES_NO);
  if (answer !== ui.Button.YES) return { status: "CANCELLED_BY_USER", rebuilt: false };
  return di3WithLock_(function () {
    di3EnsureCoreFoundationSchemas_();
    di3AssertNoPendingStockOperations_();
    var backup = di3CreateSpreadsheetBackupInternal_("MANUAL_FULL_FIFO_REBUILD");
    var rebuild = di3RebuildFifoAllocations_("MANUAL_FULL_FIFO_REBUILD", null);
    return { status: "REBUILT", backup: backup, rebuild: rebuild };
  });
}

/** Read-only integrity check for FIFO ledger, active allocations, lot caches and per-product cursors. */
function di3GetFifoIntegrityDiagnostics_() {
  var ledgerRows = di3ReadTableValues_("StockLedger");
  var detailRows = di3ReadTableValues_("StockMovementDetails");
  var lotRows = di3ReadTableValues_("StockLots");
  var allocationRows = di3ReadTableValues_("StockAllocations");
  var stateRows = di3ReadTableValues_("FifoProductState");
  var errors = [];
  var warnings = [];
  var movementById = {};
  var detailById = {};
  var lotById = {};
  var consumedByLot = {};
  var allocatedCostMinorByLot = {};
  var movementsByProduct = {};
  var productIds = {};
  var lotRemainingByProduct = {};
  var movementCountByProduct = {};
  var latestMovementByProduct = {};
  var sequenceByValue = Object.create(null);
  var maxLedgerSequence = 0;

  ledgerRows.forEach(function (row, index) {
    var movementId = String(row[0] || "");
    var productId = String(row[3] || "");
    if (!movementId || !productId) { errors.push("StockLedger: пустой movement_id или product_id в строке " + (index + 2)); return; }
    if (movementById[movementId]) errors.push("StockLedger: повторный movement_id " + movementId + ".");
    movementById[movementId] = row;
    var sequence = Number(row[12]);
    if (!Number.isSafeInteger(sequence) || sequence <= 0) {
      errors.push("StockLedger: некорректный ledger_sequence в строке " + (index + 2) + ".");
    } else {
      if (Object.prototype.hasOwnProperty.call(sequenceByValue, String(sequence))) {
        errors.push("StockLedger: повторяется ledger_sequence " + sequence + ".");
      }
      sequenceByValue[String(sequence)] = movementId;
      maxLedgerSequence = Math.max(maxLedgerSequence, sequence);
    }
    productIds[productId] = true;
    movementCountByProduct[productId] = (movementCountByProduct[productId] || 0) + 1;
    var event = { movement_id: movementId, effective_at: row[7], recorded_at: row[8] };
    if (!latestMovementByProduct[productId]) {
      latestMovementByProduct[productId] = { event: event, max_ledger_sequence: Number.isSafeInteger(sequence) ? sequence : 0 };
    } else {
      latestMovementByProduct[productId].max_ledger_sequence = Math.max(
        latestMovementByProduct[productId].max_ledger_sequence, Number.isSafeInteger(sequence) ? sequence : 0);
      if (di3FifoEventCompare_(event, latestMovementByProduct[productId].event) > 0) {
        latestMovementByProduct[productId].event = event;
      }
    }
  });
  detailRows.forEach(function (row) { detailById[String(row[0])] = row; });
  lotRows.forEach(function (row, index) {
    var lotId = String(row[0] || "");
    var productId = String(row[1] || "");
    if (!lotId || !productId) { errors.push("StockLots: пустой lot_id или product_id в строке " + (index + 2)); return; }
    if (lotById[lotId]) errors.push("StockLots: повторный lot_id " + lotId + ".");
    lotById[lotId] = row;
    if (!lotRemainingByProduct[productId]) lotRemainingByProduct[productId] = 0;
    if (row[13] === "" || row[13] == null || !Number.isFinite(Number(row[13]))) {
      errors.push("StockLots: не заполнен remaining_quantity у партии " + lotId + ".");
    } else {
      lotRemainingByProduct[productId] += Number(row[13]);
    }
    var sourceMovement = movementById[String(row[2])];
    if (!sourceMovement || String(sourceMovement[3]) !== productId || Number(sourceMovement[6]) <= 0) {
      errors.push("StockLots: партия " + lotId + " не связана с корректным приходом StockLedger.");
    }
  });
  allocationRows.forEach(function (row) {
    var movementId = String(row[2] || "");
    var lotId = String(row[3] || "");
    var productId = String(row[4] || "");
    var movement = movementById[movementId];
    var lot = lotById[lotId];
    if (!movement) errors.push("StockAllocations: неизвестное движение " + movementId + ".");
    if (!lot) errors.push("StockAllocations: неизвестная партия " + lotId + ".");
    if (lot && String(lot[1]) !== productId) errors.push("StockAllocations: product_id не совпадает с партией " + lotId + ".");
    if (String(row[5]) !== "CONSUME") errors.push("StockAllocations: неизвестный тип распределения " + row[5] + ".");
    var quantity = Number(row[6]);
    if (!Number.isFinite(quantity) || quantity <= 0) errors.push("StockAllocations: некорректное количество для " + movementId + ".");
    consumedByLot[lotId] = (consumedByLot[lotId] || 0) + (Number.isFinite(quantity) ? quantity : 0);
    try {
      var allocationMinor = di3MoneyGetAllocationCostMinor_(row);
      if (allocationMinor != null) allocatedCostMinorByLot[lotId] = (allocatedCostMinorByLot[lotId] || 0) + allocationMinor;
    } catch (moneyAllocationError) { errors.push("StockAllocations: " + moneyAllocationError.message); }
  });
  Object.keys(lotById).forEach(function (lotId) {
    var lot = lotById[lotId];
    var expected = Number(lot[8]) - (consumedByLot[lotId] || 0);
    if (expected < -1e-8) errors.push("FIFO: расход превысил начальное количество партии " + lotId + ".");
    if (Number.isFinite(Number(lot[13])) && Math.abs(Number(lot[13]) - Math.max(0, expected)) > 1e-8) {
      errors.push("FIFO: remaining_quantity не совпадает с allocations для партии " + lotId + ".");
    }
    try {
      var totalMinor = di3MoneyGetLotTotalCostMinor_(lot);
      if (totalMinor !== null) {
        var allocatedMinor = Number(allocatedCostMinorByLot[lotId] || 0);
        var expectedAllocated = di3MoneyRoundRatioToInteger_(totalMinor, Number(lot[8]) - Math.max(0, expected), Number(lot[8]));
        if (allocatedMinor !== expectedAllocated) errors.push("Money FIFO: сумма allocated_cost_minor не совпадает с количеством потребления партии " + lotId + ".");
        if (lot.length <= 14 || lot[14] === "" || lot[14] == null) errors.push("Money FIFO: отсутствует total_cost_minor у партии " + lotId + ".");
      }
    } catch (moneyLotError) { errors.push("StockLots: " + moneyLotError.message); }
  });

  var stateByProduct = {};
  stateRows.forEach(function (row) { stateByProduct[String(row[0])] = row; });
  Object.keys(productIds).forEach(function (productId) {
    var state = stateByProduct[productId];
    if (!state) { errors.push("FifoProductState: отсутствует состояние для товара " + productId + "."); return; }
    if (Number(state[5]) !== Number(movementCountByProduct[productId] || 0)) {
      errors.push("FifoProductState: movement_count не совпадает для товара " + productId + ".");
    }
    var latest = latestMovementByProduct[productId];
    if (latest && (String(state[3]) !== String(latest.event.movement_id) || Number(state[4]) !== latest.max_ledger_sequence)) {
      errors.push("FifoProductState: курсор последнего движения не совпадает для товара " + productId + ".");
    }
    var stateRemaining = state[6] === "" || state[6] == null ? null : Number(state[6]);
    var calculatedRemaining = Number(lotRemainingByProduct[productId] || 0);
    if (stateRemaining == null || !Number.isFinite(stateRemaining) || Math.abs(stateRemaining - calculatedRemaining) > 1e-8) {
      errors.push("FifoProductState: remaining_quantity не совпадает для товара " + productId + ".");
    }
  });

  var version = di3GetAppMetaValue_("fifo_state_version");
  var cursorRaw = di3GetAppMetaValue_("fifo_ledger_sequence_cursor");
  var cursor = cursorRaw === "" || cursorRaw == null ? null : Number(cursorRaw);
  if (String(version) !== DI3_FIFO_STATE_VERSION) warnings.push("FIFO state version требует bootstrap: " + String(version || "отсутствует") + ".");
  if (cursor == null || !Number.isSafeInteger(cursor) || cursor !== maxLedgerSequence) {
    warnings.push("FIFO sequence cursor не совпадает с максимальным ledger_sequence: " + String(cursorRaw) + " / " + maxLedgerSequence + ". Следующая операция должна обработать хвост или выполнить bootstrap.");
  }
  return {
    ok: errors.length === 0,
    errors: errors,
    warnings: warnings,
    summary: {
      ledger_movements: ledgerRows.length,
      products_with_movements: Object.keys(productIds).length,
      lots: lotRows.length,
      active_allocations: allocationRows.length,
      fifo_product_states: stateRows.length,
      fifo_state_version: String(version || ""),
      fifo_ledger_sequence_cursor: cursor,
      max_ledger_sequence: maxLedgerSequence,
      money_fifo_schema_version: String(di3GetAppMetaValue_("money_fifo_schema_version") || ""),
      money_fifo_migration_status: String(di3GetAppMetaValue_("money_fifo_migration_status") || ""),
      money_fifo_ready: String(di3GetAppMetaValue_("money_fifo_schema_version") || "") === DI3_MONEY_FIFO_SCHEMA_VERSION &&
        String(di3GetAppMetaValue_("money_fifo_migration_status") || "") === "READY"
    }
  };
}


/** Menu action: read-only FIFO integrity check. Never rebuilds or writes stock projections. */
function di3RunFifoIntegrityCheck() {
  var report = di3GetFifoIntegrityDiagnostics_();
  var summary = report.summary || {};
  var lines = [
    report.ok ? "Результат: ошибок не обнаружено." : "Результат: обнаружены ошибки целостности.",
    "Движений: " + Number(summary.ledger_movements || 0),
    "FIFO-партий: " + Number(summary.lots || 0),
    "Активных распределений: " + Number(summary.active_allocations || 0),
    "Состояний товаров: " + Number(summary.fifo_product_states || 0),
    "Ошибок: " + (report.errors || []).length,
    "Предупреждений: " + (report.warnings || []).length,
    "\nДанные не изменялись. Полный отчёт записан в журнал выполнения."
  ];
  if (report.errors && report.errors.length) {
    lines.push("\nПервые ошибки:");
    report.errors.slice(0, 5).forEach(function (item) { lines.push("• " + item); });
  }
  if (report.warnings && report.warnings.length) {
    lines.push("\nПредупреждения:");
    report.warnings.slice(0, 5).forEach(function (item) { lines.push("• " + item); });
  }
  Logger.log("DI3 FIFO READ-ONLY INTEGRITY REPORT\n" + JSON.stringify(report, null, 2));
  SpreadsheetApp.getUi().alert("Проверка целостности FIFO (без изменений)", lines.join("\n"), SpreadsheetApp.getUi().ButtonSet.OK);
  return { status: report.ok ? "PASS" : "ISSUES_FOUND", mode: "READ_ONLY", errors: (report.errors || []).length,
    warnings: (report.warnings || []).length, summary: summary };
}
