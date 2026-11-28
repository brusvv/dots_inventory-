/**
 * Dots Inventory v3 — SC-04 execution primitives.
 *
 * This file contains deterministic relation planning and idempotent row
 * construction shared by the SC-04 operation handler.
 */

/**
 * Build one-to-one REPLACE/REMOVE/ADD links between the original receipt and
 * its corrected lines. Exact product+variant identity is preferred; a
 * remaining same-product pair is REPLACE only when unambiguous. Ambiguous
 * many-to-one changes are represented as REMOVE + ADD.
 */
function di3BuildSupplyCorrectionRelationPlan_(sourceLines, replacementLines, metadata, makeId) {
  metadata = metadata || {};
  if (typeof makeId !== "function") throw new Error("Для relation plan требуется детерминированный ID factory.");
  var supplyId = String(metadata.supply_id || "");
  var correctionId = String(metadata.correction_id || "");
  var operationId = String(metadata.operation_id || "");
  if (!supplyId || !correctionId || !operationId) throw new Error("Relation plan: отсутствует supply_id/correction_id/operation_id.");
  if (!Array.isArray(sourceLines) || !sourceLines.length) throw new Error("Relation plan: отсутствуют исходные receipt lines.");
  if (!Array.isArray(replacementLines)) throw new Error("Relation plan: replacementLines должен быть массивом.");

  function indexUnique(lines, fields, label) {
    var seen = Object.create(null);
    (lines || []).forEach(function (line, index) {
      fields.forEach(function (field) {
        if (!String(line && line[field] || "")) throw new Error(label + " " + (index + 1) + ": отсутствует " + field + ".");
      });
      var movementId = String(line.movement_id);
      if (seen[movementId]) throw new Error(label + ": повторяется movement_id " + movementId + ".");
      seen[movementId] = true;
    });
  }
  indexUnique(sourceLines, ["movement_id", "supply_item_id", "product_id", "pack_variant_id"], "Source line");
  indexUnique(replacementLines, ["movement_id", "supply_item_id", "product_id", "pack_variant_id"], "Replacement line");
  var sourceMovementIds = Object.create(null);
  sourceLines.forEach(function (line) { sourceMovementIds[String(line.movement_id)] = true; });
  replacementLines.forEach(function (line) {
    if (sourceMovementIds[String(line.movement_id)]) {
      throw new Error("Source and replacement movement_id must be new and distinct: " + line.movement_id + ".");
    }
  });

  var sourceUsed = Object.create(null), replacementUsed = Object.create(null), pairs = [];
  function pairByKey(keyFn) {
    var sourceGroups = Object.create(null), replacementGroups = Object.create(null);
    sourceLines.forEach(function (line) {
      if (sourceUsed[String(line.movement_id)]) return;
      var key = keyFn(line);
      if (!sourceGroups[key]) sourceGroups[key] = [];
      sourceGroups[key].push(line);
    });
    replacementLines.forEach(function (line) {
      if (replacementUsed[String(line.movement_id)]) return;
      var key = keyFn(line);
      if (!replacementGroups[key]) replacementGroups[key] = [];
      replacementGroups[key].push(line);
    });
    Object.keys(sourceGroups).sort().forEach(function (key) {
      var left = sourceGroups[key], right = replacementGroups[key] || [];
      if (left.length === 1 && right.length === 1) {
        sourceUsed[String(left[0].movement_id)] = true;
        replacementUsed[String(right[0].movement_id)] = true;
        pairs.push({ source: left[0], replacement: right[0] });
      }
    });
  }
  pairByKey(function (line) { return String(line.product_id) + "\u001f" + String(line.pack_variant_id); });
  pairByKey(function (line) { return String(line.product_id); });

  var relations = [];
  function add(type, source, replacement) {
    var effectiveAt = source ? source.effective_at : replacement.effective_at;
    var relation = {
      relation_id: String(makeId()),
      correction_id: correctionId,
      operation_id: operationId,
      supply_id: supplyId,
      relation_type: type,
      source_movement_id: source ? String(source.movement_id) : "",
      replacement_movement_id: replacement ? String(replacement.movement_id) : "",
      source_product_id: source ? String(source.product_id) : "",
      replacement_product_id: replacement ? String(replacement.product_id) : "",
      source_supply_item_id: source ? String(source.supply_item_id) : "",
      replacement_supply_item_id: replacement ? String(replacement.supply_item_id) : "",
      effective_at: new Date(effectiveAt).toISOString()
    };
    di3ValidateSupplyCorrectionRelationMetadata_(relation);
    relations.push(relation);
  }
  pairs.forEach(function (pair) { add("REPLACE", pair.source, pair.replacement); });
  sourceLines.forEach(function (line) {
    if (!sourceUsed[String(line.movement_id)]) add("REMOVE", line, null);
  });
  replacementLines.forEach(function (line) {
    if (!replacementUsed[String(line.movement_id)]) add("ADD", null, line);
  });
  if (!relations.length) throw new Error("Корректировка не содержит ни одного изменения складских строк.");
  return relations;
}

/** Convert immutable replacement receipt lines into append-only stock source rows. */
function di3BuildSupplyCorrectionReceiptRows_(operationId, payload) {
  var operationKey = String(operationId || "");
  if (!operationKey || !payload || !Array.isArray(payload.replacement_lines) || !payload.replacement_lines.length) {
    throw new Error("Некорректный operation_id или replacement_lines для SUPPLY_CORRECTION.");
  }
  var ledger = [], details = [], lots = [];
  var actor = String(payload.created_by || di3GetOperationInitiatorActor_(operationKey));
  var seenMovements = Object.create(null), seenLots = Object.create(null), seenEvents = Object.create(null);
  payload.replacement_lines.forEach(function (line, index) {
    var label = "Replacement line " + (index + 1);
    var movementId = String(line.movement_id || "");
    var lotId = String(line.lot_id || "");
    var eventKey = String(line.event_key || "");
    var quantity = Number(line.quantity);
    var unitCost = Number(line.unit_cost);
    var totalCostMinor = Number(line.total_cost_minor);
    if (!movementId || !lotId || !eventKey || seenMovements[movementId] || seenLots[lotId] || seenEvents[eventKey]) {
      throw new Error(label + ": пустой или повторный movement_id/lot_id/event_key.");
    }
    seenMovements[movementId] = true; seenLots[lotId] = true; seenEvents[eventKey] = true;
    if (String(line.supply_item_id || "") === "" || String(line.product_id || "") === "" ||
        String(line.pack_variant_id || "") === "") throw new Error(label + ": отсутствует идентичность строки/товара/фасовки.");
    if (!Number.isSafeInteger(quantity) || quantity <= 0 ||
        !Number.isFinite(unitCost) || unitCost < 0 ||
        !Number.isSafeInteger(totalCostMinor) || totalCostMinor < 0) {
      throw new Error(label + ": некорректное количество или себестоимость.");
    }
    if (["KNOWN", "FREE"].indexOf(String(line.cost_status)) === -1) throw new Error(label + ": недопустимый cost_status.");
    var effectiveAt = new Date(line.effective_at), recordedAt = new Date(line.recorded_at);
    if (!Number.isFinite(effectiveAt.getTime()) || !Number.isFinite(recordedAt.getTime())) {
      throw new Error(label + ": некорректные effective_at/recorded_at.");
    }
    var sequence = di3RequireLedgerSequence_(line.ledger_sequence, movementId);
    ledger.push([
      movementId, operationKey, eventKey, String(line.product_id), "SUPPLY",
      String(payload.supply_id), quantity, effectiveAt, recordedAt, "", "", 
      "Исправление поставки " + String(payload.supply_number) + "; correction " + String(payload.correction_id),
      sequence
    ]);
    details.push([
      movementId, String(line.display_code || ""), "IN", "SUPPLY_CORRECTION", "", "",
      String(line.cost_status), "", actor,
      "Исправление поставки " + String(payload.supply_number), "SUPPLY"
    ]);
    lots.push([
      lotId, String(line.product_id), movementId, "SUPPLY", String(payload.supply_id),
      String(line.pack_variant_id), effectiveAt, recordedAt, quantity, unitCost,
      String(line.cost_status), String(payload.currency || di3GetBaseCurrency_()),
      "Исправление поставки " + String(payload.supply_number) + "; позиция " + String(line.supply_item_id),
      "", totalCostMinor
    ]);
  });
  return { ledger: ledger, details: details, lots: lots };
}

/** Idempotently append corrected product-cost history versions by stable source key. */
function di3EnsureSupplyCorrectionCostHistory_(payload) {
  var lines = payload && payload.replacement_lines || [];
  var sourceKeys = lines.map(function (line) {
    return "SUPPLY_CORRECTION:" + payload.correction_id + ":" + line.supply_item_id;
  });
  var existing = sourceKeys.length ? di3ReadRowsByColumnValues_("ProductCostHistory", 7, sourceKeys) : [];
  var existingByKey = Object.create(null);
  existing.forEach(function (match) {
    var row = match.values, key = String(row[7] || "");
    if (existingByKey[key]) throw new Error("ProductCostHistory: повторяется source_key " + key + ".");
    existingByKey[key] = row;
  });
  var rows = [];
  lines.forEach(function (line, index) {
    var key = sourceKeys[index];
    var expectedTail = [
      String(line.product_id), String(line.pack_variant_id), Number(line.cost_per_pack),
      Number(line.unit_cost), String(payload.currency || di3GetBaseCurrency_()),
      "SUPPLY_CORRECTION", key, new Date(payload.received_at),
      new Date(payload.created_at), "Исправление поставки " + String(payload.supply_number) +
        "; correction " + String(payload.correction_id) + "; " + String(payload.reason || "")
    ];
    if (existingByKey[key]) {
      var actualTail = existingByKey[key].slice(1, 11);
      var normalize = function (value) {
        return value instanceof Date ? value.toISOString() : value;
      };
      if (JSON.stringify(actualTail.map(normalize)) !== JSON.stringify(expectedTail.map(normalize))) {
        throw new Error("ProductCostHistory: source_key " + key + " уже существует с другим содержимым.");
      }
      return;
    }
    rows.push([di3MakeUuid_()].concat(expectedTail));
  });
  if (rows.length) di3AppendTableRows_("ProductCostHistory", rows);
  return rows.length;
}
