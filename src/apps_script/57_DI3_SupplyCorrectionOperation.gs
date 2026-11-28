/**
 * Dots Inventory v3 — SC-04 immutable correction operation.
 *
 * This is an explicit command API, not a menu action. It requires a caller to
 * supply a correction_id, reason and complete replacement lines. It never
 * edits the original receipt operation or its source ledger/detail/lot rows.
 */

function di3BuildSupplyCorrectionRequestFingerprint_(supplyId, spec) {
  spec = spec || {};
  var lines = Array.isArray(spec.lines) ? spec.lines : [];
  var normalizedLines = lines.map(function (line) {
    return {
      product_id: String(line.product_id || ""),
      pack_variant_id: String(line.pack_variant_id || ""),
      units_per_pack: Number(line.units_per_pack),
      packs: Number(line.packs),
      purchase_price_minor: di3ToCents_(line.purchase_price_per_pack, "Закупочная цена")
    };
  });
  return di3SupplyFullEditHash_({
    schema_version: 1,
    supply_id: String(supplyId || ""),
    correction_id: String(spec.correction_id || ""),
    reason: String(spec.reason || "").trim(),
    seller_discount_minor: di3ToCents_(spec.seller_discount_amount || 0, "Скидка продавца"),
    partner_discount_minor: di3ToCents_(spec.partner_discount_amount || 0, "Скидка партнёров"),
    shipping_minor: di3ToCents_(spec.shipping_amount || 0, "Доставка"),
    lines: normalizedLines
  });
}

function di3SupplyCorrectionRowFromRecord_(schemaName, record) {
  return DI3_TABLE_SCHEMAS[schemaName].map(function (header) { return record[header]; });
}

function di3BuildSupplyCorrectionOperationPayload_(supplyId, spec, sourceAudit, operationId) {
  spec = spec || {};
  var supply = di3GetSupplyById_(supplyId);
  if (!supply) throw new Error("Поставка не найдена: " + supplyId);
  if (di3NormalizeSupplyStatus_(supply.status) !== DI3_SUPPLY_STATUS.RECEIVED) {
    throw new Error("Исправлять можно только поставку со статусом «Получена».");
  }
  if (!sourceAudit || sourceAudit.status !== "READY" || !sourceAudit.source_map) {
    throw new Error("Перед построением коррекции требуется успешный read-only аудит исходной приёмки.");
  }
  var correctionId = String(spec.correction_id || "").trim();
  var reason = String(spec.reason || "").trim();
  if (!correctionId || !reason) throw new Error("Для исправления обязательны correction_id и причина.");
  if (!Array.isArray(spec.lines) || !spec.lines.length) throw new Error("В исправлении должна остаться хотя бы одна товарная позиция.");

  var sourceReceipt = di3GetSupplyReceiptOperation_(supplyId);
  if (!sourceReceipt || String(sourceReceipt.values[5]) !== "COMMITTED") {
    throw new Error("Исходная операция SUPPLY_RECEIVE не подтверждена.");
  }
  var sourcePayloadRecord = di3FindRowByFirstColumn_("OperationPayloads", String(sourceReceipt.values[0]));
  if (!sourcePayloadRecord) throw new Error("Не найден immutable payload исходной приёмки.");
  var sourceReceiptPayload = JSON.parse(String(sourcePayloadRecord.values[1] || ""));
  if (di3BuildOperationPayloadHash_("SUPPLY_RECEIVE", sourceReceiptPayload) !== String(sourceReceipt.values[6])) {
    throw new Error("Хэш исходного receipt payload не совпадает с Operations.");
  }

  // Until correction-chain source hydration is added, a second correction of
  // this document is blocked rather than incorrectly mapping the original rows.
  var existingCorrectionRelations = di3ReadRowsByColumnValue_("SupplyCorrectionEvents", 4, String(supplyId));
  if (existingCorrectionRelations.length) {
    throw new Error("У поставки уже есть история исправлений. Повторная коррекция пока заблокирована до реализации выбора текущих эффективных строк.");
  }

  var variantIndex = di3LoadPackVariantIndex_();
  var productIndex = di3GetProductFormOptionIndex_(true);
  var normalizedInputLines = spec.lines.map(function (line, index) {
    var productId = String(line.product_id || "");
    var variantId = String(line.pack_variant_id || "");
    var variant = variantIndex.byId[variantId];
    if (!variant || String(variant.product_id) !== productId) {
      throw new Error("Позиция " + (index + 1) + ": фасовка отсутствует или принадлежит другому товару.");
    }
    if (Number(variant.units_per_pack) !== Number(line.units_per_pack)) {
      throw new Error("Позиция " + (index + 1) + ": units_per_pack не совпадает со справочником фасовок.");
    }
    var product = productIndex.byId[productId];
    if (!product) throw new Error("Позиция " + (index + 1) + ": товар отсутствует в каталоге.");
    return {
      product_id: productId,
      product_label_snapshot: di3GetProductOptionLabelWithMap_(product, productIndex.codes || {}),
      pack_variant_id: variantId,
      units_per_pack: Number(line.units_per_pack),
      packs: Number(line.packs),
      purchase_price_per_pack: Number(line.purchase_price_per_pack)
    };
  });
  var plan = di3BuildSupplyFinancialPlan_({
    lines: normalizedInputLines,
    seller_discount_amount: spec.seller_discount_amount || 0,
    partner_discount_amount: spec.partner_discount_amount || 0,
    shipping_amount: spec.shipping_amount || 0
  });
  var oldItems = di3GetSupplyItems_(supplyId);
  var oldComparable = oldItems.map(function (item) {
    return [String(item.product_id), String(item.pack_variant_id), Number(item.units_per_pack),
      Number(item.packs), di3ToCents_(item.purchase_price_per_pack, "Исходная закупочная цена")];
  }).sort(function (a, b) { return JSON.stringify(a).localeCompare(JSON.stringify(b)); });
  var newComparable = plan.lines.map(function (line) {
    return [String(line.product_id), String(line.pack_variant_id), Number(line.units_per_pack),
      Number(line.packs), di3ToCents_(line.purchase_price_per_pack, "Новая закупочная цена")];
  }).sort(function (a, b) { return JSON.stringify(a).localeCompare(JSON.stringify(b)); });
  var documentFinancials = [
    [di3ToCents_(supply.goods_amount, "Исходная стоимость товаров"), di3ToCents_(plan.goods_amount, "Новая стоимость товаров")],
    [di3ToCents_(supply.seller_discount_amount, "Исходная скидка продавца"), di3ToCents_(plan.seller_discount_amount, "Новая скидка продавца")],
    [di3ToCents_(supply.partner_discount_amount, "Исходная скидка партнёров"), di3ToCents_(plan.partner_discount_amount, "Новая скидка партнёров")],
    [di3ToCents_(supply.shipping_amount, "Исходная доставка"), di3ToCents_(plan.shipping_amount, "Новая доставка")],
    [di3ToCents_(supply.final_amount, "Исходная итоговая сумма"), di3ToCents_(plan.final_amount, "Новая итоговая сумма")]
  ];
  var linesChanged = JSON.stringify(oldComparable) !== JSON.stringify(newComparable);
  var financialChanged = documentFinancials.some(function (pair) { return pair[0] !== pair[1]; });
  if (!linesChanged && !financialChanged) {
    throw new Error("Новая версия поставки полностью совпадает с текущей. Пустую складскую коррекцию создавать нельзя.");
  }
  var oldByIdentity = Object.create(null);
  oldItems.forEach(function (item) {
    var key = String(item.product_id) + "\u001f" + String(item.pack_variant_id);
    if (oldByIdentity[key]) throw new Error("В исходном документе повторяется товар/фасовка; автоматическая коррекция неоднозначна.");
    oldByIdentity[key] = item;
  });

  var afterItemRows = plan.lines.map(function (line, index) {
    var key = String(line.product_id) + "\u001f" + String(line.pack_variant_id);
    return di3SupplyItemToRow_(supplyId, Object.assign({}, line, {
      product_label_snapshot: normalizedInputLines[index].product_label_snapshot
    }), index + 1, oldByIdentity[key] || null);
  });
  var afterIds = Object.create(null);
  afterItemRows.forEach(function (row) { afterIds[String(row[0])] = true; });
  var removedItemIds = oldItems.filter(function (item) { return !afterIds[String(item.supply_item_id)]; })
    .map(function (item) { return String(item.supply_item_id); });

  var now = new Date();
  var beforeSupplyRow = di3SupplyCorrectionRowFromRecord_("V3_Supplies", supply);
  var afterSupplyRow = beforeSupplyRow.slice();
  var supplyHeaders = DI3_TABLE_SCHEMAS.V3_Supplies;
  function setSupplyField(key, value) { afterSupplyRow[supplyHeaders.indexOf(key)] = value; }
  setSupplyField("goods_amount", plan.goods_amount);
  setSupplyField("seller_discount_amount", plan.seller_discount_amount);
  setSupplyField("partner_discount_amount", plan.partner_discount_amount);
  setSupplyField("discount_total", plan.discount_total);
  setSupplyField("shipping_amount", plan.shipping_amount);
  setSupplyField("final_amount", plan.final_amount);
  setSupplyField("updated_at", now);

  var beforeItemRows = oldItems.map(function (item) {
    return di3SupplyCorrectionRowFromRecord_("V3_SupplyItems", item);
  });
  var effectiveAt = new Date(sourceReceiptPayload.received_at);
  var originalRecordedAt = new Date(sourceReceiptPayload.recorded_at);
  if (!Number.isFinite(effectiveAt.getTime()) || !Number.isFinite(originalRecordedAt.getTime())) {
    throw new Error("В исходном receipt payload некорректны received_at/recorded_at.");
  }
  var sequenceIndex = di3ReadLedgerSequenceIndex_();
  var nextLedgerSequence = Number(sequenceIndex.max_sequence || 0) + 1;
  if (!Number.isSafeInteger(nextLedgerSequence) || nextLedgerSequence <= 0) {
    throw new Error("Не удалось определить следующий ledger_sequence.");
  }
  var nextDisplayCode = di3NextMovementDisplayCode_();
  var displayMatch = String(nextDisplayCode).match(/^(.*?)(\d+)$/);
  var displayPrefix = displayMatch ? displayMatch[1] : "MOV-";
  var displayNumber = displayMatch ? Number(displayMatch[2]) : 1;

  var replacementLines = plan.lines.map(function (line, index) {
    var itemRow = afterItemRows[index];
    var itemId = String(itemRow[0]);
    var totalCostMinor = di3MoneyToMinorUnits_(line.final_line_amount, "Полная себестоимость позиции", false);
    return {
      supply_item_id: itemId,
      product_id: String(line.product_id),
      product_label: String(normalizedInputLines[index].product_label_snapshot),
      pack_variant_id: String(line.pack_variant_id),
      units_per_pack: Number(line.units_per_pack),
      packs: Number(line.packs),
      quantity: Number(line.received_units),
      purchase_price_per_pack: Number(line.purchase_price_per_pack),
      cost_per_pack: Number(line.final_pack_cost),
      unit_cost: Number(line.unit_cost),
      total_cost_minor: totalCostMinor,
      cost_status: totalCostMinor === 0 ? "FREE" : "KNOWN",
      movement_id: di3MakeUuid_(),
      lot_id: di3MakeUuid_(),
      event_key: "SUPPLY_CORRECTION:" + correctionId + ":" + itemId,
      display_code: displayPrefix + String(displayNumber + index).padStart(Math.max(6, String(displayNumber + index).length), "0"),
      ledger_sequence: nextLedgerSequence + index,
      effective_at: effectiveAt.toISOString(),
      recorded_at: originalRecordedAt.toISOString()
    };
  });
  var sourceLines = sourceAudit.source_map.source_lines;
  var relationPlan = di3BuildSupplyCorrectionRelationPlan_(
    sourceLines, replacementLines,
    { supply_id: supplyId, correction_id: correctionId, operation_id: operationId },
    di3MakeUuid_
  );
  var affectedSet = Object.create(null);
  sourceAudit.source_map.affected_product_ids.forEach(function (id) { affectedSet[String(id)] = true; });
  replacementLines.forEach(function (line) { affectedSet[String(line.product_id)] = true; });
  var affectedProductIds = Object.keys(affectedSet).sort();

  var payload = {
    schema_version: 1,
    correction_id: correctionId,
    supply_id: String(supplyId),
    supply_number: String(supply.supply_number),
    reason: reason,
    source_receipt_operation_id: String(sourceReceipt.values[0]),
    source_receipt_payload_hash: String(sourceReceipt.values[6]),
    source_supply_fingerprint: di3SupplyFullEditHash_({
      supply_row: beforeSupplyRow.map(di3SupplyFullEditNormalizeValue_),
      item_rows: beforeItemRows.map(function (row) { return row.map(di3SupplyFullEditNormalizeValue_); }),
      source_map_fingerprint: sourceAudit.source_map.fingerprint
    }),
    source_receipt_fingerprint: String(sourceAudit.source_map.fingerprint),
    source_lines: sourceLines,
    source_movement_ids: sourceLines.map(function (line) { return String(line.movement_id); }),
    source_lot_ids: sourceLines.map(function (line) { return String(line.lot_id); }),
    before_supply_row: beforeSupplyRow,
    before_item_rows: beforeItemRows,
    after_supply_row: afterSupplyRow,
    after_item_rows: afterItemRows,
    removed_item_ids: removedItemIds,
    replacement_lines: replacementLines,
    relations: relationPlan,
    affected_product_ids: affectedProductIds,
    received_at: effectiveAt.toISOString(),
    source_recorded_at: originalRecordedAt.toISOString(),
    created_at: now.toISOString(),
    created_by: di3GetActorEmail_(),
    currency: String(supply.currency || di3GetBaseCurrency_()),
    request_fingerprint: di3BuildSupplyCorrectionRequestFingerprint_(supplyId, spec)
  };

  // Dry-run the exact candidate relation set and effective stock stream before
  // registering any operation or writing any sheet.
  var replacementRows = di3BuildSupplyCorrectionReceiptRows_(operationId, payload);
  var currentLedger = di3ReadTableValues_("StockLedger");
  var currentDetails = di3ReadTableValues_("StockMovementDetails");
  var currentLots = di3ReadTableValues_("StockLots");
  var relationRows = di3ReadTableValues_("SupplyCorrectionEvents");
  var maxRelationSequence = relationRows.reduce(function (max, row) { return Math.max(max, Number(row[5]) || 0); }, 0);
  var syntheticEvents = relationPlan.map(function (relation, index) {
    return [
      "PREVIEW-EVENT-" + (index + 1), relation.relation_id, correctionId, operationId,
      String(supplyId), maxRelationSequence + index + 1, "PREPARED", relation.relation_type,
      relation.source_movement_id, relation.replacement_movement_id,
      relation.source_product_id, relation.replacement_product_id,
      relation.source_supply_item_id, relation.replacement_supply_item_id,
      new Date(relation.effective_at), now, "{}"
    ];
  });
  var syntheticOperation = [
    operationId, "SUPPLY_CORRECTION:" + supplyId + ":" + correctionId,
    "SUPPLY_CORRECTION", "SUPPLY", String(supplyId), "PREPARED",
    "PREVIEW-HASH", now, "", "", ""
  ];
  var candidate = di3BuildSupplyCorrectionCandidateFifoReplayPlan_(
    currentLedger.concat(replacementRows.ledger),
    currentDetails.concat(replacementRows.details),
    currentLots.concat(replacementRows.lots),
    relationRows.concat(syntheticEvents),
    di3ReadTableValues_("Operations").concat([syntheticOperation]),
    { include_operation_id: operationId }
  );
  payload.candidate_fifo_input_fingerprint = candidate.input_fingerprint;
  payload.candidate_fifo_preview = {
    affected_product_ids: candidate.affected_product_ids,
    superseded_movement_ids: candidate.superseded_movement_ids,
    active_replacement_movement_ids: candidate.active_replacement_movement_ids,
    movement_count: candidate.replay.movement_count,
    allocation_count: candidate.replay.allocations.length
  };
  return payload;
}

function di3EnsureSupplyCorrectionSourceRows_(operationId, payload) {
  var expected = di3BuildSupplyCorrectionReceiptRows_(operationId, payload);
  function ensure(tableName, lookupColumn, keys, rows, label) {
    var matches = keys.length ? di3ReadRowsByColumnValues_(tableName, lookupColumn, keys) : [];
    var byKey = Object.create(null);
    matches.forEach(function (match) {
      var key = String(match.values[lookupColumn] || "");
      if (!byKey[key]) byKey[key] = [];
      byKey[key].push(match);
    });
    var append = [];
    rows.forEach(function (row, index) {
      var key = String(row[lookupColumn] || "");
      var found = byKey[key] || [];
      if (found.length > 1) throw new Error(label + ": повторяется ключ " + key + ".");
      if (!found.length) { append.push(row); return; }
      if (JSON.stringify(found[0].values.map(di3SupplyFullEditNormalizeValue_)) !==
          JSON.stringify(row.map(di3SupplyFullEditNormalizeValue_))) {
        throw new Error(label + ": существующая строка " + key + " отличается от immutable payload.");
      }
    });
    if (append.length) di3AppendTableRows_(tableName, append);
    var verified = keys.length ? di3ReadRowsByColumnValues_(tableName, lookupColumn, keys) : [];
    var verifiedByKey = Object.create(null);
    verified.forEach(function (match) {
      var key = String(match.values[lookupColumn] || "");
      if (verifiedByKey[key]) throw new Error(label + ": повторяется ключ после записи " + key + ".");
      verifiedByKey[key] = match.values;
    });
    rows.forEach(function (row) {
      var key = String(row[lookupColumn] || ""), actual = verifiedByKey[key];
      if (!actual || JSON.stringify(actual.map(di3SupplyFullEditNormalizeValue_)) !==
          JSON.stringify(row.map(di3SupplyFullEditNormalizeValue_))) {
        throw new Error(label + ": не удалось подтвердить сохранение строки " + key + ".");
      }
    });
    return append.length;
  }
  var ledgerAdded = ensure("StockLedger", 2, expected.ledger.map(function (r) { return String(r[2]); }), expected.ledger, "StockLedger");
  var detailAdded = ensure("StockMovementDetails", 0, expected.details.map(function (r) { return String(r[0]); }), expected.details, "StockMovementDetails");
  var lotAdded = ensure("StockLots", 2, expected.lots.map(function (r) { return String(r[2]); }), expected.lots, "StockLots");
  return { ledger_added: ledgerAdded, details_added: detailAdded, lots_added: lotAdded };
}

function di3EnsureSupplyCorrectionRelationStage_(relations, operationId, targetEventType) {
  var ids = relations.map(function (relation) { return String(relation.relation_id); });
  var matches = ids.length ? di3ReadRowsByColumnValues_("SupplyCorrectionEvents", 1, ids) : [];
  var latest = Object.create(null);
  matches.forEach(function (match) {
    var row = match.values, id = String(row[1]), seq = Number(row[5]);
    if (!latest[id] || seq > Number(latest[id][5])) latest[id] = row;
  });
  var missingPrepared = relations.filter(function (relation) {
    var row = latest[String(relation.relation_id)];
    if (!row) return true;
    var expectedMetadata = [
      String(relation.relation_id), String(relation.correction_id), String(operationId),
      String(relation.supply_id), String(relation.relation_type),
      String(relation.source_movement_id || ""), String(relation.replacement_movement_id || ""),
      String(relation.source_product_id || ""), String(relation.replacement_product_id || ""),
      String(relation.source_supply_item_id || ""), String(relation.replacement_supply_item_id || ""),
      new Date(relation.effective_at).toISOString()
    ];
    var actualMetadata = [
      String(row[1]), String(row[2]), String(row[3]), String(row[4]), String(row[7]),
      String(row[8] || ""), String(row[9] || ""), String(row[10] || ""),
      String(row[11] || ""), String(row[12] || ""), String(row[13] || ""),
      new Date(row[14]).toISOString()
    ];
    if (JSON.stringify(actualMetadata) !== JSON.stringify(expectedMetadata)) {
      throw new Error("SupplyCorrectionEvents relation " + relation.relation_id + " отличается от immutable operation payload.");
    }
    if (String(row[3]) !== String(operationId)) throw new Error("Relation " + relation.relation_id + " уже принадлежит другой операции.");
    if (String(row[6]) === "QUARANTINED" || String(row[6]) === "ABORTED") throw new Error("Relation " + relation.relation_id + " находится в терминальном состоянии " + row[6] + ".");
    return false;
  });
  if (missingPrepared.length) {
    di3AppendSupplyCorrectionRelationEvents_(missingPrepared, "PREPARED", operationId);
    matches = ids.length ? di3ReadRowsByColumnValues_("SupplyCorrectionEvents", 1, ids) : [];
    latest = Object.create(null);
    matches.forEach(function (match) {
      var row = match.values, id = String(row[1]), seq = Number(row[5]);
      if (!latest[id] || seq > Number(latest[id][5])) latest[id] = row;
    });
  }
  if (targetEventType === "COMMITTED") {
    var toCommit = relations.filter(function (relation) {
      var row = latest[String(relation.relation_id)];
      if (!row) throw new Error("Relation " + relation.relation_id + " не имеет PREPARED события.");
      if (String(row[6]) === "COMMITTED") return false;
      if (String(row[6]) !== "PREPARED") throw new Error("Нельзя зафиксировать relation " + relation.relation_id + " из состояния " + row[6] + ".");
      return true;
    });
    if (toCommit.length) di3AppendSupplyCorrectionRelationEvents_(toCommit, "COMMITTED", operationId);
  }
  return true;
}

function di3SupplyCorrectionRowEquals_(left, right) {
  return JSON.stringify((left || []).map(di3SupplyFullEditNormalizeValue_)) ===
    JSON.stringify((right || []).map(di3SupplyFullEditNormalizeValue_));
}

/** Idempotent before-or-after document projection writer with fail-closed conflict detection. */
function di3ApplySupplyCorrectionDocumentProjection_(payload) {
  var supplyId = String(payload.supply_id);
  var currentSupply = di3GetSupplyById_(supplyId);
  if (!currentSupply) throw new Error("Не найдена поставка при применении коррекции.");
  var beforeSupply = di3HydrateSupplyFullEditRow_(payload.before_supply_row, "SUPPLY");
  var afterSupply = di3HydrateSupplyFullEditRow_(payload.after_supply_row, "SUPPLY");
  var currentSupplyRow = di3SupplyCorrectionRowFromRecord_("V3_Supplies", currentSupply);
  if (di3SupplyCorrectionRowEquals_(currentSupplyRow, beforeSupply)) {
    di3ApplyContiguousRowUpdates_("V3_Supplies", [{ row_number: currentSupply.row_number, values: afterSupply }]);
  } else if (!di3SupplyCorrectionRowEquals_(currentSupplyRow, afterSupply)) {
    throw new Error("V3_Supplies уже отличается и от source, и от target snapshot. Автоматическая перезапись запрещена.");
  }

  var beforeById = Object.create(null), afterById = Object.create(null);
  (payload.before_item_rows || []).forEach(function (row) { beforeById[String(row[0])] = di3HydrateSupplyFullEditRow_(row, "ITEM"); });
  (payload.after_item_rows || []).forEach(function (row) { afterById[String(row[0])] = di3HydrateSupplyFullEditRow_(row, "ITEM"); });
  var currentMatches = di3ReadRowsByColumnValue_("V3_SupplyItems", 1, supplyId);
  var currentById = Object.create(null);
  currentMatches.forEach(function (match) {
    var id = String(match.values[0] || "");
    if (currentById[id]) throw new Error("V3_SupplyItems: повторяется supply_item_id " + id + ".");
    currentById[id] = match;
    if (!beforeById[id] && !afterById[id]) throw new Error("В поставке появилась посторонняя строка " + id + " после подготовки коррекции.");
  });

  var updates = [], appends = [];
  Object.keys(afterById).forEach(function (id) {
    var current = currentById[id];
    if (!current) { appends.push(afterById[id]); return; }
    if (di3SupplyCorrectionRowEquals_(current.values, afterById[id])) return;
    if (beforeById[id] && di3SupplyCorrectionRowEquals_(current.values, beforeById[id])) {
      updates.push({ row_number: current.row_number, values: afterById[id] });
      return;
    }
    throw new Error("V3_SupplyItems " + id + " отличается от source и target snapshots.");
  });
  if (updates.length) di3ApplyContiguousRowUpdates_("V3_SupplyItems", updates);
  if (appends.length) di3AppendTableRows_("V3_SupplyItems", appends);

  var deleteRows = [];
  Object.keys(beforeById).forEach(function (id) {
    if (afterById[id]) return;
    var current = di3FindRowByFirstColumn_("V3_SupplyItems", id);
    if (!current) return;
    if (!di3SupplyCorrectionRowEquals_(current.values, beforeById[id])) {
      throw new Error("Удаляемая строка V3_SupplyItems " + id + " изменилась после подготовки коррекции.");
    }
    deleteRows.push(Number(current.row_number));
  });
  deleteRows.sort(function (a, b) { return b - a; }).forEach(function (rowNumber) {
    di3GetSheetOrThrow_("V3_SupplyItems").deleteRow(rowNumber);
  });

  var finalSupply = di3GetSupplyById_(supplyId);
  if (!finalSupply || !di3SupplyCorrectionRowEquals_(
    di3SupplyCorrectionRowFromRecord_("V3_Supplies", finalSupply), afterSupply)) {
    throw new Error("Не удалось подтвердить target row V3_Supplies после коррекции.");
  }
  var finalItems = di3GetSupplyItems_(supplyId);
  var finalById = Object.create(null);
  finalItems.forEach(function (item) { finalById[String(item.supply_item_id)] = item; });
  if (finalItems.length !== Object.keys(afterById).length) throw new Error("Количество строк V3_SupplyItems не совпадает с target snapshot.");
  Object.keys(afterById).forEach(function (id) {
    if (!finalById[id] || !di3SupplyCorrectionRowEquals_(
      di3SupplyCorrectionRowFromRecord_("V3_SupplyItems", finalById[id]), afterById[id])) {
      throw new Error("Не подтверждена target строка V3_SupplyItems " + id + ".");
    }
  });
  return { supply_id: supplyId, item_rows: finalItems.length };
}

function di3AssertSupplyCorrectionImmutableSource_(operationId, payload) {
  var receipt = di3FindRowByFirstColumn_("Operations", String(payload.source_receipt_operation_id));
  if (!receipt || String(receipt.values[2]) !== "SUPPLY_RECEIVE" ||
      String(receipt.values[3]) !== "SUPPLY" || String(receipt.values[4]) !== String(payload.supply_id) ||
      String(receipt.values[5]) !== "COMMITTED" ||
      String(receipt.values[6]) !== String(payload.source_receipt_payload_hash)) {
    throw new Error("Исходная операция SUPPLY_RECEIVE изменилась или больше не COMMITTED.");
  }
  var receiptPayloadRecord = di3FindRowByFirstColumn_("OperationPayloads", String(payload.source_receipt_operation_id));
  if (!receiptPayloadRecord) throw new Error("Не найден immutable payload исходной приёмки.");
  var receiptPayload = JSON.parse(String(receiptPayloadRecord.values[1] || ""));
  if (di3BuildOperationPayloadHash_("SUPPLY_RECEIVE", receiptPayload) !== String(receipt.values[6])) {
    throw new Error("Хэш исходной приёмки не прошёл повторную проверку.");
  }
  if (String(receiptPayload.supply_id) !== String(payload.supply_id)) throw new Error("Исходный receipt payload принадлежит другой поставке.");

  var sourceLines = payload.source_lines || [];
  if (!sourceLines.length || sourceLines.length !== (receiptPayload.lines || []).length) {
    throw new Error("Source snapshot не совпадает по количеству строк с immutable receipt payload.");
  }
  var receiptLineByMovement = Object.create(null);
  (receiptPayload.lines || []).forEach(function (line) {
    var movementId = String(line.movement_id || "");
    if (!movementId || receiptLineByMovement[movementId]) throw new Error("В исходном receipt payload повторяется movement_id.");
    receiptLineByMovement[movementId] = line;
  });
  sourceLines.forEach(function (line) {
    var original = receiptLineByMovement[String(line.movement_id)];
    if (!original || String(original.supply_item_id) !== String(line.supply_item_id) ||
        String(original.lot_id) !== String(line.lot_id) ||
        String(original.product_id) !== String(line.product_id) ||
        String(original.pack_variant_id) !== String(line.pack_variant_id) ||
        Number(original.quantity) !== Number(line.quantity) ||
        Number(original.unit_cost) !== Number(line.unit_cost) ||
        Number(original.total_cost_minor) !== Number(line.total_cost_minor) ||
        String(original.event_key) !== String(line.event_key) ||
        new Date(original.effective_at).getTime() !== new Date(line.effective_at).getTime() ||
        new Date(original.recorded_at).getTime() !== new Date(line.recorded_at).getTime()) {
      throw new Error("Source line " + line.movement_id + " не совпадает с immutable receipt payload.");
    }
  });
  var beforeItemById = Object.create(null);
  (payload.before_item_rows || []).forEach(function (row) {
    var itemId = String(row[0] || "");
    if (!itemId || beforeItemById[itemId]) throw new Error("before_item_rows содержит пустой или повторный supply_item_id.");
    beforeItemById[itemId] = row;
  });
  sourceLines.forEach(function (line) {
    var item = beforeItemById[String(line.supply_item_id)];
    if (!item || String(item[1]) !== String(payload.supply_id) ||
        String(item[3]) !== String(line.product_id) ||
        String(item[5]) !== String(line.pack_variant_id) ||
        Number(item[6]) !== Number(receiptLineByMovement[String(line.movement_id)].units_per_pack) ||
        Number(item[7]) * Number(item[6]) !== Number(line.quantity) ||
        Number(item[14]) !== Number(line.quantity) ||
        Number(item[13]) !== Number(line.cost_per_pack) ||
        Number(item[16]) !== Number(line.unit_cost) ||
        di3MoneyToMinorUnits_(Number(item[15]), "before_item_rows.final_line_amount", false) !== Number(line.total_cost_minor)) {
      throw new Error("before_item_rows не совпадает с исходной receipt line " + line.supply_item_id + ".");
    }
  });
  var expectedSupplyFingerprint = di3SupplyFullEditHash_({
    supply_row: (payload.before_supply_row || []).map(di3SupplyFullEditNormalizeValue_),
    item_rows: (payload.before_item_rows || []).map(function (row) { return row.map(di3SupplyFullEditNormalizeValue_); }),
    source_map_fingerprint: String(payload.source_receipt_fingerprint || "")
  });
  if (expectedSupplyFingerprint !== String(payload.source_supply_fingerprint || "")) {
    throw new Error("Source supply fingerprint не совпадает с immutable before snapshot.");
  }
  var movementIds = sourceLines.map(function (line) { return String(line.movement_id); });
  var ledgerMatches = movementIds.length ? di3ReadRowsByColumnValues_("StockLedger", 0, movementIds) : [];
  var detailMatches = movementIds.length ? di3ReadRowsByColumnValues_("StockMovementDetails", 0, movementIds) : [];
  var lotMatches = movementIds.length ? di3ReadRowsByColumnValues_("StockLots", 2, movementIds) : [];
  var allSupplyLedger = di3ReadRowsByColumnValue_("StockLedger", 5, String(payload.supply_id)).filter(function (match) {
    return String(match.values[1]) === String(payload.source_receipt_operation_id);
  });
  if (allSupplyLedger.length !== sourceLines.length) throw new Error("Исходная операция содержит лишние или отсутствующие StockLedger движения.");
  if (ledgerMatches.length !== sourceLines.length || detailMatches.length !== sourceLines.length || lotMatches.length !== sourceLines.length) {
    throw new Error("Исходные StockLedger/StockMovementDetails/StockLots строки неполны.");
  }
  var ledgerById = Object.create(null), detailById = Object.create(null), lotByMovement = Object.create(null);
  ledgerMatches.forEach(function (m) { ledgerById[String(m.values[0])] = m.values; });
  detailMatches.forEach(function (m) { detailById[String(m.values[0])] = m.values; });
  lotMatches.forEach(function (m) { lotByMovement[String(m.values[2])] = m.values; });
  sourceLines.forEach(function (line) {
    var ledger = ledgerById[String(line.movement_id)];
    var detail = detailById[String(line.movement_id)];
    var lot = lotByMovement[String(line.movement_id)];
    if (!ledger || !detail || !lot) throw new Error("Не найдено исходное движение " + line.movement_id + ".");
    if (String(ledger[1]) !== String(payload.source_receipt_operation_id) ||
        String(ledger[2]) !== String(line.event_key) || String(ledger[3]) !== String(line.product_id) ||
        String(ledger[4]) !== "SUPPLY" || String(ledger[5]) !== String(payload.supply_id) ||
        Number(ledger[6]) !== Number(line.quantity) ||
        new Date(ledger[7]).getTime() !== new Date(line.effective_at).getTime() ||
        new Date(ledger[8]).getTime() !== new Date(line.recorded_at).getTime() ||
        Number(ledger[12]) !== Number(line.ledger_sequence)) {
      throw new Error("Исходный StockLedger " + line.movement_id + " отличается от receipt snapshot.");
    }
    if (String(detail[2]) !== "IN" || String(detail[3]) !== "SUPPLY_RECEIVE" ||
        String(detail[6]) !== String(line.cost_status) || String(detail[10]) !== "SUPPLY") {
      throw new Error("Исходный StockMovementDetails " + line.movement_id + " отличается от receipt snapshot.");
    }
    if (String(lot[0]) !== String(line.lot_id) || String(lot[1]) !== String(line.product_id) ||
        String(lot[2]) !== String(line.movement_id) || String(lot[3]) !== "SUPPLY" ||
        String(lot[4]) !== String(payload.supply_id) || String(lot[5]) !== String(line.pack_variant_id) ||
        Number(lot[8]) !== Number(line.initial_quantity) || Number(lot[9]) !== Number(line.unit_cost) ||
        String(lot[10]) !== String(line.cost_status) || Number(lot[14]) !== Number(line.total_cost_minor) ||
        new Date(lot[6]).getTime() !== new Date(line.effective_at).getTime() ||
        new Date(lot[7]).getTime() !== new Date(line.recorded_at).getTime()) {
      throw new Error("Исходный StockLots " + line.lot_id + " отличается от immutable receipt snapshot.");
    }
  });
  return true;
}

function di3ApplySupplyCorrectionOperation_(operationRecord, payload) {
  var operationId = String(operationRecord.values[0] || "");
  if (!payload || Number(payload.schema_version) !== 1 ||
      String(payload.supply_id || "") !== String(operationRecord.values[4] || "") ||
      !payload.correction_id || !Array.isArray(payload.relations) ||
      !Array.isArray(payload.replacement_lines) || !Array.isArray(payload.after_item_rows)) {
    throw new Error("Некорректный immutable payload SUPPLY_CORRECTION.");
  }
  if (String(operationRecord.values[2]) !== "SUPPLY_CORRECTION" ||
      String(operationRecord.values[3]) !== "SUPPLY" ||
      String(operationRecord.values[1]) !== "SUPPLY_CORRECTION:" + String(payload.supply_id) + ":" + String(payload.correction_id)) {
    throw new Error("Операция не соответствует SUPPLY_CORRECTION/SUPPLY или ключу идемпотентности.");
  }
  var variantIndex = di3LoadPackVariantIndex_();
  payload.replacement_lines.forEach(function (line, index) {
    var variant = variantIndex.byId[String(line.pack_variant_id)];
    if (!variant || String(variant.product_id) !== String(line.product_id) ||
        Number(variant.units_per_pack) !== Number(line.units_per_pack)) {
      throw new Error("Replacement line " + (index + 1) + ": pack variant больше не соответствует immutable payload.");
    }
  });

  di3AssertSupplyCorrectionImmutableSource_(operationId, payload);
  var replacementWrite = di3EnsureSupplyCorrectionSourceRows_(operationId, payload);
  di3EnsureSupplyCorrectionRelationStage_(payload.relations, operationId, "PREPARED");
  var document = di3ApplySupplyCorrectionDocumentProjection_(payload);

  // The relation is candidate-visible only to this pending operation. The
  // normal FIFO engine uses its F-06 archive protocol and full replay because
  // the relation fingerprint changed, including products affected by REMOVE.
  var fifo = di3RebuildFifoAllocations_("SUPPLY_CORRECTION", payload.affected_product_ids, {
    operation_id: operationId
  });
  if (!fifo || !fifo.run_id || !fifo.mode) throw new Error("Не подтверждён результат candidate FIFO replay.");
  // Cost history becomes visible only after the new FIFO allocation projection
  // has been durably committed; stable source keys make this retry-safe.
  var costHistoryAdded = di3EnsureSupplyCorrectionCostHistory_(payload);
  di3EnsureSupplyCorrectionRelationStage_(payload.relations, operationId, "COMMITTED");

  var committedMap = di3ReadSupplyCorrectionEffectiveMovementMap_(operationId);
  if (committedMap.relations.filter(function (relation) {
    return String(relation.operation_id) === operationId;
  }).length !== payload.relations.length) {
    throw new Error("Не все relation events стали частью candidate effective movement map.");
  }
  di3SetAppMetaValue_("fifo_supply_correction_fingerprint", committedMap.fingerprint);
  di3RefreshSupplyRegister();
  di3RefreshSupplyFormValidations();
  return {
    status: "COMMITTED",
    supply_id: String(payload.supply_id),
    supply_number: String(payload.supply_number),
    correction_id: String(payload.correction_id),
    replacement_lines: payload.replacement_lines.length,
    replacement_movements_created: replacementWrite.ledger_added,
    replacement_lots_created: replacementWrite.lots_added,
    document_item_rows: document.item_rows,
    cost_history_added: costHistoryAdded,
    fifo_run_id: fifo.run_id,
    fifo_mode: fifo.mode,
    affected_product_ids: payload.affected_product_ids.slice()
  };
}

/**
 * Read-only correction preview. It runs the exact candidate FIFO calculation
 * but does not register an operation or write any workbook sheet.
 */
function di3PreviewSupplyCorrection(supplyId, correctionSpec) {
  return di3WithLock_(function () {
    var id = String(supplyId || "").trim();
    var spec = correctionSpec || {};
    var correctionId = String(spec.correction_id || "").trim();
    if (!id || !correctionId) throw new Error("Укажи supply_id и стабильный correction_id.");
    var idempotencyKey = "SUPPLY_CORRECTION:" + id + ":" + correctionId;
    var requestFingerprint = di3BuildSupplyCorrectionRequestFingerprint_(id, spec);
    var existing = di3FindRowByColumnValue_("Operations", 1, idempotencyKey);
    if (existing) {
      var saved = di3ReadVerifiedOperationPayload_(existing);
      if (String(saved.request_fingerprint || "") !== requestFingerprint) {
        throw new Error("Этот correction_id уже использован с другим набором исправлений.");
      }
      return {
        status: String(existing.values[5]) === "COMMITTED" ? "ALREADY_COMMITTED" : "RESUME_AVAILABLE",
        read_only: true,
        operation_id: String(existing.values[0]),
        correction_id: correctionId,
        candidate_fifo_preview: saved.candidate_fifo_preview || null,
        affected_product_ids: saved.affected_product_ids || [],
        replacement_lines: (saved.replacement_lines || []).length
      };
    }
    di3AssertNoOtherPendingStockOperations_(idempotencyKey);
    var sourceAudit = di3AuditSupplyCorrectionSource(id);
    if (sourceAudit.status !== "READY") throw new Error("Source audit blocked: " + String(sourceAudit.reason || "unknown"));
    var previewOperationId = "PREVIEW-" + di3MakeUuid_();
    var payload = di3BuildSupplyCorrectionOperationPayload_(id, spec, sourceAudit, previewOperationId);
    return {
      status: "READY",
      read_only: true,
      correction_id: correctionId,
      supply_id: id,
      supply_number: payload.supply_number,
      reason: payload.reason,
      financials: {
        goods_amount: payload.after_supply_row[8],
        seller_discount_amount: payload.after_supply_row[9],
        partner_discount_amount: payload.after_supply_row[10],
        discount_total: payload.after_supply_row[11],
        shipping_amount: payload.after_supply_row[12],
        final_amount: payload.after_supply_row[13],
        currency: payload.currency
      },
      source_fingerprint: payload.source_supply_fingerprint,
      candidate_fifo_input_fingerprint: payload.candidate_fifo_input_fingerprint,
      candidate_fifo_preview: payload.candidate_fifo_preview,
      affected_product_ids: payload.affected_product_ids,
      relations: payload.relations.map(function (relation) {
        return {
          relation_type: relation.relation_type,
          source_movement_id: relation.source_movement_id,
          replacement_movement_id: relation.replacement_movement_id,
          source_product_id: relation.source_product_id,
          replacement_product_id: relation.replacement_product_id
        };
      }),
      replacement_lines: payload.replacement_lines.map(function (line) {
        return {
          product_id: line.product_id, product_label: line.product_label,
          pack_variant_id: line.pack_variant_id, units_per_pack: line.units_per_pack,
          packs: line.packs, quantity: line.quantity, cost_per_pack: line.cost_per_pack,
          unit_cost: line.unit_cost, total_cost_minor: line.total_cost_minor
        };
      })
    };
  });
}

/**
 * Explicit correction command. Call only after reviewing the read-only preview.
 * Repeating the same correction_id and exact request resumes its immutable op.
 */
function di3CorrectReceivedSupply(supplyId, correctionSpec) {
  return di3WithLock_(function () {
    var id = String(supplyId || "").trim();
    var spec = correctionSpec || {};
    var correctionId = String(spec.correction_id || "").trim();
    if (!id || !correctionId) throw new Error("Укажи supply_id и стабильный correction_id.");
    var idempotencyKey = "SUPPLY_CORRECTION:" + id + ":" + correctionId;
    var requestFingerprint = di3BuildSupplyCorrectionRequestFingerprint_(id, spec);
    var existing = di3FindRowByColumnValue_("Operations", 1, idempotencyKey);
    if (existing) {
      var savedPayload = di3ReadVerifiedOperationPayload_(existing);
      if (String(savedPayload.request_fingerprint || "") !== requestFingerprint) {
        throw new Error("Этот correction_id уже использован с другим набором исправлений. Создай новый correction_id.");
      }
      if (["PREPARED", "RETRYABLE"].indexOf(String(existing.values[5])) !== -1) {
        di3AssertNoOtherPendingStockOperations_(idempotencyKey);
      }
      return di3ExecutePreparedOperation_(existing);
    }
    di3AssertNoOtherPendingStockOperations_(idempotencyKey);
    var sourceAudit = di3AuditSupplyCorrectionSource(id);
    if (sourceAudit.status !== "READY") throw new Error("Source audit blocked: " + String(sourceAudit.reason || "unknown"));
    var operationId = di3MakeUuid_();
    var payload = di3BuildSupplyCorrectionOperationPayload_(id, spec, sourceAudit, operationId);
    if (String(payload.request_fingerprint) !== requestFingerprint) {
      throw new Error("Request fingerprint изменился во время подготовки коррекции.");
    }
    var operation = di3RegisterPreparedOperation_({
      idempotency_key: idempotencyKey,
      operation_type: "SUPPLY_CORRECTION",
      document_type: "SUPPLY",
      document_id: id,
      payload: payload
    });
    di3EnsureSupplyCorrectionRelationStage_(payload.relations, String(operation.values[0]), "PREPARED");
    return di3ExecutePreparedOperation_(operation);
  });
}
