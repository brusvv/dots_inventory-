/**
 * Dots Inventory v3 — correction-aware immutable FIFO input snapshot.
 *
 * Applies only committed correction relations (or the exact pending operation
 * explicitly supplied by a recovery/candidate caller) to a read-only snapshot.
 * Original StockLedger, StockMovementDetails and StockLots rows are never edited.
 */
function di3BuildSupplyCorrectionEffectiveFifoSnapshot_(ledgerRows, detailRows, lotRows, effectiveMap) {
  effectiveMap = effectiveMap || di3BuildSupplyCorrectionEffectiveMovementMap_([], [], {});
  var ledgerByMovement = Object.create(null);
  (ledgerRows || []).forEach(function (row) {
    var id = String(row[0] || "");
    if (!id) throw new Error("StockLedger: пустой movement_id при построении effective FIFO snapshot.");
    if (ledgerByMovement[id]) throw new Error("StockLedger: повторяется movement_id " + id + ".");
    ledgerByMovement[id] = row;
  });
  var detailByMovement = Object.create(null);
  (detailRows || []).forEach(function (row) {
    var id = String(row[0] || "");
    if (!id) throw new Error("StockMovementDetails: пустой movement_id при построении effective FIFO snapshot.");
    if (detailByMovement[id]) throw new Error("StockMovementDetails: повторяется movement_id " + id + ".");
    detailByMovement[id] = row;
  });
  var lotByMovement = Object.create(null);
  (lotRows || []).forEach(function (row) {
    var id = String(row[2] || "");
    if (!id) throw new Error("StockLots: пустой source_movement_id при построении effective FIFO snapshot.");
    if (lotByMovement[id]) throw new Error("StockLots: повторяется source_movement_id " + id + ".");
    lotByMovement[id] = row;
  });

  var affectedProducts = Object.create(null);
  (effectiveMap.relations || []).forEach(function (relation) {
    if (relation.source_product_id) affectedProducts[String(relation.source_product_id)] = true;
    if (relation.replacement_product_id) affectedProducts[String(relation.replacement_product_id)] = true;

    function assertInbound(movementId, productId, role) {
      var ledger = ledgerByMovement[String(movementId)];
      var detail = detailByMovement[String(movementId)];
      if (!ledger || !detail) throw new Error("SupplyCorrectionEvents: " + role + " movement " + movementId + " отсутствует в FIFO snapshot.");
      if (String(ledger[3]) !== String(productId) ||
          String(ledger[4]) !== "SUPPLY" || String(ledger[5]) !== String(relation.supply_id)) {
        throw new Error("SupplyCorrectionEvents: " + role + " movement " + movementId + " не принадлежит указанной поставке/товару.");
      }
      if (String(detail[2]) !== "IN" || !(Number(ledger[6]) > 0) ||
          ["SUPPLY_RECEIVE", "SUPPLY_CORRECTION"].indexOf(String(detail[3])) === -1 ||
          String(detail[10]) !== "SUPPLY") {
        throw new Error("SupplyCorrectionEvents: " + role + " movement " + movementId + " должен быть положительным приходом SUPPLY IN.");
      }
      var lot = lotByMovement[String(movementId)];
      if (!lot || String(lot[1]) !== String(productId) ||
          String(lot[3]) !== "SUPPLY" || String(lot[4]) !== String(relation.supply_id) ||
          Number(lot[8]) !== Number(ledger[6])) {
        throw new Error("SupplyCorrectionEvents: FIFO lot " + movementId + " не соответствует поставке/товару/количеству.");
      }
      var movementAt = di3ToDate_(ledger[7], "StockLedger.effective_at").getTime();
      var relationAt = new Date(relation.effective_at).getTime();
      if (new Date(lot[6]).getTime() !== movementAt || new Date(lot[7]).getTime() !== new Date(ledger[8]).getTime()) {
        throw new Error("SupplyCorrectionEvents: effective/recorded timestamps FIFO lot " + movementId + " не совпадают с StockLedger.");
      }
      if (relation.source_movement_id && relation.replacement_movement_id) {
        var sourceLedger = ledgerByMovement[String(relation.source_movement_id)];
        if (!sourceLedger || new Date(sourceLedger[8]).getTime() !== new Date(ledger[8]).getTime()) {
          throw new Error("SupplyCorrectionEvents: replacement recorded_at должен совпадать с исходным receipt recorded_at.");
        }
      }
      if (movementAt !== relationAt) {
        throw new Error("SupplyCorrectionEvents: effective_at " + role + " movement " + movementId + " не совпадает с исходной датой приёмки.");
      }
    }

    if (relation.source_movement_id) {
      assertInbound(relation.source_movement_id, relation.source_product_id, "source");
    }
    if (relation.replacement_movement_id) {
      assertInbound(relation.replacement_movement_id, relation.replacement_product_id, "replacement");
    }
  });

  var superseded = Object.create(null);
  (effectiveMap.superseded_movement_ids || []).forEach(function (id) { superseded[String(id)] = true; });
  var effectiveLedger = (ledgerRows || []).filter(function (row) {
    return !superseded[String(row[0] || "")];
  });
  var retained = Object.create(null);
  effectiveLedger.forEach(function (row) { retained[String(row[0])] = true; });
  var effectiveDetails = (detailRows || []).filter(function (row) {
    return !!retained[String(row[0] || "")];
  });
  var allLots = [];
  (lotRows || []).forEach(function (row, index) {
    var copy = row.slice();
    // Keep physical row identity for F-06 source archival and cache updates.
    copy._di3RowNumber = Number(row._di3RowNumber || index + 2);
    var movementId = String(copy[2] || "");
    if (!ledgerByMovement[movementId]) {
      throw new Error("StockLots: партия " + String(copy[0]) + " ссылается на отсутствующее StockLedger движение " + movementId + ".");
    }
    if (String(copy[1]) !== String(ledgerByMovement[movementId][3])) {
      throw new Error("StockLots: product_id партии " + String(copy[0]) + " не совпадает с StockLedger.");
    }
    allLots.push(copy);
  });
  var effectiveLots = allLots.filter(function (row) {
    return !!retained[String(row[2] || "")];
  });

  // Fail closed if any effective inbound ledger row has no corresponding lot;
  // the FIFO planner performs the same check, but this makes the snapshot
  // contract explicit before it is passed to other projection builders.
  var lotMovementIds = Object.create(null);
  effectiveLots.forEach(function (row) {
    var movementId = String(row[2] || "");
    if (!movementId) throw new Error("StockLots: партия без source_movement_id в effective FIFO snapshot.");
    if (lotMovementIds[movementId]) throw new Error("StockLots: несколько партий ссылаются на движение " + movementId + ".");
    lotMovementIds[movementId] = true;
  });
  effectiveLedger.forEach(function (row) {
    var movementId = String(row[0] || "");
    var detail = detailByMovement[movementId];
    if (detail && String(detail[2]) === "IN" && !lotMovementIds[movementId]) {
      throw new Error("Для эффективного прихода " + movementId + " отсутствует StockLots.");
    }
  });

  return {
    ledger_rows: effectiveLedger,
    detail_rows: effectiveDetails,
    lot_rows: effectiveLots,
    // All source lot rows are returned separately: F-06 must archive their
    // pre-correction remaining cache, including lots superseded by REMOVE or REPLACE.
    all_lot_rows: allLots,
    affected_product_ids: Object.keys(affectedProducts).sort(),
    superseded_movement_ids: (effectiveMap.superseded_movement_ids || []).slice(),
    active_replacement_movement_ids: (effectiveMap.active_replacement_movement_ids || []).slice(),
    relation_fingerprint: String(effectiveMap.fingerprint || "")
  };
}

/** Read only Operations rows referenced by correction relation events. */
function di3ReadSupplyCorrectionOperationRows_(relationRows) {
  var relationHeaders = DI3_TABLE_SCHEMAS.SupplyCorrectionEvents || [];
  var operationHeaders = DI3_TABLE_SCHEMAS.Operations || [];
  var relationOperationIndex = relationHeaders.indexOf("operation_id");
  var operationIdIndex = operationHeaders.indexOf("operation_id");
  if (relationOperationIndex < 0 || operationIdIndex < 0) {
    throw new Error("Supply correction operation lookup requires operation_id schema columns.");
  }
  var ids = Object.create(null);
  (relationRows || []).forEach(function (row) {
    var id = String(row[relationOperationIndex] || "");
    if (id) ids[id] = true;
  });
  var keys = Object.keys(ids);
  return keys.length
    ? di3ReadRowsByColumnValues_("Operations", operationIdIndex, keys).map(function (match) { return match.values; })
    : [];
}

/** Read the committed relation map used by ordinary FIFO projection rebuilds. */
function di3ReadSupplyCorrectionEffectiveMovementMap_(includeOperationId) {
  var spreadsheet = di3GetSpreadsheet_();
  var relationRows = spreadsheet && spreadsheet.getSheetByName("SupplyCorrectionEvents")
    ? di3ReadTableValues_("SupplyCorrectionEvents") : [];
  var operationRows = relationRows.length
    ? di3ReadSupplyCorrectionOperationRows_(relationRows) : [];
  return di3BuildSupplyCorrectionEffectiveMovementMap_(relationRows, operationRows, {
    include_operation_id: String(includeOperationId || "")
  });
}

/**
 * Prevent read models from combining a newly committed correction map with
 * stale FIFO allocations. Empty relation maps remain backward compatible for
 * existing workbooks until their next normal FIFO rebuild.
 */
function di3AssertSupplyCorrectionFifoProjectionCurrent_(effectiveMap) {
  var map = effectiveMap || di3ReadSupplyCorrectionEffectiveMovementMap_();
  if (!(map.relations || []).length) return true;
  var stored = String(di3GetAppMetaValue_("fifo_supply_correction_fingerprint") || "");
  if (stored !== String(map.fingerprint || "")) {
    throw new Error("FIFO-проекция ещё не пересчитана после исправления поставки. Чтение складской оценки и журнала временно заблокировано; выполни штатную полную перестройку FIFO и повтори запрос.");
  }
  return true;
}

/** Build the F-06 target cache: effective lots use replay balances; superseded lots become zero. */
function di3BuildSupplyCorrectionTargetLotRemainingMap_(candidateRemainingLots, allLotRows, supersededMovementIds) {
  var remaining = Object.create(null);
  (candidateRemainingLots || []).forEach(function (lot) {
    var id = String(lot.lot_id || "");
    var quantity = Number(lot.remaining_quantity);
    if (!id || !Number.isSafeInteger(quantity) || quantity < 0) {
      throw new Error("Candidate FIFO contains an invalid remaining lot.");
    }
    if (Object.prototype.hasOwnProperty.call(remaining, id)) {
      throw new Error("Candidate FIFO repeats lot_id " + id + ".");
    }
    remaining[id] = quantity;
  });
  var superseded = Object.create(null);
  (supersededMovementIds || []).forEach(function (id) { superseded[String(id)] = true; });
  (allLotRows || []).forEach(function (row) {
    var lotId = String(row[0] || ""), movementId = String(row[2] || "");
    if (!lotId || !movementId) throw new Error("StockLots contains an empty lot_id/source_movement_id.");
    if (Object.prototype.hasOwnProperty.call(remaining, lotId)) return;
    if (superseded[movementId]) {
      // F-06 archives the pre-correction cache before this target is written.
      remaining[lotId] = 0;
      return;
    }
    throw new Error("Effective StockLots row " + lotId + " is missing from candidate FIFO replay.");
  });
  return remaining;
}
