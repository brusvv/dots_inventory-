/**
 * Dots Inventory v3 — append-only supply correction relation journal.
 *
 * This module provides the durable relation schema contract, idempotent event
 * append helper, and a pure resolver for committed/pending correction chains.
 * It does not alter FIFO input or execute a supply correction by itself.
 */
var DI3_SUPPLY_CORRECTION_EVENT_TYPES_ = Object.freeze([
  "PREPARED", "COMMITTED", "QUARANTINED", "ABORTED"
]);
var DI3_SUPPLY_CORRECTION_RELATION_TYPES_ = Object.freeze([
  "REPLACE", "REMOVE", "ADD"
]);

function di3SupplyCorrectionRelationValues_(rowOrMatch) {
  if (rowOrMatch && Array.isArray(rowOrMatch.values)) return rowOrMatch.values;
  if (Array.isArray(rowOrMatch)) return rowOrMatch;
  throw new Error("SupplyCorrectionEvents: некорректная строка журнала.");
}

function di3SupplyCorrectionRelationMetadata_(values) {
  return {
    relation_id: String(values[1] || ""),
    correction_id: String(values[2] || ""),
    operation_id: String(values[3] || ""),
    supply_id: String(values[4] || ""),
    relation_type: String(values[7] || ""),
    source_movement_id: String(values[8] || ""),
    replacement_movement_id: String(values[9] || ""),
    source_product_id: String(values[10] || ""),
    replacement_product_id: String(values[11] || ""),
    source_supply_item_id: String(values[12] || ""),
    replacement_supply_item_id: String(values[13] || ""),
    effective_at: values[14] instanceof Date ? values[14].toISOString() : String(values[14] || "")
  };
}

function di3ValidateSupplyCorrectionRelationMetadata_(metadata) {
  if (!metadata.relation_id || !metadata.correction_id || !metadata.operation_id || !metadata.supply_id) {
    throw new Error("SupplyCorrectionEvents: отсутствует relation_id, correction_id, operation_id или supply_id.");
  }
  if (DI3_SUPPLY_CORRECTION_RELATION_TYPES_.indexOf(metadata.relation_type) === -1) {
    throw new Error("SupplyCorrectionEvents: неизвестный relation_type " + metadata.relation_type + ".");
  }
  var hasSource = !!metadata.source_movement_id;
  var hasReplacement = !!metadata.replacement_movement_id;
  if (metadata.relation_type === "REPLACE") {
    if (!hasSource || !hasReplacement || !metadata.source_product_id ||
        !metadata.replacement_product_id ||
        metadata.source_product_id !== metadata.replacement_product_id) {
      throw new Error("REPLACE должен иметь один source и replacement одного product_id.");
    }
  } else if (metadata.relation_type === "REMOVE") {
    if (!hasSource || hasReplacement || !metadata.source_product_id || metadata.replacement_product_id) {
      throw new Error("REMOVE должен иметь только source movement и source product.");
    }
  } else if (metadata.relation_type === "ADD") {
    if (hasSource || !hasReplacement || metadata.source_product_id || !metadata.replacement_product_id) {
      throw new Error("ADD должен иметь только replacement movement и replacement product.");
    }
  }
  var effective = new Date(metadata.effective_at);
  if (!metadata.effective_at || !Number.isFinite(effective.getTime())) {
    throw new Error("SupplyCorrectionEvents: некорректный effective_at для relation_id " + metadata.relation_id + ".");
  }
  metadata.effective_at = effective.toISOString();
  return metadata;
}

/**
 * Resolve active supersession relations from append-only event rows.
 *
 * Normal FIFO replay sees a relation only after its latest event is COMMITTED
 * and its Operations row is COMMITTED. Candidate replay may additionally pass
 * include_operation_id to include PREPARED relations owned by that exact,
 * still-pending SUPPLY_CORRECTION operation.
 *
 * Rows may be repository matches ({row_number, values}) or raw value arrays.
 */
function di3BuildSupplyCorrectionEffectiveMovementMap_(relationRows, operationRows, options) {
  options = options || {};
  var includeOperationId = String(options.include_operation_id || "");
  var operationById = Object.create(null);
  (operationRows || []).forEach(function (rowOrMatch) {
    var row = di3SupplyCorrectionRelationValues_(rowOrMatch);
    var id = String(row[0] || "");
    if (!id) return;
    if (operationById[id]) throw new Error("Operations: повторяется operation_id " + id + ".");
    operationById[id] = {
      operation_type: String(row[2] || ""),
      document_type: String(row[3] || ""),
      document_id: String(row[4] || ""),
      status: String(row[5] || "")
    };
  });

  var groups = Object.create(null);
  var sequenceIndex = Object.create(null);
  var eventIdIndex = Object.create(null);
  (relationRows || []).forEach(function (rowOrMatch) {
    var row = di3SupplyCorrectionRelationValues_(rowOrMatch);
    var eventId = String(row[0] || "");
    var relationId = String(row[1] || "");
    var sequence = Number(row[5]);
    var eventType = String(row[6] || "");
    if (!eventId || !relationId || !Number.isSafeInteger(sequence) || sequence <= 0) {
      throw new Error("SupplyCorrectionEvents: отсутствует event_id/relation_id или некорректен event_sequence.");
    }
    if (eventIdIndex[eventId]) throw new Error("SupplyCorrectionEvents: повторяется event_id " + eventId + ".");
    eventIdIndex[eventId] = true;
    if (DI3_SUPPLY_CORRECTION_EVENT_TYPES_.indexOf(eventType) === -1) {
      throw new Error("SupplyCorrectionEvents: неизвестный event_type " + eventType + ".");
    }
    if (sequenceIndex[sequence]) throw new Error("SupplyCorrectionEvents: повторяется event_sequence " + sequence + ".");
    sequenceIndex[sequence] = true;
    var metadata = di3ValidateSupplyCorrectionRelationMetadata_(di3SupplyCorrectionRelationMetadata_(row));
    if (!groups[relationId]) groups[relationId] = { metadata: metadata, events: [] };
    if (JSON.stringify(groups[relationId].metadata) !== JSON.stringify(metadata)) {
      throw new Error("SupplyCorrectionEvents: metadata relation_id " + relationId + " изменились между событиями.");
    }
    groups[relationId].events.push({
      event_id: eventId,
      event_sequence: sequence,
      event_type: eventType,
      operation_id: metadata.operation_id
    });
  });

  var activeRelations = [];
  Object.keys(groups).forEach(function (relationId) {
    var group = groups[relationId];
    group.events.sort(function (a, b) { return a.event_sequence - b.event_sequence; });
    var latest = group.events[group.events.length - 1];
    var metadata = group.metadata;
    var operation = operationById[metadata.operation_id];
    if (!operation) throw new Error("SupplyCorrectionEvents: не найдена операция " + metadata.operation_id + ".");
    if (operation.operation_type !== "SUPPLY_CORRECTION" ||
        operation.document_type !== "SUPPLY" ||
        operation.document_id !== metadata.supply_id) {
      throw new Error("SupplyCorrectionEvents: операция " + metadata.operation_id + " не принадлежит этой коррекции поставки.");
    }
    if (latest.event_type === "QUARANTINED" || operation.status === "QUARANTINED") {
      throw new Error("SupplyCorrectionEvents: relation_id " + relationId + " находится в карантине.");
    }
    if (latest.event_type === "ABORTED" || operation.status === "REJECTED") return;
    if (latest.event_type === "COMMITTED" && operation.status === "COMMITTED") {
      activeRelations.push(metadata);
      return;
    }
    if ((latest.event_type === "PREPARED" || latest.event_type === "COMMITTED") &&
        includeOperationId === metadata.operation_id &&
        (operation.status === "PREPARED" || operation.status === "RETRYABLE")) {
      // Recovery may have durably appended COMMITTED relation events before the
      // enclosing operation status write. Only that operation may see them
      // until Operations itself is COMMITTED.
      activeRelations.push(metadata);
    }
  });

  var bySource = Object.create(null);
  var byReplacement = Object.create(null);
  activeRelations.forEach(function (relation) {
    if (relation.source_movement_id) {
      if (bySource[relation.source_movement_id]) {
        throw new Error("SupplyCorrectionEvents: source movement " + relation.source_movement_id + " имеет несколько активных supersession.");
      }
      bySource[relation.source_movement_id] = relation;
    }
    if (relation.replacement_movement_id) {
      if (byReplacement[relation.replacement_movement_id]) {
        throw new Error("SupplyCorrectionEvents: replacement movement " + relation.replacement_movement_id + " используется несколькими активными связями.");
      }
      byReplacement[relation.replacement_movement_id] = relation;
    }
  });

  // Every movement can be superseded at most once; follow replacement chains
  // to reject cycles before any replay caller consumes this map.
  var visitState = Object.create(null);
  function visit(movementId) {
    var state = visitState[movementId] || 0;
    if (state === 1) throw new Error("SupplyCorrectionEvents: обнаружен цикл в цепочке исправлений у движения " + movementId + ".");
    if (state === 2) return;
    visitState[movementId] = 1;
    var relation = bySource[movementId];
    if (relation && relation.replacement_movement_id) visit(relation.replacement_movement_id);
    visitState[movementId] = 2;
  }
  Object.keys(bySource).forEach(visit);

  var superseded = Object.keys(bySource).sort();
  var supersededSet = Object.create(null);
  superseded.forEach(function (id) { supersededSet[id] = true; });
  var activeReplacements = Object.keys(byReplacement).filter(function (id) {
    return !supersededSet[id];
  }).sort();
  var removed = activeRelations.filter(function (relation) {
    return relation.relation_type === "REMOVE";
  }).map(function (relation) { return relation.source_movement_id; }).sort();
  var normalized = activeRelations.slice().sort(function (a, b) {
    return a.relation_id.localeCompare(b.relation_id);
  });
  return {
    relations: normalized,
    superseded_movement_ids: superseded,
    active_replacement_movement_ids: activeReplacements,
    removed_movement_ids: removed,
    fingerprint: di3BuildManualOperationPayloadHash_({
      relations: normalized,
      superseded_movement_ids: superseded,
      active_replacement_movement_ids: activeReplacements
    })
  };
}

/**
 * Append one lifecycle event for each relation. The caller may already hold
 * ScriptLock; di3WithLock_ safely reuses the execution-local outer lock.
 * Repeating the same operation/relation/event is idempotent.
 */
function di3AppendSupplyCorrectionRelationEvents_(relations, eventType, operationId, detailsByRelationId) {
  var targetEventType = String(eventType || "").toUpperCase();
  var operationKey = String(operationId || "");
  if (DI3_SUPPLY_CORRECTION_EVENT_TYPES_.indexOf(targetEventType) === -1) {
    throw new Error("Недопустимый event_type журнала исправлений: " + targetEventType + ".");
  }
  if (!operationKey || !Array.isArray(relations) || !relations.length) {
    throw new Error("Для записи SupplyCorrectionEvents нужны relations и operation_id.");
  }
  return di3WithLock_(function () {
    var sheet = di3GetSpreadsheet_().getSheetByName("SupplyCorrectionEvents");
    if (!sheet) throw new Error("Не найдена таблица SupplyCorrectionEvents. Выполни штатную инициализацию схемы.");
    var relationIds = relations.map(function (relation) { return String(relation && relation.relation_id || ""); });
    if (relationIds.some(function (id) { return !id; }) ||
        relationIds.some(function (id, index) { return relationIds.indexOf(id) !== index; })) {
      throw new Error("SupplyCorrectionEvents: relation_id отсутствует или повторяется в пакете.");
    }
    var existing = di3ReadRowsByColumnValues_("SupplyCorrectionEvents", 1, relationIds);
    var existingByKey = Object.create(null);
    existing.forEach(function (match) {
      var row = match.values;
      var key = [String(row[1]), String(row[3]), String(row[6])].join("|");
      if (existingByKey[key]) throw new Error("SupplyCorrectionEvents: повторяется событие " + key + ".");
      existingByKey[key] = row;
    });
    var sequenceValues = di3ReadTableColumnValues_("SupplyCorrectionEvents", 5);
    var seenSequences = Object.create(null);
    var maxSequence = sequenceValues.reduce(function (max, value) {
      var sequence = Number(value);
      if (!Number.isSafeInteger(sequence) || sequence <= 0 || seenSequences[sequence]) {
        throw new Error("SupplyCorrectionEvents: обнаружен пустой, некорректный или повторный event_sequence. Запись остановлена.");
      }
      seenSequences[sequence] = true;
      return Math.max(max, sequence);
    }, 0);
    var createdAt = new Date();
    var rowsToAppend = [];
    relations.forEach(function (relation) {
      var metadata = di3ValidateSupplyCorrectionRelationMetadata_({
        relation_id: String(relation.relation_id || ""),
        correction_id: String(relation.correction_id || ""),
        operation_id: operationKey,
        supply_id: String(relation.supply_id || ""),
        relation_type: String(relation.relation_type || ""),
        source_movement_id: String(relation.source_movement_id || ""),
        replacement_movement_id: String(relation.replacement_movement_id || ""),
        source_product_id: String(relation.source_product_id || ""),
        replacement_product_id: String(relation.replacement_product_id || ""),
        source_supply_item_id: String(relation.source_supply_item_id || ""),
        replacement_supply_item_id: String(relation.replacement_supply_item_id || ""),
        effective_at: relation.effective_at instanceof Date ? relation.effective_at.toISOString() : String(relation.effective_at || "")
      });
      var key = [metadata.relation_id, operationKey, targetEventType].join("|");
      var details = detailsByRelationId && detailsByRelationId[metadata.relation_id] != null
        ? detailsByRelationId[metadata.relation_id] : (relation.details || {});
      var detailsJson = JSON.stringify(details);
      if (detailsJson.length > 45000) throw new Error("SupplyCorrectionEvents.details_json превышает безопасный размер ячейки.");
      if (existingByKey[key]) {
        var prior = existingByKey[key];
        var priorMetadata = di3SupplyCorrectionRelationMetadata_(prior);
        if (JSON.stringify(priorMetadata) !== JSON.stringify(metadata) ||
            String(prior[16] || "") !== detailsJson) {
          throw new Error("SupplyCorrectionEvents: повторный вызов имеет другое содержимое для " + key + ".");
        }
        return;
      }
      maxSequence++;
      rowsToAppend.push([
        di3MakeUuid_(), metadata.relation_id, metadata.correction_id, operationKey,
        metadata.supply_id, maxSequence, targetEventType, metadata.relation_type,
        metadata.source_movement_id, metadata.replacement_movement_id,
        metadata.source_product_id, metadata.replacement_product_id,
        metadata.source_supply_item_id, metadata.replacement_supply_item_id,
        new Date(metadata.effective_at), createdAt, detailsJson
      ]);
    });
    if (rowsToAppend.length) di3AppendTableRows_("SupplyCorrectionEvents", rowsToAppend);
    return { appended: rowsToAppend.length, skipped_existing: relations.length - rowsToAppend.length };
  });
}
