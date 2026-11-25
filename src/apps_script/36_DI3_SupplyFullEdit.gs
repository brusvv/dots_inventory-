/**
 * Dots Inventory v3 — controlled full supply document editing.
 * Phase B supports all document fields before receipt and safe metadata edits
 * after receipt. Stock-affecting changes on received supplies are fail-closed
 * until SUPPLY_CORRECTION/FIFO replay is implemented and runtime-accepted.
 */

var DI3_SUPPLY_FULL_EDIT_MODE_VALUE = "FULL_EDIT";
var DI3_SUPPLY_FULL_EDIT_ALLOWED_STATUSES = Object.freeze([
  DI3_SUPPLY_STATUS.CREATED,
  DI3_SUPPLY_STATUS.SENT,
  DI3_SUPPLY_STATUS.AWAITING,
  DI3_SUPPLY_STATUS.RECEIVED
]);

function di3SupplyFullEditNormalizeValue_(value) {
  if (value instanceof Date) {
    if (isNaN(value.getTime())) return "";
    return value.toISOString();
  }
  if (value === undefined || value === null) return "";
  if (typeof value === "number") return Number.isFinite(value) ? value : String(value);
  if (typeof value === "boolean") return value;
  return String(value);
}

function di3SupplyFullEditHash_(value) {
  var canonical = JSON.stringify(value);
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, canonical, Utilities.Charset.UTF_8);
  return bytes.map(function (byte) {
    return (byte < 0 ? byte + 256 : byte).toString(16).padStart(2, "0");
  }).join("");
}

/** Read-only authoritative snapshot. It does not create sheets, operations or rows. */
function di3BuildSupplyFullEditSnapshot_(supplyId) {
  var id = String(supplyId || "").trim();
  if (!id) throw new Error("Для аудита полного редактирования требуется supply_id.");
  var supply = di3GetSupplyById_(id);
  if (!supply) throw new Error("Поставка не найдена по supply_id " + id + ".");
  var items = di3GetSupplyItems_(id);
  var receiptOperation = di3GetSupplyReceiptOperation_(id);
  var receiptPayload = null;
  var receiptPayloadIntegrity = "NOT_APPLICABLE";
  if (receiptOperation && ["PREPARED", "RETRYABLE", "COMMITTED", "QUARANTINED", "REJECTED"].indexOf(String(receiptOperation.values[5])) !== -1) {
    // This snapshot is a strict read-only audit. Do not call
    // the operation verifier here: that helper quarantines a damaged
    // operation and therefore has a write side effect. Inspect raw payload/hash
    // and report integrity without changing Operations.
    var rawPayloadRecord = di3FindRowByFirstColumn_("OperationPayloads", String(receiptOperation.values[0]));
    if (!rawPayloadRecord) {
      receiptPayloadIntegrity = "MISSING";
    } else {
      try {
        receiptPayload = JSON.parse(String(rawPayloadRecord.values[1] || ""));
        var actualReceiptHash = di3BuildOperationPayloadHash_(String(receiptOperation.values[2]), receiptPayload);
        receiptPayloadIntegrity = actualReceiptHash === String(receiptOperation.values[6] || "") ? "VALID" : "HASH_MISMATCH";
      } catch (payloadReadError) {
        receiptPayload = null;
        receiptPayloadIntegrity = "INVALID_JSON_OR_HASH_ERROR";
      }
    }
  }
  var ledgerMatches = di3ReadRowsByColumnValue_("StockLedger", 5, id);
  var movementIds = ledgerMatches.map(function (match) { return String(match.values[0]); });
  var detailsById = Object.create(null);
  if (movementIds.length) {
    di3ReadRowsByColumnValues_("StockMovementDetails", 0, movementIds).forEach(function (match) {
      detailsById[String(match.values[0])] = match.values;
    });
  }
  var lots = di3ReadRowsByColumnValue_("StockLots", 4, id).map(function (match) { return match.values; });
  var lotIds = Object.create(null);
  lots.forEach(function (row) { lotIds[String(row[0])] = true; });
  var allocations = Object.keys(lotIds).length
    ? di3ReadRowsByColumnValues_("StockAllocations", 3, Object.keys(lotIds)).map(function (match) { return match.values; })
    : [];
  var costHistory = di3ReadTableValues_("ProductCostHistory").filter(function (row) {
    return String(row[7] || "").indexOf("SUPPLY_RECEIPT:" + id + ":") === 0;
  });
  var supplyData = DI3_TABLE_SCHEMAS.V3_Supplies.map(function (header) {
    return di3SupplyFullEditNormalizeValue_(supply[header]);
  });
  var itemData = items.map(function (item) {
    return DI3_TABLE_SCHEMAS.V3_SupplyItems.map(function (header) {
      return di3SupplyFullEditNormalizeValue_(item[header]);
    });
  });
  return {
    mode: "READ_ONLY",
    supply_id: id,
    supply_number: String(supply.supply_number || ""),
    status: di3NormalizeSupplyStatus_(supply.status),
    supply_row_number: Number(supply.row_number),
    supply_data: supplyData,
    items: itemData,
    receipt_operation: receiptOperation ? {
      operation_id: String(receiptOperation.values[0]),
      idempotency_key: String(receiptOperation.values[1]),
      status: String(receiptOperation.values[5]),
      payload_hash: String(receiptOperation.values[6]),
      payload_integrity: receiptPayloadIntegrity,
      payload: receiptPayload
    } : null,
    stock_ledger: ledgerMatches.map(function (match) {
      return { row_number: match.row_number, values: match.values, detail: detailsById[String(match.values[0])] || null };
    }),
    stock_lots: lots,
    stock_allocations: allocations,
    product_cost_history: costHistory,
    counts: {
      supply_items: items.length,
      ledger_movements: ledgerMatches.length,
      fifo_lots: lots.length,
      fifo_allocations: allocations.length,
      cost_history_rows: costHistory.length
    },
    fingerprint: di3SupplyFullEditHash_({ supply: supplyData, items: itemData })
  };
}

/** Read-only entry point for the Phase A audit. */
function di3AuditSupplyForFullEdit(supplyId) {
  var id = String(supplyId || "").trim();
  if (!id) {
    var form = di3GetSheetOrThrow_(DI3_SUPPLY_FORM_SHEET);
    id = String(form.getRange(DI3_SUPPLY_FORM.editSupplyId).getValue() || "").trim();
  }
  return di3BuildSupplyFullEditSnapshot_(id);
}

function di3GetSupplyFullEditContext_() {
  var sheet = di3GetSheetOrThrow_(DI3_SUPPLY_FORM_SHEET);
  var mode = String(sheet.getRange(DI3_SUPPLY_FORM.fullEditMode).getValue() || "");
  if (mode !== DI3_SUPPLY_FULL_EDIT_MODE_VALUE) {
    throw new Error("Полное редактирование не включено. Сначала выбери «Включить полное редактирование».");
  }
  var supplyId = String(sheet.getRange(DI3_SUPPLY_FORM.editSupplyId).getValue() || "").trim();
  if (!supplyId) throw new Error("В форме нет загруженной поставки. Выбери её в B2 и загрузи.");
  var supply = di3GetSupplyById_(supplyId);
  if (!supply) throw new Error("Загруженная поставка больше не существует. Повторно выбери документ в B2.");
  var selectedNumber = String(sheet.getRange(DI3_SUPPLY_FORM.selector).getValue() || "").trim();
  var formNumber = String(sheet.getRange(DI3_SUPPLY_FORM.number).getValue() || "").trim();
  if (selectedNumber !== String(supply.supply_number) || formNumber !== String(supply.supply_number)) {
    throw new Error("Номер в B2/B3 не совпадает с загруженным supply_id. Повторно загрузи поставку.");
  }
  var revisionId = String(sheet.getRange(DI3_SUPPLY_FORM.fullEditRevisionId).getValue() || "").trim();
  var baseline = String(sheet.getRange(DI3_SUPPLY_FORM.fullEditBaselineHash).getValue() || "").trim();
  if (!revisionId || !baseline) throw new Error("Не сохранён контрольный снимок режима. Выключи и включи полное редактирование заново.");
  return { sheet: sheet, supply: supply, supply_id: supplyId, revision_id: revisionId, baseline_hash: baseline };
}

function di3EnableFullSupplyEditMode() {
  return di3WithLock_(function () {
    var sheet = di3GetSheetOrThrow_(DI3_SUPPLY_FORM_SHEET);
    if (String(sheet.getRange(DI3_SUPPLY_FORM.historicalMode).getValue() || "") === DI3_HISTORICAL_SUPPLY_MODE_VALUE) {
      throw new Error("Сначала заверши или отмени режим «Внести старую поставку». Полное редактирование и исторический ввод взаимоисключают друг друга.");
    }
    if (String(sheet.getRange(DI3_SUPPLY_FORM.fullEditMode).getValue() || "") === DI3_SUPPLY_FULL_EDIT_MODE_VALUE) {
      throw new Error("Полное редактирование уже включено. Продолжай текущую корректировку или отмени её перед повторным запуском команды.");
    }
    var supplyId = String(sheet.getRange(DI3_SUPPLY_FORM.editSupplyId).getValue() || "").trim();
    if (!supplyId) throw new Error("Сначала выбери поставку в B2 и дождись её загрузки.");
    var supply = di3GetSupplyById_(supplyId);
    if (!supply) throw new Error("Поставка не найдена. Обнови список и загрузи её повторно.");
    var status = di3NormalizeSupplyStatus_(supply.status);
    if (status === DI3_SUPPLY_STATUS.CANCELLED) {
      throw new Error("Отменённую поставку нельзя редактировать напрямую. Сначала требуется отдельная процедура восстановления.");
    }
    if (DI3_SUPPLY_FULL_EDIT_ALLOWED_STATUSES.indexOf(status) === -1) {
      throw new Error("Полное редактирование не поддерживает неизвестный статус: " + String(supply.status));
    }
    var receipt = di3GetSupplyReceiptOperation_(supplyId);
    if (status === DI3_SUPPLY_STATUS.RECEIVED && (!receipt || String(receipt.values[5]) !== "COMMITTED")) {
      throw new Error("Статус «Получена» не подтверждён завершённой операцией SUPPLY_RECEIVE. Сначала нужна сверка журнала Operations.");
    }
    if (receipt && ["PREPARED", "RETRYABLE", "QUARANTINED", "REJECTED"].indexOf(String(receipt.values[5])) !== -1) {
      throw new Error("По поставке существует операция приёмки в состоянии " + String(receipt.values[5]) + ". Сначала разберись с ней в журнале операций.");
    }
    var snapshot = di3BuildSupplyFullEditSnapshot_(supplyId);
    if (status === DI3_SUPPLY_STATUS.RECEIVED &&
        (!snapshot.receipt_operation || snapshot.receipt_operation.status !== "COMMITTED" || snapshot.receipt_operation.payload_integrity !== "VALID")) {
      throw new Error("Для полученной поставки не удалось подтвердить целостность исходного payload SUPPLY_RECEIVE. Полное редактирование остановлено без изменений.");
    }
    sheet.getRange(DI3_SUPPLY_FORM.fullEditMode).setValue(DI3_SUPPLY_FULL_EDIT_MODE_VALUE);
    sheet.getRange(DI3_SUPPLY_FORM.fullEditBaselineHash).setValue(snapshot.fingerprint);
    sheet.getRange(DI3_SUPPLY_FORM.fullEditRevisionId).setValue(di3MakeUuid_());
    sheet.getRange(DI3_SUPPLY_FORM.fullEditRecalculateNumber).setValue(false);
    sheet.getRange("L9").setValue("Причина корректировки");
    sheet.getRange("M9").clearContent().setNote("Обязательно укажи причину изменения поставки. Она попадёт в неизменяемый payload операции.");
    sheet.getRange("M2").setValue("ПОЛНОЕ РЕДАКТИРОВАНИЕ · " + supply.supply_number + " · " + di3GetSupplyStatusLabel_(supply.status));
    sheet.getRange("G4:G7").setNumberFormat("dd.mm.yyyy hh:mm");
    di3ApplySupplyStageInputState_(sheet, supply, null);
    sheet.getRange("B3").setNote("Номер поставки защищён. Для смены номера используй отдельное действие пересчёта по G2; прямое редактирование запрещено.");
    return { status: "READY", supply_id: supplyId, supply_number: supply.supply_number, document_status: status, baseline_fingerprint: snapshot.fingerprint, stock_impact_policy: status === DI3_SUPPLY_STATUS.RECEIVED ? "STOCK_IMPACTING_CHANGES_REQUIRE_SUPPLY_CORRECTION" : "NO_RECEIPT_POSTED" };
  });
}

function di3EndFullSupplyEditMode(reload) {
  var sheet = di3GetSheetOrThrow_(DI3_SUPPLY_FORM_SHEET);
  var supplyId = String(sheet.getRange(DI3_SUPPLY_FORM.editSupplyId).getValue() || "").trim();
  var number = String(sheet.getRange(DI3_SUPPLY_FORM.selector).getValue() || "").trim();
  sheet.getRange("N4:N7").clearContent();
  sheet.getRange("M9").clearContent();
  if (reload !== false && supplyId) {
    var current = di3GetSupplyById_(supplyId);
    if (current) {
      sheet.getRange(DI3_SUPPLY_FORM.selector).setValue(current.supply_number);
      sheet.getRange(DI3_SUPPLY_FORM.number).setValue(current.supply_number);
      return di3LoadSelectedSupplyDraft({ skipUnsavedConfirmation: true });
    }
  }
  var supply = number ? di3FindSupplyByNumber_(number) : null;
  di3RefreshSupplyDatePanel_(supply || null);
  return { status: "ENDED" };
}

function di3CancelFullSupplyEditMode() {
  var result = di3EndFullSupplyEditMode(true);
  di3GetSpreadsheet_().toast("Изменения не сохранены; загружены данные из базы", "Поставки", 5);
  return result;
}

function di3ParseSupplyFullEditInput_(sheet) {
  var fields = sheet.getRange("B4:B8").getValues().map(function (row) { return row[0]; });
  var dates = sheet.getRange("G2:G7").getValues().map(function (row) { return row[0]; });
  var orderDate = di3ParseSupplyCalendarDate_(dates[0], "Дата заказа в магазине");
  var expectedDate = di3ParseSupplyCalendarDate_(dates[1], "Ожидаемая дата прибытия");
  di3ValidateSupplyPlanningDates_(orderDate, expectedDate);
  var sentAt = dates[3] === "" || dates[3] == null ? null : di3ParseSupplyEffectiveDate_(dates[3], null);
  var awaitingAt = dates[4] === "" || dates[4] == null ? null : di3ParseSupplyEffectiveDate_(dates[4], null);
  var receivedAt = dates[5] === "" || dates[5] == null ? null : di3ParseSupplyEffectiveDate_(dates[5], null);
  di3ValidateSupplyFullEditDates_({
    order_date: orderDate, expected_date: expectedDate, sent_at: sentAt,
    awaiting_at: awaitingAt, received_at: receivedAt
  });
  var sellerDiscount = fields[1] === "" || fields[1] == null ? 0 : fields[1];
  var partnerDiscount = fields[2] === "" || fields[2] == null ? 0 : fields[2];
  var shipping = fields[3] === "" || fields[3] == null ? 0 : fields[3];
  return {
    supplier: di3NormalizeText_(fields[0]),
    seller_discount_amount: sellerDiscount,
    partner_discount_amount: partnerDiscount,
    shipping_amount: shipping,
    notes: di3NormalizeText_(fields[4]),
    supplier_order_date: orderDate || "",
    expected_received_date: expectedDate || "",
    sent_at: sentAt || "",
    awaiting_at: awaitingAt || "",
    received_at: receivedAt || ""
  };
}


/** Pure chronology validation shared by the form and the regression suite. */
function di3ValidateSupplyFullEditDates_(input, nowMillis) {
  input = input || {};
  var orderDate = input.order_date ? di3ParseSupplyCalendarDate_(input.order_date, "Дата заказа в магазине") : null;
  var expectedDate = input.expected_date ? di3ParseSupplyCalendarDate_(input.expected_date, "Ожидаемая дата прибытия") : null;
  di3ValidateSupplyPlanningDates_(orderDate, expectedDate);
  var sentAt = input.sent_at ? di3ParseSupplyEffectiveDate_(input.sent_at, null) : null;
  var awaitingAt = input.awaiting_at ? di3ParseSupplyEffectiveDate_(input.awaiting_at, null) : null;
  var receivedAt = input.received_at ? di3ParseSupplyEffectiveDate_(input.received_at, null) : null;
  var now = Number.isFinite(Number(nowMillis)) ? Number(nowMillis) : Date.now();
  var nowLimit = now + 5 * 60 * 1000;
  [sentAt, awaitingAt, receivedAt].forEach(function (date, index) {
    if (date && date.getTime() > nowLimit) {
      throw new Error(["Дата отправки G5", "Дата ожидания получения G6", "Дата получения G7"][index] + " не может быть в будущем.");
    }
  });
  function dayStart(date) {
    return date ? new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0).getTime() : null;
  }
  if ((awaitingAt || receivedAt) && !sentAt) throw new Error("Нельзя указать G6 или G7 без фактической даты отправки G5.");
  if (receivedAt && !awaitingAt) throw new Error("Нельзя указать G7 без фактической даты «Ожидает получения» G6.");
  if (sentAt && orderDate && sentAt.getTime() < dayStart(orderDate)) throw new Error("Дата отправки G5 не может быть раньше даты заказа G2.");
  if (awaitingAt && sentAt && awaitingAt.getTime() < sentAt.getTime()) throw new Error("Дата ожидания получения G6 не может быть раньше даты отправки G5.");
  if (receivedAt && awaitingAt && receivedAt.getTime() < awaitingAt.getTime()) throw new Error("Дата получения G7 не может быть раньше даты ожидания получения G6.");
  return { order_date: orderDate, expected_date: expectedDate, sent_at: sentAt, awaiting_at: awaitingAt, received_at: receivedAt };
}

function di3BuildSupplyFullEditPlan_(context, createVariants) {
  var input = di3ParseSupplyFullEditInput_(context.sheet);
  var currentStatus = di3NormalizeSupplyStatus_(context.supply.status);
  if (currentStatus === DI3_SUPPLY_STATUS.RECEIVED && !input.received_at) {
    throw new Error("Для полученной поставки нельзя очистить G7 в полном редакторе. Возврат этапа получения требует отдельной складской корректировки.");
  }
  if (currentStatus !== DI3_SUPPLY_STATUS.RECEIVED && input.received_at) {
    throw new Error("Полный редактор не проводит складскую приёмку. Для перехода в «Получена» используй обычную приёмку или режим «Внести старую поставку».");
  }
  if (currentStatus === DI3_SUPPLY_STATUS.SENT && !input.sent_at) {
    // Clearing G5 intentionally rolls a not-yet-received document back to CREATED.
  }
  if (currentStatus === DI3_SUPPLY_STATUS.AWAITING && !input.awaiting_at) {
    // Clearing G6 intentionally rolls the document back to SENT (or CREATED if G5 is also cleared).
  }
  var newStatus = currentStatus === DI3_SUPPLY_STATUS.RECEIVED
    ? DI3_SUPPLY_STATUS.RECEIVED
    : (input.awaiting_at ? DI3_SUPPLY_STATUS.AWAITING : (input.sent_at ? DI3_SUPPLY_STATUS.SENT : DI3_SUPPLY_STATUS.CREATED));

  var rawLines = di3ResolveSupplyFormLines_(false);
  if (!rawLines.length) throw new Error("Добавь хотя бы одну товарную позицию.");
  var seen = Object.create(null);
  rawLines.forEach(function (line, index) {
    var key = di3SupplyLineIdentityKey_(line);
    if (seen[key]) throw new Error("Позиции " + seen[key] + " и " + (index + 1) + " повторяют товар и фасовку.");
    seen[key] = index + 1;
  });
  var plan = di3BuildSupplyFinancialPlan_({
    lines: rawLines,
    seller_discount_amount: input.seller_discount_amount,
    partner_discount_amount: input.partner_discount_amount,
    shipping_amount: input.shipping_amount
  });
  if (createVariants) {
    rawLines = di3ResolveSupplyFormLines_(true);
    plan = di3BuildSupplyFinancialPlan_({
      lines: rawLines,
      seller_discount_amount: input.seller_discount_amount,
      partner_discount_amount: input.partner_discount_amount,
      shipping_amount: input.shipping_amount
    });
  }
  var oldItems = di3GetSupplyItems_(context.supply_id);
  var oldByKey = Object.create(null);
  oldItems.forEach(function (item) {
    var key = di3SupplyLineIdentityKey_(item);
    if (oldByKey[key]) throw new Error("В сохранённой поставке дублируются товарные строки. Корректировка остановлена.");
    oldByKey[key] = item;
  });
  var retainedIds = Object.create(null);
  var itemRows = plan.lines.map(function (line, index) {
    var old = oldByKey[di3SupplyLineIdentityKey_(line)] || null;
    var row = di3SupplyItemToRow_(context.supply_id, line, index + 1, old);
    retainedIds[String(row[0])] = true;
    return row;
  });
  var removedIds = oldItems.filter(function (item) { return !retainedIds[String(item.supply_item_id)]; })
    .map(function (item) { return String(item.supply_item_id); });
  var oldComparableLines = oldItems.map(function (item) {
    return [String(item.product_id), String(item.pack_variant_id), Number(item.units_per_pack), Number(item.packs), di3ToCents_(item.purchase_price_per_pack, "Закупочная цена")];
  }).sort(function (a, b) { return JSON.stringify(a).localeCompare(JSON.stringify(b)); });
  var newComparableLines = plan.lines.map(function (line) {
    return [String(line.product_id), String(line.pack_variant_id).replace(/^PREVIEW:/, ""), Number(line.units_per_pack), Number(line.packs), di3ToCents_(line.purchase_price_per_pack, "Закупочная цена")];
  }).sort(function (a, b) { return JSON.stringify(a).localeCompare(JSON.stringify(b)); });
  var linesChanged = JSON.stringify(oldComparableLines) !== JSON.stringify(newComparableLines);
  var financialChanged = [
    [di3ToCents_(context.supply.goods_amount, "Старая стоимость товаров"), di3ToCents_(plan.goods_amount, "Стоимость товаров")],
    [di3ToCents_(context.supply.seller_discount_amount, "Старая скидка продавца"), di3ToCents_(plan.seller_discount_amount, "Скидка продавца")],
    [di3ToCents_(context.supply.partner_discount_amount, "Старая скидка партнёров"), di3ToCents_(plan.partner_discount_amount, "Скидка партнёров")],
    [di3ToCents_(context.supply.shipping_amount, "Старая доставка"), di3ToCents_(plan.shipping_amount, "Доставка")],
    [di3ToCents_(context.supply.final_amount, "Старая итоговая сумма"), di3ToCents_(plan.final_amount, "Итоговая сумма")]
  ].some(function (pair) { return pair[0] !== pair[1]; });
  var receivedDateChanged = currentStatus === DI3_SUPPLY_STATUS.RECEIVED &&
    di3ToMillis_(context.supply.received_at) !== (input.received_at ? input.received_at.getTime() : 0);
  var stockSensitiveChanges = linesChanged || financialChanged || receivedDateChanged;
  var stockImpact = currentStatus === DI3_SUPPLY_STATUS.RECEIVED && stockSensitiveChanges;
  if (currentStatus === DI3_SUPPLY_STATUS.RECEIVED && stockSensitiveChanges) {
    throw new Error("Эта поставка уже оприходована. Изменение товаров, количества, закупочных цен, скидок, доставки или G7 требует отдельной операции SUPPLY_CORRECTION с пересчётом FIFO. Поля оставлены в форме; складские данные не изменены.");
  }
  var reason = di3NormalizeText_(context.sheet.getRange("M9").getValue());
  if (!reason) throw new Error("Укажи причину корректировки в M9. Она будет сохранена в аудите операции.");
  var numberInForm = String(context.sheet.getRange(DI3_SUPPLY_FORM.number).getValue() || "").trim();
  var proposedNumber = String(context.sheet.getRange(DI3_SUPPLY_FORM.fullEditRecalculateNumber).getValue() || "").trim();
  var targetNumber = String(context.supply.supply_number);
  if (numberInForm !== targetNumber) throw new Error("Номер поставки защищён от прямого ввода. Используй отдельную команду пересчёта номера по G2.");
  if (proposedNumber) {
    targetNumber = proposedNumber;
    var collision = di3FindSupplyByNumber_(targetNumber);
    if (collision && String(collision.supply_id) !== context.supply_id) throw new Error("Номер " + targetNumber + " уже используется другой поставкой.");
  }
  var headers = DI3_TABLE_SCHEMAS.V3_Supplies;
  var parentRow = headers.map(function (header) { return context.supply[header]; });
  var assign = function (key, value) { parentRow[headers.indexOf(key)] = value; };
  assign("supply_number", targetNumber);
  assign("supplier", input.supplier);
  assign("status", newStatus);
  assign("sent_at", input.sent_at);
  assign("awaiting_at", input.awaiting_at);
  assign("received_at", input.received_at);
  assign("goods_amount", plan.goods_amount);
  assign("seller_discount_amount", plan.seller_discount_amount);
  assign("partner_discount_amount", plan.partner_discount_amount);
  assign("discount_total", plan.discount_total);
  assign("shipping_amount", plan.shipping_amount);
  assign("final_amount", plan.final_amount);
  assign("notes", input.notes);
  assign("updated_at", new Date());
  assign("supplier_order_date", input.supplier_order_date);
  assign("expected_received_date", input.expected_received_date);
  return {
    input: input,
    plan: plan,
    status: newStatus,
    reason: reason,
    stock_impact: stockImpact,
    lines_changed: linesChanged,
    financial_changed: financialChanged,
    received_date_changed: receivedDateChanged,
    supply_row: parentRow,
    supply_row_number: Number(context.supply.row_number),
    item_rows: itemRows,
    removed_item_ids: removedIds,
    item_ids: itemRows.map(function (row) { return String(row[0]); }),
    current_status: currentStatus,
    target_number: targetNumber,
    number_recalculated: targetNumber !== String(context.supply.supply_number),
    old_snapshot_hash: context.baseline_hash
  };
}

function di3PreviewFullSupplyEdit() {
  var context = di3GetSupplyFullEditContext_();
  var currentSnapshot = di3BuildSupplyFullEditSnapshot_(context.supply_id);
  if (currentSnapshot.fingerprint !== context.baseline_hash) {
    throw new Error("Поставка изменилась после включения режима. Предварительный просмотр остановлен; выключи режим и загрузи актуальную версию.");
  }
  var plan = di3BuildSupplyFullEditPlan_(context, false);
  var currentItems = di3GetSupplyItems_(context.supply_id);
  return {
    status: "PREVIEW_ONLY",
    supply_id: context.supply_id,
    supply_number: context.supply.supply_number,
    current_status: plan.current_status,
    target_status: plan.status,
    lines_before: currentItems.length,
    lines_after: plan.plan.lines.length,
    lines_changed: plan.lines_changed,
    financial_changed: plan.financial_changed,
    stock_impact: plan.stock_impact,
    number_recalculated: plan.number_recalculated,
    proposed_supply_number: plan.target_number,
    final_amount_before: Number(context.supply.final_amount) || 0,
    final_amount_after: plan.plan.final_amount,
    reason: plan.reason,
    received_supply_policy: plan.current_status === DI3_SUPPLY_STATUS.RECEIVED ? "STOCK_IMPACTING_CHANGES_REQUIRE_SUPPLY_CORRECTION" : "NO_RECEIPT_POSTED"
  };
}

function di3RecalculateSupplyNumberInFullEdit() {
  return di3WithLock_(function () {
    var context = di3GetSupplyFullEditContext_();
    var orderDate = di3ParseSupplyCalendarDate_(context.sheet.getRange("G2").getValue(), "Дата заказа в магазине");
    if (!orderDate) throw new Error("Для пересчёта номера нужна дата заказа в G2.");
    var nextNumber = di3PeekSupplyNumberForDate_(orderDate);
    var collision = di3FindSupplyByNumber_(nextNumber);
    if (collision && String(collision.supply_id) !== context.supply_id) {
      throw new Error("Не удалось пересчитать номер: " + nextNumber + " уже используется другой поставкой.");
    }
    context.sheet.getRange(DI3_SUPPLY_FORM.fullEditRecalculateNumber).setValue(nextNumber);
    return { status: "NUMBER_PREVIEW_UPDATED", previous_number: context.supply.supply_number, proposed_number: nextNumber };
  });
}

function di3SupplyFullEditDateFingerprint_(value) {
  return value instanceof Date && !isNaN(value.getTime()) ? value.toISOString() : "";
}

/** Stable fingerprint of editable inputs, independent of rows already partly applied by recovery. */
function di3BuildSupplyFullEditRequestFingerprint_(plan) {
  if (!plan || !plan.input || !plan.plan || !Array.isArray(plan.plan.lines)) {
    throw new Error("Не удалось собрать fingerprint входных данных полного редактирования.");
  }
  var input = plan.input;
  var lines = plan.plan.lines.map(function (line) {
    return {
      product_id: String(line.product_id || ""),
      // A new pack variant gets its permanent ID only during first save.
      // Product + units is the stable business identity across preview/retry.
      units_per_pack: Number(line.units_per_pack),
      packs: Number(line.packs),
      purchase_price_minor: di3ToCents_(line.purchase_price_per_pack, "Закупочная цена")
    };
  });
  return JSON.stringify({
    schema_version: 1,
    supplier: String(input.supplier || ""),
    seller_discount_minor: di3ToCents_(input.seller_discount_amount || 0, "Скидка продавца"),
    partner_discount_minor: di3ToCents_(input.partner_discount_amount || 0, "Скидка партнёров"),
    shipping_minor: di3ToCents_(input.shipping_amount || 0, "Доставка"),
    notes: String(input.notes || ""),
    supplier_order_date: di3SupplyFullEditDateFingerprint_(input.supplier_order_date),
    expected_received_date: di3SupplyFullEditDateFingerprint_(input.expected_received_date),
    sent_at: di3SupplyFullEditDateFingerprint_(input.sent_at),
    awaiting_at: di3SupplyFullEditDateFingerprint_(input.awaiting_at),
    received_at: di3SupplyFullEditDateFingerprint_(input.received_at),
    target_number: String(plan.target_number || ""),
    target_status: String(plan.status || ""),
    reason: String(plan.reason || ""),
    lines: lines
  });
}

function di3BuildSupplyFullEditOperationPayload_(context, plan) {
  return {
    schema_version: 1,
    supply_id: context.supply_id,
    supply_number_before: String(context.supply.supply_number),
    supply_number_after: String(plan.target_number),
    supply_row_number: plan.supply_row_number,
    supply_row: plan.supply_row,
    item_rows: plan.item_rows,
    item_ids: plan.item_ids,
    removed_item_ids: plan.removed_item_ids,
    expected_baseline_hash: context.baseline_hash,
    request_fingerprint: di3BuildSupplyFullEditRequestFingerprint_(plan),
    old_status: plan.current_status,
    new_status: plan.status,
    reason: plan.reason,
    edited_at: new Date().toISOString(),
    edited_by: di3GetActorEmail_(),
    impact: { stock: false, lines_changed: plan.lines_changed, financial_changed: plan.financial_changed, received_date_changed: plan.received_date_changed },
    audit_before: di3BuildSupplyFullEditSnapshot_(context.supply_id),
    audit_after: {
      supply_row: plan.supply_row.map(di3SupplyFullEditNormalizeValue_),
      item_rows: plan.item_rows.map(function (row) { return row.map(di3SupplyFullEditNormalizeValue_); })
    }
  };
}

function di3SaveFullSupplyEdit() {
  return di3WithLock_(function () {
    var context = di3GetSupplyFullEditContext_();
    var idempotencyKey = "SUPPLY_DOCUMENT_EDIT:" + context.supply_id + ":" + context.revision_id;
    var existingOperation = di3FindRowByColumnValue_("Operations", 1, idempotencyKey);
    if (existingOperation) {
      // Never resume an immutable operation blindly: the user may have changed
      // the form after a failed/lost acknowledgement. Rebuild a side-effect-free
      // request fingerprint and only resume when it exactly matches the payload.
      var currentRequestPlan = di3BuildSupplyFullEditPlan_(context, false);
      if (currentRequestPlan.current_status !== DI3_SUPPLY_STATUS.RECEIVED) {
        // Variant creation is deliberately not repeated for the comparison path.
        // PREVIEW IDs are normalized away by the request fingerprint helper.
      }
      var savedPayload = di3ReadVerifiedOperationPayload_(existingOperation);
      if (!savedPayload || !savedPayload.request_fingerprint) {
        throw new Error("Для этой версии операции SUPPLY_DOCUMENT_EDIT нет fingerprint исходных данных. Автоматическое возобновление остановлено, чтобы не применить старый payload к изменённой форме. Проверь запись Operations и восстанови/отмени режим после сверки.");
      }
      var currentRequestFingerprint = di3BuildSupplyFullEditRequestFingerprint_(currentRequestPlan);
      if (String(savedPayload.request_fingerprint) !== currentRequestFingerprint) {
        throw new Error("Форма поставки отличается от неизменяемого payload незавершённой/уже сохранённой корректировки. Старые данные не будут применены повторно. Отмени режим и заново включи полное редактирование либо сначала разберись с операцией в Operations.");
      }
      var resumed = di3ExecutePreparedOperation_(existingOperation);
      if (["COMMITTED", "ALREADY_COMMITTED"].indexOf(String(resumed.status)) !== -1) {
        di3GetSpreadsheet_().toast("Изменения поставки сохранены", "Поставки", 5);
        di3EndFullSupplyEditMode(true);
      }
      return resumed;
    }
    var pendingEdits = di3ReadRowsByColumnValue_("Operations", 4, context.supply_id).filter(function (match) {
      var operationType = String(match.values[2] || "");
      var operationStatus = String(match.values[5] || "");
      return operationType === "SUPPLY_DOCUMENT_EDIT" && ["PREPARED", "RETRYABLE", "QUARANTINED"].indexOf(operationStatus) !== -1;
    });
    if (pendingEdits.length) {
      throw new Error("По этой поставке уже есть незавершённая корректировка. Сначала восстанови или проверь её в журнале операций: " + String(pendingEdits[0].values[0]));
    }
    var snapshot = di3BuildSupplyFullEditSnapshot_(context.supply_id);
    if (snapshot.fingerprint !== context.baseline_hash) {
      throw new Error("Поставка была изменена после включения полного редактирования. Изменения не применены. Отмени режим и загрузи свежую версию.");
    }
    var plan = di3BuildSupplyFullEditPlan_(context, false);
    if (plan.current_status !== DI3_SUPPLY_STATUS.RECEIVED) {
      plan = di3BuildSupplyFullEditPlan_(context, true);
    }
    if (plan.target_number !== String(context.supply.supply_number)) {
      di3SetSupplySelectorValidation_(context.sheet, plan.target_number);
    }
    var payload = di3BuildSupplyFullEditOperationPayload_(context, plan);
    var operation = di3RegisterPreparedOperation_({
      idempotency_key: idempotencyKey,
      operation_type: "SUPPLY_DOCUMENT_EDIT",
      document_type: "SUPPLY",
      document_id: context.supply_id,
      payload: payload
    });
    var result = di3ExecutePreparedOperation_(operation);
    if (["COMMITTED", "ALREADY_COMMITTED"].indexOf(String(result.status)) !== -1) {
      di3GetSpreadsheet_().toast("Изменения поставки сохранены", "Поставки", 5);
      di3EndFullSupplyEditMode(true);
    }
    return result;
  });
}

function di3HydrateSupplyFullEditRow_(row, kind) {
  var values = row.slice();
  if (kind === "SUPPLY") {
    [4, 5, 6, 7, 16, 17, 18].forEach(function (index) {
      if (values[index] === "" || values[index] == null) values[index] = "";
      else if (!(values[index] instanceof Date)) values[index] = new Date(values[index]);
    });
  } else {
    [17, 18].forEach(function (index) {
      if (values[index] === "" || values[index] == null) values[index] = "";
      else if (!(values[index] instanceof Date)) values[index] = new Date(values[index]);
    });
  }
  return values;
}

/** Build an explicit adjacent status-history path for a corrected stage chain. */
function di3BuildSupplyFullEditStatusHistoryTransitions_(oldStatus, newStatus) {
  var order = [DI3_SUPPLY_STATUS.CREATED, DI3_SUPPLY_STATUS.SENT, DI3_SUPPLY_STATUS.AWAITING, DI3_SUPPLY_STATUS.RECEIVED];
  var from = order.indexOf(di3NormalizeSupplyStatus_(oldStatus));
  var to = order.indexOf(di3NormalizeSupplyStatus_(newStatus));
  if (from < 0 || to < 0 || from === to) return from === to ? [] : [[String(oldStatus || ""), String(newStatus || "")]];
  var result = [];
  var step = from < to ? 1 : -1;
  for (var index = from; index !== to; index += step) {
    result.push([order[index], order[index + step]]);
  }
  return result;
}

/** Idempotent document-only operation handler. Never writes StockLedger/FIFO. */
function di3ApplySupplyDocumentEditOperation_(operationRecord, payload) {
  if (!payload || Number(payload.schema_version) !== 1 || !payload.supply_id || !Array.isArray(payload.supply_row) || !Array.isArray(payload.item_rows)) {
    throw new Error("Некорректный immutable payload SUPPLY_DOCUMENT_EDIT.");
  }
  var supply = di3GetSupplyById_(String(payload.supply_id));
  if (!supply) throw new Error("Поставка для корректировки больше не найдена: " + payload.supply_id);
  var receipt = di3GetSupplyReceiptOperation_(payload.supply_id);
  var storedStatus = di3NormalizeSupplyStatus_(supply.status);
  var incomingImpact = payload.impact || {};
  var payloadOldStatus = di3NormalizeSupplyStatus_(payload.old_status);
  var payloadNewStatus = di3NormalizeSupplyStatus_(payload.new_status);
  var targetParent = di3HydrateSupplyFullEditRow_(payload.supply_row, "SUPPLY");
  if (storedStatus !== payloadOldStatus && storedStatus !== payloadNewStatus) {
    throw new Error("Статус поставки изменился после подготовки корректировки. Операция не будет перезаписывать более новое состояние.");
  }
  if (DI3_SUPPLY_FULL_EDIT_ALLOWED_STATUSES.indexOf(payloadNewStatus) === -1 ||
      di3NormalizeSupplyStatus_(targetParent[3]) !== payloadNewStatus) {
    throw new Error("В payload указано недопустимое или несогласованное целевое состояние поставки.");
  }
  if (storedStatus === DI3_SUPPLY_STATUS.CANCELLED) throw new Error("Отменённую поставку нельзя корректировать без отдельного восстановления.");
  if (storedStatus === DI3_SUPPLY_STATUS.RECEIVED) {
    if (!receipt || String(receipt.values[5]) !== "COMMITTED") throw new Error("Полученная поставка не имеет подтверждённой операции приёмки.");
    var receiptAudit = di3BuildSupplyFullEditSnapshot_(String(payload.supply_id)).receipt_operation;
    if (!receiptAudit || receiptAudit.payload_integrity !== "VALID") {
      throw new Error("Не удалось подтвердить целостность исходного payload SUPPLY_RECEIVE. Документная корректировка остановлена без изменений.");
    }
    if (incomingImpact.stock === true || incomingImpact.lines_changed || incomingImpact.financial_changed || incomingImpact.received_date_changed) {
      throw new Error("SUPPLY_DOCUMENT_EDIT не может менять складские данные уже полученной поставки.");
    }
  } else if (receipt) {
    throw new Error("У неполученной поставки уже существует операция приёмки. Сначала требуется сверка Operations.");
  }
  // Preserve immutable identity fields even if an edited payload is malformed.
  targetParent[0] = String(payload.supply_id);
  targetParent[4] = supply.created_at;
  if (String(targetParent[1]) !== String(payload.supply_number_after)) throw new Error("Номер поставки в payload не согласован.");
  if (Number(supply.row_number) !== Number(payload.supply_row_number)) {
    // The document row may move only through controlled sheet maintenance. Find it again by ID.
    payload.supply_row_number = Number(supply.row_number);
  }
  di3ApplyContiguousRowUpdates_("V3_Supplies", [{ row_number: supply.row_number, values: targetParent }]);

  var itemsSheet = di3GetSheetOrThrow_("V3_SupplyItems");
  var targetRows = payload.item_rows.map(function (row) { return di3HydrateSupplyFullEditRow_(row, "ITEM"); });
  var seenTargetIds = Object.create(null);
  targetRows.forEach(function (row) {
    var id = String(row[0] || "");
    if (!id || seenTargetIds[id] || String(row[1]) !== String(payload.supply_id)) throw new Error("В payload повторяется или не согласован supply_item_id.");
    seenTargetIds[id] = true;
  });
  var itemUpdates = [];
  var itemAppends = [];
  targetRows.forEach(function (row) {
    var existing = di3FindRowByFirstColumn_("V3_SupplyItems", String(row[0]));
    if (existing) {
      if (String(existing.values[1]) !== String(payload.supply_id)) throw new Error("supply_item_id уже принадлежит другой поставке: " + row[0]);
      itemUpdates.push({ row_number: existing.row_number, values: row });
    } else {
      itemAppends.push(row);
    }
  });
  if (itemUpdates.length) di3ApplyContiguousRowUpdates_("V3_SupplyItems", itemUpdates);
  if (itemAppends.length) di3AppendTableRows_("V3_SupplyItems", itemAppends);

  var removeIds = (payload.removed_item_ids || []).map(String);
  var removeRows = [];
  removeIds.forEach(function (id) {
    if (seenTargetIds[id]) throw new Error("Одна товарная строка одновременно добавлена и помечена к удалению: " + id);
    var match = di3FindRowByFirstColumn_("V3_SupplyItems", id);
    if (match) {
      if (String(match.values[1]) !== String(payload.supply_id)) throw new Error("Нельзя удалить товарную строку другой поставки.");
      removeRows.push(Number(match.row_number));
    }
  });
  removeRows.sort(function (a, b) { return b - a; }).forEach(function (rowNumber) { itemsSheet.deleteRow(rowNumber); });

  var operationId = String(operationRecord.values[0]);
  var statusTransitions = di3BuildSupplyFullEditStatusHistoryTransitions_(payload.old_status, payload.new_status);
  if (statusTransitions.length) {
    var existingHistory = di3ReadRowsByColumnValue_("DocumentStatusHistory", 7, operationId).filter(function (match) {
      return String(match.values[1]) === "SUPPLY" && String(match.values[2]) === String(payload.supply_id);
    });
    var missingHistoryRows = statusTransitions.filter(function (transition) {
      return !existingHistory.some(function (match) {
        return String(match.values[3]) === transition[0] && String(match.values[4]) === transition[1];
      });
    }).map(function (transition) {
      return [
        di3MakeUuid_(), "SUPPLY", String(payload.supply_id), transition[0], transition[1],
        new Date(payload.edited_at), String(payload.edited_by || ""), operationId,
        "Полная корректировка поставки: " + String(payload.reason || "")
      ];
    });
    if (missingHistoryRows.length) di3AppendTableRows_("DocumentStatusHistory", missingHistoryRows);
  }
  di3RefreshSupplyRegister();
  return {
    status: "COMMITTED",
    supply_id: String(payload.supply_id),
    supply_number: String(payload.supply_number_after),
    old_status: String(payload.old_status),
    new_status: String(payload.new_status),
    item_rows: targetRows.length,
    removed_item_rows: removeRows.length,
    stock_movements_created: 0,
    audit_payload: "OperationPayloads"
  };
}

function di3DiagnoseFullSupplyEditMode() {
  var sheet = di3GetSheetOrThrow_(DI3_SUPPLY_FORM_SHEET);
  var supplyId = String(sheet.getRange(DI3_SUPPLY_FORM.editSupplyId).getValue() || "").trim();
  var supply = supplyId ? di3GetSupplyById_(supplyId) : null;
  var snapshot = supply ? di3BuildSupplyFullEditSnapshot_(supplyId) : null;
  return {
    mode: String(sheet.getRange(DI3_SUPPLY_FORM.fullEditMode).getValue() || "STANDARD"),
    supply_id: supplyId,
    supply_number: supply ? String(supply.supply_number) : "",
    status: supply ? di3NormalizeSupplyStatus_(supply.status) : "UNLOADED",
    baseline_hash_present: !!String(sheet.getRange(DI3_SUPPLY_FORM.fullEditBaselineHash).getValue() || ""),
    baseline_matches: snapshot ? snapshot.fingerprint === String(sheet.getRange(DI3_SUPPLY_FORM.fullEditBaselineHash).getValue() || "") : false,
    revision_id_present: !!String(sheet.getRange(DI3_SUPPLY_FORM.fullEditRevisionId).getValue() || ""),
    stock: snapshot ? snapshot.counts : null,
    receipt_operation: snapshot ? snapshot.receipt_operation && {
      operation_id: snapshot.receipt_operation.operation_id,
      status: snapshot.receipt_operation.status
    } : null,
    read_only: true
  };
}
