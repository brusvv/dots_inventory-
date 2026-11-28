/**
 * Read-only candidate FIFO preview for a prepared SUPPLY_CORRECTION.
 *
 * The caller supplies a consistent snapshot of ledger/details/lots, including
 * any replacement receipt rows staged by the correction operation. This helper
 * filters superseded source movements and replays every affected product from
 * its complete history. It performs no Spreadsheet writes.
 */
function di3BuildSupplyCorrectionCandidateFifoReplayPlan_(
  ledgerRows, detailRows, lotRows, relationRows, operationRows, options
) {
  options = options || {};
  var operationId = String(options.include_operation_id || "");
  var effectiveMap = di3BuildSupplyCorrectionEffectiveMovementMap_(
    relationRows || [], operationRows || [], { include_operation_id: operationId }
  );
  if (!effectiveMap.relations.length) {
    throw new Error("Для candidate FIFO replay не найдены активные связи исправления.");
  }

  var ledgerByMovement = Object.create(null);
  (ledgerRows || []).forEach(function (row) {
    var id = String(row[0] || "");
    if (!id) throw new Error("StockLedger: пустой movement_id при candidate replay.");
    if (ledgerByMovement[id]) throw new Error("StockLedger: повторяется movement_id " + id + ".");
    ledgerByMovement[id] = row;
  });
  var detailByMovement = Object.create(null);
  (detailRows || []).forEach(function (row) {
    var id = String(row[0] || "");
    if (!id) throw new Error("StockMovementDetails: пустой movement_id при candidate replay.");
    if (detailByMovement[id]) throw new Error("StockMovementDetails: повторяется movement_id " + id + ".");
    detailByMovement[id] = row;
  });
  var lotByMovement = Object.create(null);
  (lotRows || []).forEach(function (row) {
    var id = String(row[2] || "");
    if (!id) throw new Error("StockLots: пустой source_movement_id при candidate replay.");
    if (lotByMovement[id]) throw new Error("StockLots: повторяется source_movement_id " + id + ".");
    lotByMovement[id] = row;
  });

  var affectedProducts = Object.create(null);
  effectiveMap.relations.forEach(function (relation) {
    if (relation.source_product_id) affectedProducts[relation.source_product_id] = true;
    if (relation.replacement_product_id) affectedProducts[relation.replacement_product_id] = true;

    function assertInboundMovement(movementId, productId, label) {
      var ledger = ledgerByMovement[movementId];
      var detail = detailByMovement[movementId];
      if (!ledger || !detail) throw new Error(label + ": движение " + movementId + " отсутствует в snapshot.");
      if (String(ledger[3]) !== String(productId) ||
          String(ledger[4]) !== "SUPPLY" || String(ledger[5]) !== String(relation.supply_id)) {
        throw new Error(label + ": движение " + movementId + " не принадлежит указанной поставке/товару.");
      }
      if (String(detail[2]) !== "IN" || !(Number(ledger[6]) > 0) ||
          ["SUPPLY_RECEIVE", "SUPPLY_CORRECTION"].indexOf(String(detail[3])) === -1 ||
          String(detail[10]) !== "SUPPLY") {
        throw new Error(label + ": движение " + movementId + " должно быть положительным приходом SUPPLY IN.");
      }
      var lot = lotByMovement[String(movementId)];
      if (!lot || String(lot[1]) !== String(productId) ||
          String(lot[3]) !== "SUPPLY" || String(lot[4]) !== String(relation.supply_id) ||
          Number(lot[8]) !== Number(ledger[6])) {
        throw new Error(label + ": FIFO lot " + movementId + " не соответствует поставке/товару/количеству.");
      }
      var movementEffective = di3ToDate_(ledger[7], "StockLedger.effective_at").getTime();
      var relationEffective = new Date(relation.effective_at).getTime();
      if (movementEffective !== relationEffective) {
        throw new Error(label + ": effective_at движения " + movementId + " не совпадает с исходной датой приёмки.");
      }
    }

    if (relation.source_movement_id) {
      assertInboundMovement(relation.source_movement_id, relation.source_product_id, "Исходное движение");
    }
    if (relation.replacement_movement_id) {
      assertInboundMovement(relation.replacement_movement_id, relation.replacement_product_id, "Заменяющее движение");
    }
  });

  var superseded = Object.create(null);
  effectiveMap.superseded_movement_ids.forEach(function (id) { superseded[id] = true; });
  var scopedLedger = (ledgerRows || []).filter(function (row) {
    return !!affectedProducts[String(row[3] || "")] && !superseded[String(row[0] || "")];
  });
  var retainedMovementIds = Object.create(null);
  scopedLedger.forEach(function (row) { retainedMovementIds[String(row[0])] = true; });
  var scopedDetails = (detailRows || []).filter(function (row) {
    return !!retainedMovementIds[String(row[0] || "")];
  });
  var scopedLots = (lotRows || []).filter(function (row) {
    return !!retainedMovementIds[String(row[2] || "")];
  });

  var replay = di3BuildFifoReplayPlan_(scopedLedger, scopedDetails, scopedLots, null);
  var fingerprint = di3BuildManualOperationPayloadHash_({
    effective_relation_fingerprint: effectiveMap.fingerprint,
    operation_id: operationId,
    ledger: scopedLedger,
    details: scopedDetails,
    lots: scopedLots
  });
  return {
    operation_id: operationId,
    affected_product_ids: Object.keys(affectedProducts).sort(),
    superseded_movement_ids: effectiveMap.superseded_movement_ids,
    active_replacement_movement_ids: effectiveMap.active_replacement_movement_ids,
    relation_fingerprint: effectiveMap.fingerprint,
    input_fingerprint: fingerprint,
    replay: replay
  };
}
