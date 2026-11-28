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

  var affectedProducts = Object.create(null);
  (effectiveMap.relations || []).forEach(function (relation) {
    if (relation.source_product_id) affectedProducts[String(relation.source_product_id)] = true;
    if (relation.replacement_product_id) affectedProducts[String(relation.replacement_product_id)] = true;

    function assertInbound(movementId, productId, role) {
      var ledger = ledgerByMovement[String(movementId)];
      var detail = detailByMovement[String(movementId)];
      if (!ledger || !detail) throw new Error("SupplyCorrectionEvents: " + role + " movement " + movementId + " отсутствует в FIFO snapshot.");
      if (String(ledger[3]) !== String(productId)) {
        throw new Error("SupplyCorrectionEvents: product_id " + role + " movement " + movementId + " не совпадает с relation journal.");
      }
      if (String(detail[2]) !== "IN" || !(Number(ledger[6]) > 0)) {
        throw new Error("SupplyCorrectionEvents: " + role + " movement " + movementId + " должен быть положительным приходом IN.");
      }
      var movementAt = di3ToDate_(ledger[7], "StockLedger.effective_at").getTime();
      var relationAt = new Date(relation.effective_at).getTime();
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
  var effectiveLots = (lotRows || []).filter(function (row) {
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
    affected_product_ids: Object.keys(affectedProducts).sort(),
    superseded_movement_ids: (effectiveMap.superseded_movement_ids || []).slice(),
    active_replacement_movement_ids: (effectiveMap.active_replacement_movement_ids || []).slice(),
    relation_fingerprint: String(effectiveMap.fingerprint || "")
  };
}

/** Read the committed relation map used by ordinary FIFO projection rebuilds. */
function di3ReadSupplyCorrectionEffectiveMovementMap_(includeOperationId) {
  var spreadsheet = di3GetSpreadsheet_();
  var relationRows = spreadsheet && spreadsheet.getSheetByName("SupplyCorrectionEvents")
    ? di3ReadTableValues_("SupplyCorrectionEvents") : [];
  var operationRows = spreadsheet && spreadsheet.getSheetByName("Operations")
    ? di3ReadTableValues_("Operations") : [];
  return di3BuildSupplyCorrectionEffectiveMovementMap_(relationRows, operationRows, {
    include_operation_id: String(includeOperationId || "")
  });
}
