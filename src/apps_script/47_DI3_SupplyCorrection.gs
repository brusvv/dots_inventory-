/**
 * Dots Inventory v4 — read-only source audit for a received-supply correction.
 *
 * SC-01 only: this module verifies the immutable receipt-to-ledger/detail/lot
 * mapping. It does not register an operation, create schemas, write rows or
 * rebuild FIFO. The correction workflow remains disabled until later phases
 * and disposable-workbook runtime acceptance are complete.
 */

/** Compare persisted date-like values without depending on display formatting. */
function di3SupplyCorrectionSameInstant_(left, right, fieldName) {
  var leftDate = left instanceof Date ? new Date(left.getTime()) : new Date(left);
  var rightDate = right instanceof Date ? new Date(right.getTime()) : new Date(right);
  if (isNaN(leftDate.getTime()) || isNaN(rightDate.getTime()) ||
      leftDate.getTime() !== rightDate.getTime()) {
    throw new Error(fieldName + ": дата/время не совпадает с исходным payload приёмки.");
  }
  return true;
}

function di3SupplyCorrectionNearlyEqual_(left, right, fieldName) {
  var a = Number(left), b = Number(right);
  if (!Number.isFinite(a) || !Number.isFinite(b) || Math.abs(a - b) > 1e-9) {
    throw new Error(fieldName + ": значение не совпадает с исходным payload приёмки.");
  }
  return true;
}

/**
 * Pure validator for the exact original receipt mapping.
 * Inputs are arrays of {row_number, values} returned by read-only repository
 * helpers. Ledger rows must already be scoped to the original receipt operation.
 */
function di3BuildSupplyCorrectionSourceMap_(receiptOperation, receiptPayload, ledgerMatches, detailMatches, lotMatches, currentItems, allocationMatches) {
  if (!receiptOperation || !receiptOperation.values) throw new Error("Не найдена исходная операция приёмки.");
  var operation = receiptOperation.values;
  var operationId = String(operation[0] || "");
  var supplyId = String(receiptPayload && receiptPayload.supply_id || "");
  if (!operationId || !supplyId) throw new Error("В исходной операции или payload отсутствует operation_id/supply_id.");
  if (String(operation[2]) !== "SUPPLY_RECEIVE" ||
      String(operation[3]) !== "SUPPLY" ||
      String(operation[4]) !== supplyId ||
      String(operation[1]) !== "SUPPLY_RECEIVE:" + supplyId) {
    throw new Error("Исходная операция не соответствует SUPPLY_RECEIVE для этой поставки.");
  }
  if (String(operation[5]) !== "COMMITTED") {
    throw new Error("Исходная приёмка не имеет статус COMMITTED.");
  }
  if (!Array.isArray(receiptPayload.lines) || !receiptPayload.lines.length) {
    throw new Error("В исходном payload приёмки отсутствуют товарные строки.");
  }

  var lines = receiptPayload.lines;
  if (!Array.isArray(currentItems)) throw new Error("Не переданы текущие строки V3_SupplyItems для сверки с receipt payload.");
  var currentItemById = Object.create(null);
  currentItems.forEach(function (item) {
    var itemId = String(item && item.supply_item_id || "");
    if (!itemId || currentItemById[itemId]) throw new Error("В V3_SupplyItems отсутствует или повторяется supply_item_id " + itemId + ".");
    if (String(item.supply_id || "") !== supplyId) throw new Error("Строка V3_SupplyItems принадлежит другой поставке.");
    currentItemById[itemId] = item;
  });
  if (currentItems.length !== lines.length) {
    throw new Error("Количество текущих строк V3_SupplyItems не совпадает с исходным receipt payload.");
  }

  var expectedItemIds = Object.create(null);
  var expectedMovementIds = Object.create(null);
  var expectedLotIds = Object.create(null);
  var expectedEventKeys = Object.create(null);
  var ledgerByMovement = Object.create(null);
  var detailByMovement = Object.create(null);
  var lotByMovement = Object.create(null);

  function addUnique(index, key, label) {
    key = String(key || "");
    if (!key) throw new Error(label + ": пустой идентификатор.");
    if (Object.prototype.hasOwnProperty.call(index, key)) throw new Error(label + ": повторяется идентификатор " + key + ".");
    index[key] = true;
    return key;
  }
  function indexMatches(matches, columnIndex, expectedIndex, label) {
    var indexed = Object.create(null);
    (matches || []).forEach(function (match) {
      var row = match && match.values;
      if (!row) throw new Error(label + ": некорректная запись репозитория.");
      var key = String(row[columnIndex] || "");
      if (!key) throw new Error(label + ": найдено пустое значение ключа.");
      if (!expectedIndex[key]) return;
      if (!indexed[key]) indexed[key] = [];
      indexed[key].push(match);
    });
    return indexed;
  }

  lines.forEach(function (line, lineIndex) {
    var prefix = "Позиция " + (lineIndex + 1);
    addUnique(expectedItemIds, line.supply_item_id, prefix + " supply_item_id");
    addUnique(expectedMovementIds, line.movement_id, prefix + " movement_id");
    addUnique(expectedLotIds, line.lot_id, prefix + " lot_id");
    addUnique(expectedEventKeys, line.event_key, prefix + " event_key");
    if (!line.product_id || !line.pack_variant_id) throw new Error(prefix + ": отсутствует product_id или pack_variant_id.");
    var quantity = Number(line.quantity);
    if (!Number.isSafeInteger(quantity) || quantity <= 0) throw new Error(prefix + ": некорректное количество в payload.");
    var units = Number(line.units_per_pack);
    if (!Number.isSafeInteger(units) || units <= 0 || quantity % units !== 0) {
      throw new Error(prefix + ": quantity не делится на units_per_pack без остатка.");
    }
    di3SupplyCorrectionSameInstant_(line.effective_at, receiptPayload.received_at, prefix + " effective_at");
    di3SupplyCorrectionSameInstant_(line.recorded_at, receiptPayload.recorded_at, prefix + " recorded_at");
    if (!Number.isFinite(Number(line.unit_cost)) || Number(line.unit_cost) < 0) {
      throw new Error(prefix + ": некорректная unit_cost в payload.");
    }
    if (["KNOWN", "FREE"].indexOf(String(line.cost_status)) === -1) {
      throw new Error(prefix + ": недопустимый cost_status в исходном payload.");
    }
    if (Number(line.total_cost_minor) < 0 || !Number.isSafeInteger(Number(line.total_cost_minor))) {
      throw new Error(prefix + ": некорректная полная себестоимость в копейках.");
    }
  });

  var ledgerByMovement = indexMatches(ledgerMatches, 0, expectedMovementIds, "StockLedger");
  var detailByMovement = indexMatches(detailMatches, 0, expectedMovementIds, "StockMovementDetails");
  var lotByMovement = indexMatches(lotMatches, 2, expectedMovementIds, "StockLots");

  function exactlyOne(index, key, label) {
    var matches = index[String(key)] || [];
    if (matches.length !== 1) {
      throw new Error(label + " " + key + ": ожидалась ровно одна запись, найдено " + matches.length + ".");
    }
    return matches[0];
  }

  var ledgerByEventKey = Object.create(null);
  (ledgerMatches || []).forEach(function (match) {
    var row = match.values;
    var movementId = String(row[0] || "");
    if (!expectedMovementIds[movementId]) {
      throw new Error("В исходной операции найдены лишние складские движения: " + movementId + ".");
    }
    if (String(row[1]) !== operationId) throw new Error("Движение " + movementId + " связано с другой операцией.");
    var eventKey = String(row[2] || "");
    if (ledgerByEventKey[eventKey]) throw new Error("Повторяется event_key исходной приёмки: " + eventKey + ".");
    ledgerByEventKey[eventKey] = row;
  });
  if ((ledgerMatches || []).length !== lines.length) {
    throw new Error("Количество движений исходной операции не совпадает с количеством строк receipt payload.");
  }
  if ((detailMatches || []).length !== lines.length) {
    throw new Error("Количество деталей движений не совпадает с количеством строк receipt payload.");
  }
  if ((lotMatches || []).length !== lines.length) {
    throw new Error("Количество FIFO-партий не совпадает с количеством строк receipt payload.");
  }

  var sourceLines = lines.map(function (line, lineIndex) {
    var movementId = String(line.movement_id);
    var prefix = "Позиция " + (lineIndex + 1) + " (" + movementId + ")";
    var ledgerMatch = exactlyOne(ledgerByMovement, movementId, "Движение");
    var detailMatch = exactlyOne(detailByMovement, movementId, "Детали движения");
    var lotMatch = exactlyOne(lotByMovement, movementId, "FIFO-партия");
    var ledger = ledgerMatch.values;
    var detail = detailMatch.values;
    var lot = lotMatch.values;
    var quantity = Number(line.quantity);
    var currentItem = currentItemById[String(line.supply_item_id)];
    if (!currentItem) throw new Error(prefix + ": исходная строка отсутствует в V3_SupplyItems.");
    if (String(currentItem.product_id) !== String(line.product_id) ||
        String(currentItem.pack_variant_id) !== String(line.pack_variant_id) ||
        Number(currentItem.units_per_pack) !== Number(line.units_per_pack) ||
        Number(currentItem.received_units) !== quantity ||
        Number(currentItem.packs) * Number(currentItem.units_per_pack) !== quantity) {
      throw new Error(prefix + ": V3_SupplyItems product/variant/quantity отличается от исходного receipt payload.");
    }
    di3SupplyCorrectionNearlyEqual_(currentItem.unit_cost, line.unit_cost, prefix + " V3_SupplyItems.unit_cost");
    di3SupplyCorrectionNearlyEqual_(currentItem.final_pack_cost, line.cost_per_pack, prefix + " V3_SupplyItems.final_pack_cost");
    var itemTotalMinor = di3MoneyToMinorUnits_(Number(currentItem.final_line_amount), prefix + " V3_SupplyItems.final_line_amount", false);
    if (itemTotalMinor !== Number(line.total_cost_minor)) {
      throw new Error(prefix + ": V3_SupplyItems.final_line_amount не совпадает с исходным receipt payload.");
    }

    if (String(ledger[2]) !== String(line.event_key) || String(ledger[3]) !== String(line.product_id) ||
        String(ledger[4]) !== "SUPPLY" || String(ledger[5]) !== supplyId ||
        Number(ledger[6]) !== quantity || Number(ledger[6]) <= 0) {
      throw new Error(prefix + ": StockLedger не совпадает с исходным receipt payload.");
    }
    if (!ledgerByEventKey[String(line.event_key)]) throw new Error(prefix + ": event_key отсутствует в StockLedger.");
    di3SupplyCorrectionSameInstant_(ledger[7], line.effective_at, prefix + " StockLedger.effective_at");
    di3SupplyCorrectionSameInstant_(ledger[8], line.recorded_at, prefix + " StockLedger.recorded_at");
    if (!Number.isSafeInteger(Number(ledger[12])) || Number(ledger[12]) <= 0) {
      throw new Error(prefix + ": отсутствует корректный ledger_sequence.");
    }

    if (String(detail[2]) !== "IN" || String(detail[3]) !== "SUPPLY_RECEIVE" ||
        String(detail[6]) !== String(line.cost_status) || String(detail[10]) !== "SUPPLY") {
      throw new Error(prefix + ": StockMovementDetails не совпадает с исходной приёмкой.");
    }

    if (String(lot[0]) !== String(line.lot_id) || String(lot[1]) !== String(line.product_id) ||
        String(lot[2]) !== movementId || String(lot[3]) !== "SUPPLY" ||
        String(lot[4]) !== supplyId || String(lot[5]) !== String(line.pack_variant_id) ||
        Number(lot[8]) !== quantity || String(lot[10]) !== String(line.cost_status)) {
      throw new Error(prefix + ": StockLots не совпадает с исходным receipt payload.");
    }
    di3SupplyCorrectionSameInstant_(lot[6], line.effective_at, prefix + " StockLots.effective_at");
    di3SupplyCorrectionSameInstant_(lot[7], line.recorded_at, prefix + " StockLots.recorded_at");
    di3SupplyCorrectionNearlyEqual_(lot[9], line.unit_cost, prefix + " StockLots.unit_cost");
    if (Number(lot[14]) !== Number(line.total_cost_minor)) {
      throw new Error(prefix + ": StockLots.total_cost_minor не совпадает с исходным payload.");
    }

    return {
      supply_item_id: String(line.supply_item_id),
      movement_id: movementId,
      lot_id: String(line.lot_id),
      event_key: String(line.event_key),
      product_id: String(line.product_id),
      pack_variant_id: String(line.pack_variant_id),
      quantity: quantity,
      initial_quantity: Number(lot[8]),
      remaining_quantity: lot[13],
      unit_cost: Number(line.unit_cost),
      total_cost_minor: Number(line.total_cost_minor),
      effective_at: new Date(line.effective_at).toISOString(),
      recorded_at: new Date(line.recorded_at).toISOString(),
      ledger_sequence: Number(ledger[12]),
      ledger_row_number: Number(ledgerMatch.row_number || 0),
      detail_row_number: Number(detailMatch.row_number || 0),
      lot_row_number: Number(lotMatch.row_number || 0)
    };
  });

  var affectedProducts = Object.keys(sourceLines.reduce(function (set, line) {
    set[line.product_id] = true;
    return set;
  }, Object.create(null))).sort();
  var allocationAudit = di3BuildSupplyCorrectionAllocationAudit_(sourceLines, allocationMatches || []);
  var fingerprint = di3SupplyFullEditHash_({
    operation_id: operationId,
    operation_payload_hash: String(operation[6] || ""),
    supply_id: supplyId,
    lines: sourceLines,
    fifo_allocations: allocationAudit.allocations
  });
  return {
    status: "VALID",
    supply_id: supplyId,
    receipt_operation_id: operationId,
    receipt_payload_hash: String(operation[6] || ""),
    source_lines: sourceLines,
    affected_product_ids: affectedProducts,
    fifo_allocation_count: allocationAudit.allocation_count,
    fifo_allocation_fingerprint: allocationAudit.fingerprint,
    fingerprint: fingerprint
  };
}

/**
 * Validate the active allocation projection for the original receipt lots.
 * StockAllocations is a current projection: its per-lot CONSUME total must
 * reconcile exactly to StockLots.remaining_quantity.
 */
function di3BuildSupplyCorrectionAllocationAudit_(sourceLines, allocationMatches) {
  var lotsById = Object.create(null);
  var allocationIds = Object.create(null);
  var consumedByLot = Object.create(null);
  var costMinorByLot = Object.create(null);
  var allocationCountByLot = Object.create(null);
  (sourceLines || []).forEach(function (line) {
    lotsById[String(line.lot_id)] = line;
    consumedByLot[String(line.lot_id)] = 0;
    costMinorByLot[String(line.lot_id)] = 0;
    allocationCountByLot[String(line.lot_id)] = 0;
    if (line.remaining_quantity === "" || line.remaining_quantity == null ||
        !Number.isSafeInteger(Number(line.initial_quantity)) ||
        !Number.isSafeInteger(Number(line.remaining_quantity)) ||
        Number(line.remaining_quantity) < 0 ||
        Number(line.remaining_quantity) > Number(line.initial_quantity)) {
      throw new Error("FIFO-партия " + line.lot_id + ": отсутствует или некорректен remaining_quantity.");
    }
  });
  (allocationMatches || []).forEach(function (match) {
    var row = match && match.values;
    if (!row) throw new Error("StockAllocations: некорректная запись репозитория.");
    var allocationId = String(row[0] || "");
    var lotId = String(row[3] || "");
    var line = lotsById[lotId];
    if (!allocationId || allocationIds[allocationId]) {
      throw new Error("StockAllocations: отсутствует или повторяется allocation_id " + allocationId + ".");
    }
    allocationIds[allocationId] = true;
    if (!line) throw new Error("StockAllocations содержит распределение по неизвестной партии " + lotId + ".");
    var quantity = Number(row[6]);
    if (String(row[4]) !== String(line.product_id) ||
        String(row[5]) !== "CONSUME" ||
        !Number.isSafeInteger(quantity) || quantity <= 0 ||
        String(row[8]) !== String(line.cost_status)) {
      throw new Error("StockAllocations " + allocationId + ": товар, тип, количество или cost_status не согласованы с партией.");
    }
    if (line.cost_status === "UNKNOWN") {
      if (row[13] !== "" && row[13] != null) throw new Error("StockAllocations " + allocationId + ": у UNKNOWN не должно быть allocated_cost_minor.");
    } else {
      di3SupplyCorrectionNearlyEqual_(row[7], line.unit_cost, "StockAllocations " + allocationId + ".unit_cost");
      var allocatedMinor = Number(row[13]);
      if (!Number.isSafeInteger(allocatedMinor) || allocatedMinor < 0) {
        throw new Error("StockAllocations " + allocationId + ": некорректный allocated_cost_minor.");
      }
      costMinorByLot[lotId] += allocatedMinor;
    }
    consumedByLot[lotId] += quantity;
    allocationCountByLot[lotId]++;
  });

  Object.keys(lotsById).forEach(function (lotId) {
    var line = lotsById[lotId];
    var consumed = consumedByLot[lotId];
    var remaining = Number(line.remaining_quantity);
    if (consumed + remaining !== Number(line.initial_quantity)) {
      throw new Error("FIFO-партия " + lotId + ": сумма CONSUME и remaining_quantity не совпадает с initial_quantity.");
    }
    if (line.cost_status !== "UNKNOWN") {
      var expectedAllocatedMinor = di3MoneyAllocateLotCostMinor_(
        Number(line.total_cost_minor), Number(line.initial_quantity), 0, consumed);
      if (costMinorByLot[lotId] !== expectedAllocatedMinor) {
        throw new Error("FIFO-партия " + lotId + ": сумма allocated_cost_minor не совпадает с накопленной себестоимостью.");
      }
    }
    line.consumed_quantity = consumed;
    line.allocation_count = allocationCountByLot[lotId];
  });
  var stableAllocationRows = (allocationMatches || []).map(function (match) {
    return match.values.slice(0, 14);
  }).sort(function (a, b) { return String(a[0]).localeCompare(String(b[0])); });
  return {
    allocation_count: stableAllocationRows.length,
    allocations: stableAllocationRows,
    fingerprint: di3SupplyFullEditHash_(stableAllocationRows)
  };
}

/** Read-only SC-01 audit entry point. It deliberately avoids all schema/setup helpers. */
function di3AuditSupplyCorrectionSource(supplyId) {
  var id = String(supplyId || "").trim();
  try {
    if (!id) throw new Error("Не указан supply_id.");
    var supply = di3GetSupplyById_(id);
    if (!supply) throw new Error("Поставка не найдена.");
    if (di3NormalizeSupplyStatus_(supply.status) !== DI3_SUPPLY_STATUS.RECEIVED) {
      throw new Error("Корректировать можно только поставку со статусом «Получена».");
    }
    var operationMatch = di3GetSupplyReceiptOperation_(id);
    if (!operationMatch) throw new Error("Не найдена исходная операция SUPPLY_RECEIVE.");
    var operationId = String(operationMatch.values[0] || "");
    var payloadMatch = di3FindRowByFirstColumn_("OperationPayloads", operationId);
    if (!payloadMatch) throw new Error("Не найден immutable payload исходной приёмки.");
    var payload;
    try { payload = JSON.parse(String(payloadMatch.values[1] || "")); }
    catch (parseError) { throw new Error("Payload исходной приёмки содержит некорректный JSON."); }
    var actualHash = di3BuildOperationPayloadHash_("SUPPLY_RECEIVE", payload);
    if (actualHash !== String(operationMatch.values[6] || "")) {
      throw new Error("Хэш исходного payload приёмки не совпадает с Operations.");
    }
    if (String(payload.supply_id || "") !== id) throw new Error("supply_id в payload не совпадает с выбранной поставкой.");
    var currentItems = di3GetSupplyItems_(id);
    di3SupplyCorrectionSameInstant_(supply.received_at, payload.received_at, "V3_Supplies.received_at");
    if (String(supply.supply_number || "") !== String(payload.supply_number || "")) {
      throw new Error("Номер поставки в V3_Supplies не совпадает с исходным receipt payload.");
    }
    var movementIds = (payload.lines || []).map(function (line) { return String(line && line.movement_id || ""); }).filter(Boolean);
    var ledgerMatches = di3ReadRowsByColumnValue_("StockLedger", 5, id).filter(function (match) {
      return String(match.values[1]) === operationId;
    });
    var detailMatches = movementIds.length ? di3ReadRowsByColumnValues_("StockMovementDetails", 0, movementIds) : [];
    var lotMatches = movementIds.length ? di3ReadRowsByColumnValues_("StockLots", 2, movementIds) : [];
    var lotIds = (payload.lines || []).map(function (line) { return String(line && line.lot_id || ""); }).filter(Boolean);
    var allocationMatches = lotIds.length ? di3ReadRowsByColumnValues_("StockAllocations", 3, lotIds) : [];
    var source = di3BuildSupplyCorrectionSourceMap_(operationMatch, payload, ledgerMatches, detailMatches, lotMatches, currentItems, allocationMatches);
    return {
      status: "READY",
      read_only: true,
      supply_id: id,
      supply_number: String(supply.supply_number || ""),
      receipt_operation_status: String(operationMatch.values[5]),
      receipt_payload_hash: String(operationMatch.values[6]),
      source_map: source,
      source_counts: {
        receipt_lines: source.source_lines.length,
        ledger_movements: ledgerMatches.length,
        movement_details: detailMatches.length,
        fifo_lots: lotMatches.length,
        fifo_allocations: allocationMatches.length
      }
    };
  } catch (error) {
    return {
      status: "BLOCKED",
      read_only: true,
      supply_id: id,
      reason: error && error.message ? error.message : String(error)
    };
  }
}
