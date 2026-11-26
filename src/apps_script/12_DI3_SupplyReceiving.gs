/** Dots Inventory v3 — supply status workflow, receipt posting and FIFO layer creation. */
var DI3_SUPPLY_STATUS_TRANSITIONS = Object.freeze({
  "Создан": "Отправлен",
  "Отправлен": "Ожидает получения",
  "Ожидает получения": "Доставлен"
});
var DI3_SUPPLY_REGISTER_SHEET = "Реестр поставок v3";
var DI3_SUPPLY_REGISTER_HEADERS = [
  "Запись создана в системе", "Номер поставки", "Продавец", "Оформлена",
  "Отправлена", "Ожидает получения", "Получена", "Ожидаемая дата прибытия",
  "Статус", "Итого, ₽", "Комментарий", "supply_id", "Дата следующего этапа", "Время следующего этапа (HH:mm)"
];
// The immediately previous released layout: dates were grouped before the system timestamp.
var DI3_SUPPLY_REGISTER_PREVIOUS_CURRENT_HEADERS = [
  "Запись создана в системе", "Номер поставки", "Продавец", "Оформлена",
  "Отправлена", "Ожидает получения", "Получена", "Ожидаемая дата прибытия",
  "Статус", "Итого, ₽", "Комментарий", "supply_id", "Дата следующего этапа (необязательно)"
];
var DI3_SUPPLY_REGISTER_PREVIOUS_ORDER_HEADERS = [
  "Номер поставки", "Продавец", "Статус", "Дата создания заказа в магазине", "Ожидаемая дата прибытия",
  "Запись создана в системе", "Отправлена", "Прибыла, ожидает получения", "Получена", "Итого, ₽",
  "Комментарий", "supply_id", "Дата следующего этапа (необязательно)"
];
var DI3_SUPPLY_REGISTER_COMPAT_HEADERS = [
  "Номер поставки", "Продавец", "Статус", "Дата создания заказа (магазин)", "Ожидаемое получение",
  "Запись создана в системе", "Отправлена", "Ожидает получения", "Получена", "Итого, ₽",
  "Комментарий", "supply_id", "Дата следующего этапа (необязательно)"
];
var DI3_SUPPLY_REGISTER_PREVIOUS_HEADERS = [
  "Номер поставки", "Продавец", "Статус", "Дата заказа", "Ожидаемое получение",
  "Создана", "Отправлена", "Ожидает получения", "Получена", "Итого, ₽",
  "Комментарий", "supply_id", "Дата следующего этапа (необязательно)"
];
var DI3_SUPPLY_REGISTER_LEGACY_HEADERS = [
  "Номер поставки", "Продавец", "Статус", "Создана", "Отправлена",
  "Ожидает получения", "Получена", "Итого, ₽", "Комментарий", "supply_id",
  "Дата следующего этапа (необязательно)"
];

function di3ParseSupplyEffectiveDate_(value, fallback) {
  if (value === "" || value == null) {
    if (fallback instanceof Date && !isNaN(fallback.getTime())) return new Date(fallback.getTime());
    if (fallback !== undefined && fallback !== null) {
      var fallbackDate = new Date(fallback);
      if (!isNaN(fallbackDate.getTime())) return fallbackDate;
    }
    throw new Error("Не указана фактическая дата этапа поставки. Заполни соответствующее поле G5, G6 или G7 в форме «Поставка v3». Текущая дата автоматически не подставляется.");
  }
  if (value instanceof Date) {
    if (isNaN(value.getTime())) throw new Error("Некорректная дата этапа поставки.");
    return new Date(value.getTime());
  }
  var text = String(value).trim();
  var ru = text.match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  var date;
  if (ru) {
    var day = Number(ru[1]), month = Number(ru[2]), year = Number(ru[3]);
    var hour = Number(ru[4] || 0), minute = Number(ru[5] || 0), second = Number(ru[6] || 0);
    if (hour > 23 || minute > 59 || second > 59) throw new Error("Некорректное время этапа поставки.");
    date = new Date(year, month - 1, day, hour, minute, second, 0);
    if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
      throw new Error("Такой календарной даты не существует. Используй ДД.ММ.ГГГГ или дату Google Sheets.");
    }
  } else {
    date = new Date(text);
  }
  if (isNaN(date.getTime())) throw new Error("Не удалось распознать дату. Используй ДД.ММ.ГГГГ или дату Google Sheets.");
  return date;
}

function di3GetNextSupplyStageConfig_(currentStatus) {
  var status = di3NormalizeSupplyStatus_(currentStatus);
  if (status === DI3_SUPPLY_STATUS.CREATED) {
    return { input_cell: "G5", date_field: "sent_at", next_status: DI3_SUPPLY_STATUS.SENT, label: "Отправлена" };
  }
  if (status === DI3_SUPPLY_STATUS.SENT) {
    return { input_cell: "G6", date_field: "awaiting_at", next_status: DI3_SUPPLY_STATUS.AWAITING, label: "Ожидает получения" };
  }
  if (status === DI3_SUPPLY_STATUS.AWAITING) {
    return { input_cell: "G7", date_field: "received_at", next_status: DI3_SUPPLY_STATUS.RECEIVED, label: "Получена", requires_receipt_confirmation: true };
  }
  return null;
}

/** Apply exactly one next status using the corresponding date entered in the form. */
function di3ApplyNextSupplyStageFromForm() {
  var formSheet = di3GetSheetOrThrow_(DI3_SUPPLY_FORM_SHEET);
  if (String(formSheet.getRange(DI3_SUPPLY_FORM.historicalMode).getValue() || "") === "HISTORICAL_CREATE") {
    throw new Error("В режиме «Внести старую поставку» не выполняй последовательные этапы. Заполни G2, даты G5:G7 и времена H5:H7, затем используй «Сохранить и оприходовать старую поставку».");
  }
  var ss = di3GetSpreadsheet_();
  var sheet = di3GetSheetOrThrow_(DI3_SUPPLY_FORM_SHEET);
  var supplyId = String(sheet.getRange(DI3_SUPPLY_FORM.editSupplyId).getValue() || "").trim();
  if (!supplyId) throw new Error("Сначала выбери и загрузи поставку в B2. Для новой поставки сначала выполни «Сохранить поставку». ");
  var supply = di3GetSupplyById_(supplyId);
  if (!supply) throw new Error("Загруженная поставка больше не найдена по supply_id. Обнови список и выбери её заново.");
  var selectedNumber = String(sheet.getRange(DI3_SUPPLY_FORM.selector).getValue() || "").trim();
  if (selectedNumber && selectedNumber !== String(supply.supply_number)) {
    throw new Error("B2 указывает на другую поставку. Дождись загрузки выбранного документа и повтори действие.");
  }
  var config = di3GetNextSupplyStageConfig_(supply.status);
  if (!config) throw new Error("Для статуса «" + di3GetSupplyStatusLabel_(supply.status) + "» следующего этапа нет.");

  var effectiveAt = di3ReadSupplyStageDateTime_(sheet, config.input_cell, "Этап поставки «" + config.label + "»", false);

  // Before sending a draft, persist any pending edits to its header and items.
  // Save refresh preserves the user's entered G5 value instead of clearing it.
  if (di3NormalizeSupplyStatus_(supply.status) === DI3_SUPPLY_STATUS.CREATED) {
    di3SaveSupplyDraft();
    supply = di3GetSupplyById_(supplyId);
    if (!supply || di3NormalizeSupplyStatus_(supply.status) !== DI3_SUPPLY_STATUS.CREATED) {
      throw new Error("Не удалось подтвердить сохранённое состояние черновика перед отправкой.");
    }
  }

  if (config.requires_receipt_confirmation) {
    var ui = SpreadsheetApp.getUi();
    var confirmation = ui.alert(
      "Подтверждение приёмки поставки",
      "Будет принята поставка " + supply.supply_number + " датой " + Utilities.formatDate(effectiveAt, di3GetConfiguredTimeZone_(), "dd.MM.yyyy HH:mm") + ". Операция создаст складские движения, FIFO-партии и обновит себестоимость. Продолжить?",
      ui.ButtonSet.YES_NO
    );
    if (confirmation !== ui.Button.YES) return { status: "CANCELLED_BY_USER", supply_number: supply.supply_number };
  }

  var result = di3AdvanceSupplyStatus(supply.supply_number, config.next_status, effectiveAt);
  var updatedSupply = di3GetSupplyById_(supplyId);
  di3RefreshSupplyDatePanel_(updatedSupply);
  if (config.requires_receipt_confirmation && result &&
      ["COMMITTED", "ALREADY_RECEIVED"].indexOf(String(result.status)) !== -1 &&
      typeof di3RefreshWarehouseViewsAfterCommit_ === "function") {
    di3RefreshWarehouseViewsAfterCommit_("Поставка " + supply.supply_number);
  }
  if (updatedSupply) {
    sheet.getRange("M2").setValue("Просмотр / этапы: " + updatedSupply.supply_number + " — " + di3GetSupplyStatusLabel_(updatedSupply.status));
    di3SetSupplyFormStateBaseline_(sheet);
  }
  ss.toast("Статус: " + di3GetSupplyStatusLabel_(result.new_status || (updatedSupply && updatedSupply.status)), "Поставка " + supply.supply_number, 5);
  return result;
}

function di3GetSupplyById_(supplyId) {
  var match = di3ReadRowByColumnValue_("V3_Supplies", 0, supplyId);
  if (!match) return null;
  var record = {};
  DI3_TABLE_SCHEMAS.V3_Supplies.forEach(function (header, index) { record[header] = match.values[index]; });
  record.row_number = match.row_number;
  return record;
}

function di3GetSupplyStatusDateField_(status) {
  status = di3NormalizeSupplyStatus_(status);
  if (status === DI3_SUPPLY_STATUS.SENT) return "sent_at";
  if (status === DI3_SUPPLY_STATUS.AWAITING) return "awaiting_at";
  if (status === DI3_SUPPLY_STATUS.RECEIVED) return "received_at";
  throw new Error("Неизвестный статус поставки: " + status);
}

function di3GetSupplyPreviousDate_(supply, nextStatus) {
  nextStatus = di3NormalizeSupplyStatus_(nextStatus);
  if (nextStatus === DI3_SUPPLY_STATUS.SENT) {
    // The first logistics event is bounded by the store order date (G2),
    // not by the later timestamp when the draft was entered into this system (G4).
    if (supply && supply.supplier_order_date) {
      var orderDate = di3ParseSupplyCalendarDate_(supply.supplier_order_date, "Дата заказа в магазине");
      if (orderDate) {
        orderDate.setHours(0, 0, 0, 0);
        return orderDate;
      }
    }
    // Legacy supplies without an order date retain the conservative old fallback.
    return supply.created_at;
  }
  if (nextStatus === DI3_SUPPLY_STATUS.AWAITING) return supply.sent_at;
  if (nextStatus === DI3_SUPPLY_STATUS.RECEIVED) return supply.awaiting_at;
  return null;
}

function di3EnsureSupplyStatusHistory_(supplyId, oldStatus, newStatus, effectiveAt, operationId, comment) {
  var matches = di3ReadRowsByColumnValue_("DocumentStatusHistory", 2, supplyId);
  var exists = matches.some(function (match) {
    var row = match.values;
    return String(row[1]) === "SUPPLY" && String(row[4]) === String(newStatus);
  });
  if (exists) return false;
  di3AppendTableRows_("DocumentStatusHistory", [[
    di3MakeUuid_(), "SUPPLY", supplyId, oldStatus || "", newStatus,
    effectiveAt, operationId ? di3GetOperationInitiatorActor_(operationId) : di3GetActorEmail_(), operationId || "", comment || ""
  ]]);
  return true;
}

function di3ValidateSupplyStatusTransition_(currentStatus, nextStatus) {
  currentStatus = di3NormalizeSupplyStatus_(currentStatus);
  nextStatus = di3NormalizeSupplyStatus_(nextStatus);
  var expected = DI3_SUPPLY_STATUS_TRANSITIONS[String(currentStatus || "")];
  if (!expected) {
    throw new Error("Поставка в статусе «" + di3GetSupplyStatusLabel_(currentStatus) + "» не имеет следующего перехода.");
  }
  if (expected !== nextStatus) {
    throw new Error("Недопустимый переход поставки: «" + di3GetSupplyStatusLabel_(currentStatus) + "» → «" + di3GetSupplyStatusLabel_(nextStatus) + "». Следующий статус: «" + di3GetSupplyStatusLabel_(expected) + "».");
  }
  return true;
}

function di3SetSupplyStatusCell_(supply, newStatus, effectiveAt) {
  var sheet = di3GetSheetOrThrow_("V3_Supplies");
  var headers = DI3_TABLE_SCHEMAS.V3_Supplies;
  var firstColumn = headers.indexOf("status") + 1;
  var updatedColumn = headers.indexOf("updated_at") + 1;
  var dateColumn = headers.indexOf(di3GetSupplyStatusDateField_(newStatus)) + 1;
  var width = updatedColumn - firstColumn + 1;
  var range = sheet.getRange(supply.row_number, firstColumn, 1, width);
  var values = range.getValues()[0];
  values[0] = newStatus;
  values[dateColumn - firstColumn] = new Date(effectiveAt.getTime());
  values[updatedColumn - firstColumn] = new Date();
  // Status, stage timestamp and updated_at are one contiguous write. This
  // avoids leaving a partially advanced supply after a single-cell failure.
  range.setValues([values]);
}

/** Public transition entry point. Only the next state in the supply state machine is accepted. */
function di3AdvanceSupplyStatus(supplyNumber, nextStatus, effectiveAt) {
  return di3WithLock_(function () {
    di3EnsureStockCoreSchemas_();
    var supply = di3FindSupplyByNumber_(String(supplyNumber || "").trim());
    if (!supply) throw new Error("Поставка не найдена: " + supplyNumber);
    nextStatus = di3NormalizeSupplyStatus_(nextStatus);
    var currentStatus = di3NormalizeSupplyStatus_(supply.status);
    if (nextStatus === DI3_SUPPLY_STATUS.RECEIVED) return di3ReceiveSupply_(supply, effectiveAt);
    if (currentStatus === nextStatus) {
      var alreadyDateField = di3GetSupplyStatusDateField_(nextStatus);
      var alreadyDate = supply[alreadyDateField] || di3ParseSupplyEffectiveDate_(effectiveAt, null);
      // Re-apply the complete status projection so a retry can repair a
      // previously interrupted status/date/updated_at write as one operation.
      di3SetSupplyStatusCell_(supply, nextStatus, di3ToDate_(alreadyDate, "Дата этапа поставки"));
      di3EnsureSupplyStatusHistory_(supply.supply_id, "", nextStatus, alreadyDate, "", "Восстановление истории статуса");
      di3RefreshSupplyRegister();
      return { status: "ALREADY_IN_STATUS", supply_number: supply.supply_number, new_status: nextStatus, effective_at: alreadyDate };
    }
    di3ValidateSupplyStatusTransition_(currentStatus, nextStatus);
    var date = di3ParseSupplyEffectiveDate_(effectiveAt, null);
    var previousDate = di3GetSupplyPreviousDate_(supply, nextStatus);
    if (previousDate && date.getTime() < di3ToMillis_(previousDate)) {
      if (nextStatus === DI3_SUPPLY_STATUS.SENT && supply.supplier_order_date) {
        throw new Error("Дата отправки не может быть раньше даты создания заказа в магазине (G2).");
      }
      if (nextStatus === DI3_SUPPLY_STATUS.AWAITING) {
        throw new Error("Дата этапа «Ожидает получения» не может быть раньше даты отправки.");
      }
      throw new Error("Дата получения не может быть раньше даты «Ожидает получения».");
    }
    if (date.getTime() > Date.now() + 5 * 60 * 1000) throw new Error("Нельзя установить дату этапа в будущем.");
    di3AssertPeriodOpen_(date, "Изменение статуса поставки");
    var oldStatus = currentStatus;
    di3SetSupplyStatusCell_(supply, nextStatus, date);
    di3EnsureSupplyStatusHistory_(supply.supply_id, oldStatus, nextStatus, date, "", "Изменение статуса поставки");
    di3RefreshSupplyRegister();
    di3RefreshSupplyFormValidations();
    var updatedSupply = di3GetSupplyById_(supply.supply_id);
    var formSheet = di3GetSpreadsheet_().getSheetByName(DI3_SUPPLY_FORM_SHEET);
    if (formSheet && String(formSheet.getRange(DI3_SUPPLY_FORM.editSupplyId).getValue() || "") === String(supply.supply_id)) {
      di3RefreshSupplyDatePanel_(updatedSupply);
      formSheet.getRange("M2").setValue("Просмотр / этапы: " + supply.supply_number + " — " + di3GetSupplyStatusLabel_(nextStatus));
    }
    return { status: "UPDATED", supply_number: supply.supply_number, old_status: oldStatus, new_status: nextStatus, effective_at: date };
  });
}

function di3BuildSupplyReceiptPayload_(supply, items, effectiveAt, recordedAt) {
  if (!supply || !supply.supply_id) throw new Error("Не передана поставка для приёмки.");
  if (!Array.isArray(items) || !items.length) throw new Error("Нельзя принять поставку без товарных позиций.");
  var seenItems = {};
  // Validate all cost inputs before touching the spreadsheet for display-code allocation.
  items.forEach(function (item, index) {
    if (item.unit_cost === "" || item.unit_cost == null) {
      throw new Error("Позиция " + (index + 1) + ": итоговая себестоимость не рассчитана.");
    }
  });
  var movementCodeNumber = di3NextMovementDisplayCode_().match(/(\d+)$/);
  var movementSequence = movementCodeNumber ? Number(movementCodeNumber[1]) - 1 : 0;
  var lines = items.map(function (item, index) {
    var itemId = String(item.supply_item_id || "");
    var productId = String(item.product_id || "");
    var variantId = String(item.pack_variant_id || "");
    var quantity = Number(item.received_units);
    if (item.unit_cost === "" || item.unit_cost == null) throw new Error("Позиция " + (index + 1) + ": итоговая себестоимость не рассчитана.");
    var unitCost = Number(item.unit_cost);
    if (!itemId || seenItems[itemId]) throw new Error("В позициях поставки отсутствует или повторяется supply_item_id.");
    seenItems[itemId] = true;
    if (!productId || !variantId) throw new Error("Позиция " + (index + 1) + ": не указан товар или вариант упаковки.");
    if (!Number.isInteger(quantity) || quantity <= 0) throw new Error("Позиция " + (index + 1) + ": некорректное количество для приёмки.");
    if (!Number.isFinite(unitCost) || unitCost < 0) throw new Error("Позиция " + (index + 1) + ": некорректная итоговая себестоимость единицы.");
    var expectedQuantity = Number(item.packs) * Number(item.units_per_pack);
    if (quantity !== expectedQuantity) throw new Error("Позиция " + (index + 1) + ": received_units не совпадает с packs × units_per_pack.");
    movementSequence++;
    var totalCostMinor = di3MoneyToMinorUnits_(
      item.final_line_amount !== "" && item.final_line_amount != null
        ? Number(item.final_line_amount) : unitCost * quantity,
      "Полная себестоимость позиции поставки", false);
    var costStatus = totalCostMinor === 0 ? "FREE" : "KNOWN";
    return {
      supply_item_id: itemId,
      product_id: productId,
      product_label: String(item.product_label_snapshot || ""),
      pack_variant_id: variantId,
      units_per_pack: Number(item.units_per_pack),
      quantity: quantity,
      unit_cost: unitCost,
      total_cost_minor: totalCostMinor,
      cost_status: costStatus,
      cost_per_pack: Number(item.final_pack_cost),
      movement_id: di3MakeUuid_(),
      lot_id: di3MakeUuid_(),
      event_key: "SUPPLY_RECEIVE:" + supply.supply_id + ":" + itemId,
      display_code: "MOV-" + String(movementSequence).padStart(6, "0"),
      effective_at: effectiveAt.toISOString(),
      recorded_at: recordedAt.toISOString()
    };
  });
  return {
    supply_id: String(supply.supply_id),
    supply_number: String(supply.supply_number),
    received_at: effectiveAt.toISOString(),
    recorded_at: recordedAt.toISOString(),
    lines: lines
  };
}

function di3BuildSupplyReceiptRows_(operationId, payload) {
  var ledgerRows = [];
  var detailRows = [];
  var lotRows = [];
  var actor = di3GetOperationInitiatorActor_(operationId);
  payload.lines.forEach(function (line) {
    ledgerRows.push([
      line.movement_id, operationId, line.event_key, line.product_id,
      "SUPPLY", payload.supply_id, line.quantity, new Date(line.effective_at),
      new Date(line.recorded_at), "", "", "Приёмка поставки " + payload.supply_number, di3RequireLedgerSequence_(line.ledger_sequence, line.movement_id)
    ]);
    detailRows.push([
      line.movement_id, line.display_code, "IN", "SUPPLY_RECEIVE", "", "",
      line.cost_status, "", actor, "Приёмка поставки " + payload.supply_number, "SUPPLY"
    ]);
    lotRows.push([
      line.lot_id, line.product_id, line.movement_id, "SUPPLY", payload.supply_id,
      line.pack_variant_id, new Date(line.effective_at), new Date(line.recorded_at),
      line.quantity, line.unit_cost, line.cost_status, di3GetBaseCurrency_(),
      "Поставка " + payload.supply_number + "; позиция " + line.supply_item_id, "",
      line.total_cost_minor
    ]);
  });
  return { ledger: ledgerRows, details: detailRows, lots: lotRows };
}

function di3GetSupplyReceiptOperation_(supplyId) {
  return di3FindRowByColumnValue_("Operations", 1, "SUPPLY_RECEIVE:" + supplyId);
}

function di3CreateSupplyReceiptOperation_(supply, effectiveAt) {
  var items = di3GetSupplyItems_(supply.supply_id);
  var variants = di3LoadPackVariantIndex_();
  items.forEach(function (item, index) {
    var variant = variants.byId[String(item.pack_variant_id)];
    if (!variant || String(variant.product_id) !== String(item.product_id)) {
      throw new Error("Позиция " + (index + 1) + ": вариант упаковки отсутствует или принадлежит другому товару.");
    }
    if (Number(variant.units_per_pack) !== Number(item.units_per_pack)) {
      throw new Error("Позиция " + (index + 1) + ": фасовка в документе не совпадает со справочником.");
    }
  });
  var payload = di3BuildSupplyReceiptPayload_(supply, items, effectiveAt, new Date());
  di3AssignLedgerSequencesToLines_(payload.lines);
  payload.lines.forEach(function (line) {
    di3AssertNoBackdatedMovementBeforeReturnedOrder_(line.product_id, line.effective_at, "приёмка поставки");
  });
  var key = "SUPPLY_RECEIVE:" + supply.supply_id;
  var operation = di3RegisterPreparedOperation_({
    idempotency_key: key,
    operation_type: "SUPPLY_RECEIVE",
    document_type: "SUPPLY",
    document_id: supply.supply_id,
    payload: payload
  });
  return {
    operation_id: String(operation.values[0]),
    payload: payload,
    operation_row_number: operation.row_number,
    payload_hash: String(operation.values[6]),
    operation_record: operation
  };
}

function di3EnsureSupplyCostHistory_(supply, payload) {
  var existingSourceKeys = di3ReadTableColumnValues_("ProductCostHistory", 7);
  var sourceKeys = {};
  existingSourceKeys.forEach(function (value) { sourceKeys[String(value || "")] = true; });
  var rows = [];
  payload.lines.forEach(function (line) {
    var sourceKey = "SUPPLY_RECEIPT:" + payload.supply_id + ":" + line.supply_item_id;
    if (sourceKeys[sourceKey]) return;
    rows.push([
      di3MakeUuid_(), line.product_id, line.pack_variant_id, line.cost_per_pack,
      line.unit_cost, di3GetBaseCurrency_(), "SUPPLY_RECEIPT", sourceKey,
      new Date(payload.received_at), new Date(payload.recorded_at),
      "Фактическая приёмка поставки " + payload.supply_number
    ]);
    sourceKeys[sourceKey] = true;
  });
  di3AppendTableRows_("ProductCostHistory", rows);
  return rows.length;
}

function di3SetCurrentPackVariantsFromReceipt_(payload) {
  var latestByProduct = {};
  // If several pack variants of one product are received in one document, the last line is
  // displayed as the current/default variant. All received variants remain active and retained.
  payload.lines.forEach(function (line, index) {
    latestByProduct[line.product_id] = { pack_variant_id: line.pack_variant_id, index: index };
  });
  var variants = di3LoadPackVariantIndex_();
  var updates = [];
  Object.keys(latestByProduct).forEach(function (productId) {
    Object.keys(variants.byId).forEach(function (variantId) {
      var record = variants.byId[variantId];
      if (String(record.product_id) !== String(productId)) return;
      var shouldBeCurrent = variantId === String(latestByProduct[productId].pack_variant_id);
      var current = record.is_current === true || String(record.is_current).toLowerCase() === "true";
      if (shouldBeCurrent === current) return;
      var row = DI3_TABLE_SCHEMAS.PackVariants.map(function (header) { return record[header]; });
      row[4] = shouldBeCurrent;
      row[8] = new Date(payload.received_at);
      updates.push({ row_number: record.row_number, values: row });
    });
  });
  di3ApplyContiguousRowUpdates_("PackVariants", updates);
  return updates.length;
}

function di3CompleteSupplyReceipt_(supply, operationId, operationRowNumber, payload) {
  var rows = di3BuildSupplyReceiptRows_(operationId, payload);
  var productIds = payload.lines.map(function (line) { return line.product_id; });
  var eventKeys = rows.ledger.map(function (row) { return String(row[2]); });
  var movementIds = rows.ledger.map(function (row) { return String(row[0]); });

  // Read only the candidate event keys to make a partial-retry idempotent.
  var existingLedger = di3ReadRowsByColumnValues_("StockLedger", 2, eventKeys).map(function (match) { return match.values; });
  var existingDetails = di3ReadRowsByColumnValues_("StockMovementDetails", 0, movementIds).map(function (match) { return match.values; });
  var existingLots = di3ReadRowsByColumnValues_("StockLots", 2, movementIds).map(function (match) { return match.values; });
  var ledgerKeys = Object.create(null), detailIds = Object.create(null), lotMovementIds = Object.create(null);
  existingLedger.forEach(function (row) { ledgerKeys[String(row[2])] = true; });
  existingDetails.forEach(function (row) { detailIds[String(row[0])] = true; });
  existingLots.forEach(function (row) { lotMovementIds[String(row[2])] = true; });

  // Preflight reads full histories/projections only for products in this receipt.
  di3PreflightFifoForProductsScoped_(rows.ledger, rows.details, rows.lots, productIds);

  var missingLedger = rows.ledger.filter(function (row) { return !ledgerKeys[String(row[2])]; });
  var missingDetails = rows.details.filter(function (row) { return !detailIds[String(row[0])]; });
  var missingLots = rows.lots.filter(function (row) { return !lotMovementIds[String(row[2])]; });
  di3AppendTableRows_("StockLedger", missingLedger);
  di3AppendTableRows_("StockMovementDetails", missingDetails);
  di3AppendTableRows_("StockLots", missingLots);

  // Verify only event components belonging to this receipt, not the full repositories.
  var savedLedger = di3ReadRowsByColumnValues_("StockLedger", 2, eventKeys).map(function (match) { return match.values; });
  var savedDetails = di3ReadRowsByColumnValues_("StockMovementDetails", 0, movementIds).map(function (match) { return match.values; });
  var savedLots = di3ReadRowsByColumnValues_("StockLots", 2, movementIds).map(function (match) { return match.values; });
  var savedLedgerKeys = Object.create(null), savedDetailIds = Object.create(null), savedLotMovementIds = Object.create(null);
  savedLedger.forEach(function (row) { savedLedgerKeys[String(row[2])] = true; });
  savedDetails.forEach(function (row) { savedDetailIds[String(row[0])] = true; });
  savedLots.forEach(function (row) { savedLotMovementIds[String(row[2])] = true; });
  payload.lines.forEach(function (line) {
    if (!savedLedgerKeys[line.event_key]) throw new Error("Не сохранено складское движение для позиции " + line.supply_item_id + ".");
    if (!savedDetailIds[line.movement_id]) throw new Error("Не сохранены детали движения " + line.movement_id + ".");
    if (!savedLotMovementIds[line.movement_id]) throw new Error("Не создан FIFO-слой для движения " + line.movement_id + ".");
  });

  var fifo = di3RebuildFifoAllocations_("SUPPLY_RECEIPT", productIds, { operation_id: String(operationId || "") });
  var costHistoryAdded = di3EnsureSupplyCostHistory_(supply, payload);
  var currentVariantsUpdated = di3SetCurrentPackVariantsFromReceipt_(payload);

  var currentSupply = di3GetSupplyById_(supply.supply_id);
  if (!currentSupply) throw new Error("Поставка исчезла из реестра во время приёмки.");
  // Use the same single-range projection write as the intermediate status
  // transitions. Recovery can safely retry the complete status/date/timestamp
  // projection without depending on which individual cell was persisted first.
  di3SetSupplyStatusCell_(currentSupply, DI3_SUPPLY_STATUS.RECEIVED, new Date(payload.received_at));
  di3EnsureSupplyStatusHistory_(supply.supply_id, DI3_SUPPLY_STATUS.AWAITING,
    DI3_SUPPLY_STATUS.RECEIVED, new Date(payload.received_at), operationId,
    "Фактическая приёмка; созданы FIFO-партии");
  di3RefreshSupplyRegister();
  di3RefreshSupplyFormValidations();
  var formSheet = di3GetSpreadsheet_().getSheetByName(DI3_SUPPLY_FORM_SHEET);
  if (formSheet && String(formSheet.getRange(DI3_SUPPLY_FORM.editSupplyId).getValue() || "") === String(supply.supply_id)) {
    di3RefreshSupplyDatePanel_(di3GetSupplyById_(supply.supply_id));
    formSheet.getRange("M2").setValue("Просмотр / этапы: " + supply.supply_number + " — Получена");
  }
  return {
    status: "COMMITTED",
    supply_id: supply.supply_id,
    supply_number: supply.supply_number,
    movements_created: payload.lines.length,
    units_received: payload.lines.reduce(function (sum, line) { return sum + line.quantity; }, 0),
    fifo_run_id: fifo.run_id,
    fifo_allocations_created: fifo.allocations_created,
    cost_history_added: costHistoryAdded,
    current_pack_variants_updated: currentVariantsUpdated
  };
}

function di3ApplySupplyReceiptOperation_(operationRecord, payload) {
  var operationId = String(operationRecord.values[0]);
  var supply = di3GetSupplyById_(payload.supply_id);
  if (!supply) throw new Error("Не найдена поставка для восстановления приёмки.");
  return di3CompleteSupplyReceipt_(supply, operationId, operationRecord.row_number, payload);
}

function di3ResumeSupplyReceiptOperation_(operationRecord, payloadOverride) {
  // Always resume from the persisted and hash-verified payload.
  return di3ExecutePreparedOperation_(operationRecord);
}

function di3ReceiveSupply_(supply, effectiveAt) {
  if (di3NormalizeSupplyStatus_(supply.status) === DI3_SUPPLY_STATUS.RECEIVED) {
    var committed = di3GetSupplyReceiptOperation_(supply.supply_id);
    if (committed && String(committed.values[5]) === "COMMITTED") {
      return { status: "ALREADY_RECEIVED", supply_number: supply.supply_number, operation_id: committed.values[0] };
    }
  }
  var idempotencyKey = "SUPPLY_RECEIVE:" + supply.supply_id;
  di3AssertNoOtherPendingStockOperations_(idempotencyKey);
  // An existing receipt operation owns its immutable date and payload. Resume it
  // before reading the form again so a recovery attempt never needs a new G7 value.
  var operation = di3GetSupplyReceiptOperation_(supply.supply_id);
  if (operation) {
    if (String(operation.values[5]) === "COMMITTED") {
      return { status: "ALREADY_RECEIVED", supply_number: supply.supply_number, operation_id: operation.values[0] };
    }
    if (String(operation.values[5]) === "REJECTED") throw new Error("Операция приёмки ранее отклонена. Проверь журнал Operations перед повторной попыткой.");
    return di3ResumeSupplyReceiptOperation_(operation, null);
  }
  if (di3NormalizeSupplyStatus_(supply.status) !== DI3_SUPPLY_STATUS.AWAITING) {
    throw new Error("Принять можно только поставку со статусом «Ожидает получения».");
  }
  var date = di3ParseSupplyEffectiveDate_(effectiveAt, null);
  if (date.getTime() > Date.now() + 5 * 60 * 1000) throw new Error("Нельзя принять поставку будущей датой.");
  if (supply.awaiting_at && date.getTime() < di3ToMillis_(supply.awaiting_at)) {
    throw new Error("Дата получения не может быть раньше даты «Ожидает получения».");
  }
  di3AssertPeriodOpen_(date, "Приёмка поставки");
  var previous = di3GetSupplyPreviousDate_(supply, DI3_SUPPLY_STATUS.RECEIVED);
  if (!previous) throw new Error("У поставки отсутствует дата перехода «Ожидает получения».");
  var created = di3CreateSupplyReceiptOperation_(supply, date);
  return di3ResumeSupplyReceiptOperation_(created.operation_record, null);
}

function di3ReceiveSupply(supplyNumber, effectiveAt) {
  return di3WithLock_(function () {
    di3EnsureStockCoreSchemas_();
    var supply = di3FindSupplyByNumber_(String(supplyNumber || "").trim());
    if (!supply) throw new Error("Поставка не найдена: " + supplyNumber);
    return di3ReceiveSupply_(supply, effectiveAt);
  });
}

function di3RecoverPendingSupplyReceipts_() {
  return di3RecoverPreparedOperations_(["SUPPLY_RECEIVE"]);
}

function di3GetSelectedSupplyRegisterRow_() {
  var ss = di3GetSpreadsheet_();
  var sheet = ss.getSheetByName(DI3_SUPPLY_REGISTER_SHEET);
  if (!sheet) throw new Error("Сначала создай реестр поставок v3.");
  var activeSheet = ss.getActiveSheet ? ss.getActiveSheet() : null;
  var activeRange = ss.getActiveRange ? ss.getActiveRange() : null;
  if (!activeSheet || activeSheet.getName() !== DI3_SUPPLY_REGISTER_SHEET || !activeRange) {
    throw new Error("Выбери ячейку в строке нужной поставки на листе «Реестр поставок v3».");
  }
  var rowNumber = activeRange.getRow();
  if (rowNumber < 4 || rowNumber > sheet.getLastRow()) throw new Error("Выбери строку поставки начиная с 4-й строки.");
  var supplyNumber = String(sheet.getRange(rowNumber, 2).getValue() || "").trim();
  if (!supplyNumber) throw new Error("В выбранной строке нет номера поставки.");
  var effectiveAt = di3BuildEffectiveDateTime_(
    sheet.getRange(rowNumber, 13).getValue(),
    sheet.getRange(rowNumber, 14).getDisplayValue(),
    "Следующий этап поставки"
  );
  return { supply_number: supplyNumber, row_number: rowNumber, effective_at: effectiveAt };
}

function di3TransitionSelectedSupply_(nextStatus) {
  var selected = di3GetSelectedSupplyRegisterRow_();
  var result = di3AdvanceSupplyStatus(selected.supply_number, nextStatus, selected.effective_at);
  if (["UPDATED", "COMMITTED", "ALREADY_RECEIVED"].indexOf(String(result.status)) !== -1) {
    var register = di3GetSheetOrThrow_(DI3_SUPPLY_REGISTER_SHEET);
    register.getRange(selected.row_number, 13, 1, 2).clearContent();
    di3RefreshSupplyRegister();
  }
  if (nextStatus === DI3_SUPPLY_STATUS.RECEIVED && ["UPDATED", "COMMITTED", "ALREADY_RECEIVED"].indexOf(String(result.status)) !== -1 && typeof di3RefreshWarehouseViewsAfterCommit_ === "function") {
    di3RefreshWarehouseViewsAfterCommit_("Поставка " + selected.supply_number);
  }
  di3GetSpreadsheet_().toast(
    result.status === "ALREADY_RECEIVED" ? "Поставка уже принята" : "Статус: " + di3GetSupplyStatusLabel_(result.new_status),
    "Поставка " + selected.supply_number, 5
  );
  return result;
}
function di3SendSelectedSupply() { return di3TransitionSelectedSupply_(DI3_SUPPLY_STATUS.SENT); }
function di3MarkSelectedSupplyAwaiting() { return di3TransitionSelectedSupply_(DI3_SUPPLY_STATUS.AWAITING); }
function di3ReceiveSelectedSupply() { return di3TransitionSelectedSupply_(DI3_SUPPLY_STATUS.RECEIVED); }

/** Write cancellation status and updated_at together without adding a schema column. */
function di3SetSupplyCancelledCell_(supply, cancelledAt) {
  var sheet = di3GetSheetOrThrow_("V3_Supplies");
  var headers = DI3_TABLE_SCHEMAS.V3_Supplies;
  var firstColumn = headers.indexOf("status") + 1;
  var updatedColumn = headers.indexOf("updated_at") + 1;
  if (firstColumn < 1 || updatedColumn < firstColumn) throw new Error("Схема V3_Supplies не содержит полей status/updated_at.");
  var range = sheet.getRange(supply.row_number, firstColumn, 1, updatedColumn - firstColumn + 1);
  var values = range.getValues()[0];
  values[0] = DI3_SUPPLY_STATUS.CANCELLED;
  values[updatedColumn - firstColumn] = new Date(cancelledAt.getTime());
  range.setValues([values]);
  return new Date(cancelledAt.getTime());
}

/** Pure cancellation guard; a receipt operation or any posted movement blocks cancellation. */
function di3ValidateSupplyCancellation_(supply, receiptOperation, receiptMovementCount) {
  if (!supply || !supply.supply_id) throw new Error("Не передана поставка для отмены.");
  if (Number(receiptMovementCount || 0) > 0) {
    throw new Error("Для этой поставки уже есть складские движения. Отмена запрещена: требуется разбор фактической приёмки.");
  }
  if (receiptOperation) {
    var operationStatus = String(receiptOperation.values ? receiptOperation.values[5] : receiptOperation.status || "UNKNOWN");
    throw new Error("Для поставки уже существует операция приёмки (" + operationStatus + "). Сначала восстанови или вручную сверь её в Operations; отменять документ с незавершённой/зафиксированной приёмкой нельзя.");
  }
  var status = di3NormalizeSupplyStatus_(supply.status);
  if (status === DI3_SUPPLY_STATUS.CANCELLED) return { already_cancelled: true };
  if (status === DI3_SUPPLY_STATUS.RECEIVED) {
    throw new Error("Полученную поставку отменить нельзя: она уже создала складские движения и FIFO-партии.");
  }
  if ([DI3_SUPPLY_STATUS.CREATED, DI3_SUPPLY_STATUS.SENT, DI3_SUPPLY_STATUS.AWAITING].indexOf(status) === -1) {
    throw new Error("Поставку в статусе «" + di3GetSupplyStatusLabel_(status) + "» отменить нельзя.");
  }
  return { already_cancelled: false };
}

/** Cancel a supply before receipt. No stock movements or FIFO lots are created/reversed. */
function di3CancelSupplyByNumber_(supplyNumber, reason) {
  return di3WithLock_(function () {
    di3EnsureStockCoreSchemas_();
    var number = String(supplyNumber || "").trim();
    var supply = di3FindSupplyByNumber_(number);
    if (!supply) throw new Error("Поставка не найдена: " + number);

    var previousStatus = String(supply.status || "");
    var receiptOperation = di3GetSupplyReceiptOperation_(supply.supply_id);
    var receiptMovements = di3ReadRowsByColumnValue_("StockLedger", 5, supply.supply_id);
    var eligibility = di3ValidateSupplyCancellation_(supply, receiptOperation, receiptMovements.length);
    var cancelledAt = eligibility.already_cancelled && supply.updated_at instanceof Date
      ? new Date(supply.updated_at.getTime()) : new Date();
    var recoveredWriteAck = false;

    if (!eligibility.already_cancelled) {
      try {
        di3SetSupplyCancelledCell_(supply, cancelledAt);
      } catch (writeError) {
        // A Sheets write can succeed while the acknowledgement is lost. Read the
        // persisted document before deciding whether this is a real failure.
        var afterWrite = di3GetSupplyById_(supply.supply_id);
        if (!afterWrite || String(afterWrite.status) !== DI3_SUPPLY_STATUS.CANCELLED) throw writeError;
        supply = afterWrite;
        cancelledAt = afterWrite.updated_at instanceof Date ? new Date(afterWrite.updated_at.getTime()) : cancelledAt;
        recoveredWriteAck = true;
      }
    }

    // Preserve the pre-write status for a correct history transition even when
    // the Sheets acknowledgement is lost and the persisted row is re-read.
    var oldStatus = eligibility.already_cancelled ? "" : previousStatus;
    di3EnsureSupplyStatusHistory_(supply.supply_id, oldStatus, DI3_SUPPLY_STATUS.CANCELLED,
      cancelledAt, "", eligibility.already_cancelled ? "Восстановление истории отмены поставки" : (reason || "Отмена поставки пользователем"));
    di3RefreshSupplyRegister();
    di3RefreshSupplyFormValidations();

    var formSheet = di3GetSpreadsheet_().getSheetByName(DI3_SUPPLY_FORM_SHEET);
    if (formSheet && String(formSheet.getRange(DI3_SUPPLY_FORM.editSupplyId).getValue() || "") === String(supply.supply_id)) {
      var fullEditActive = String(formSheet.getRange(DI3_SUPPLY_FORM.fullEditMode).getValue() || "") === "FULL_EDIT";
      if (fullEditActive || di3HasUnsavedSupplyFormChanges_(formSheet)) {
        di3GetSpreadsheet_().toast("Поставка отменена, но форма оставлена без очистки: в ней есть активное полное редактирование или несохранённые изменения.", "Форма поставки сохранена", 8);
      } else {
        di3NewSupplyForm({ skipUnsavedConfirmation: true });
      }
    }
    return {
      status: eligibility.already_cancelled ? "ALREADY_CANCELLED" : (recoveredWriteAck ? "CANCELLED_ACK_RECOVERED" : "CANCELLED"),
      supply_id: supply.supply_id,
      supply_number: supply.supply_number,
      previous_status: oldStatus,
      cancelled_at: cancelledAt,
      stock_movements_created: 0
    };
  });
}

/** UI action: cancellation requires an explicit confirmation from the register. */
function di3CancelSelectedSupply() {
  var selected = di3GetSelectedSupplyRegisterRow_();
  var ui = SpreadsheetApp.getUi();
  var reasonPrompt = ui.prompt(
    "Причина отмены поставки " + selected.supply_number,
    "Укажи причину отмены (необязательно). Нажми OK, чтобы продолжить, или Cancel, чтобы выйти.",
    ui.ButtonSet.OK_CANCEL
  );
  if (!reasonPrompt || reasonPrompt.getSelectedButton() !== ui.Button.OK) return { status: "CANCELLED_BY_USER" };
  var reason = String(reasonPrompt.getResponseText() || "").trim();
  var confirmationText = "Поставка будет отмечена как «Отменена». Отмена доступна только до фактического получения и не создаёт складских движений.";
  if (reason) confirmationText += "\n\nПричина: " + reason;
  confirmationText += "\n\nПродолжить?";
  var answer = ui.alert("Отменить поставку " + selected.supply_number + "?", confirmationText, ui.ButtonSet.YES_NO);
  if (answer !== ui.Button.YES) return { status: "CANCELLED_BY_USER" };
  var result = di3CancelSupplyByNumber_(selected.supply_number, reason || "Отмена подтверждена пользователем из реестра поставок");
  di3GetSpreadsheet_().toast(
    result.status === "ALREADY_CANCELLED" ? "Поставка уже отменена" : "Поставка отменена",
    "Поставка " + selected.supply_number, 5
  );
  return result;
}


/** Capture editable next-stage timestamps before the generated register header is upgraded. */
/** Capture editable next-stage date/time inputs before the register header is upgraded. */
function di3GetSupplyRegisterEffectiveDates_(sheet) {
  if (!sheet || sheet.getLastRow() < 4) return {};
  var width = Math.min(DI3_SUPPLY_REGISTER_HEADERS.length, sheet.getMaxColumns());
  var headers = sheet.getRange(3, 1, 1, width).getDisplayValues()[0].map(di3NormalizeHeader_);
  var known13 = [DI3_SUPPLY_REGISTER_PREVIOUS_CURRENT_HEADERS,
    DI3_SUPPLY_REGISTER_PREVIOUS_ORDER_HEADERS, DI3_SUPPLY_REGISTER_COMPAT_HEADERS,
    DI3_SUPPLY_REGISTER_PREVIOUS_HEADERS];
  var modern13 = known13.some(function (known) {
    return headers.length >= 13 && headers.slice(0, 13).join("|") === known.join("|");
  });
  var current14 = headers.length >= 14 && headers.slice(0, 14).join("|") === DI3_SUPPLY_REGISTER_HEADERS.join("|");
  var legacy = headers.length >= DI3_SUPPLY_REGISTER_LEGACY_HEADERS.length &&
    headers.slice(0, DI3_SUPPLY_REGISTER_LEGACY_HEADERS.length).join("|") === DI3_SUPPLY_REGISTER_LEGACY_HEADERS.join("|");
  if (!modern13 && !current14 && !legacy) return {};
  var oldWidth = current14 ? 14 : (modern13 ? 13 : DI3_SUPPLY_REGISTER_LEGACY_HEADERS.length);
  var rows = sheet.getRange(4, 1, sheet.getLastRow() - 3, oldWidth).getValues();
  var idIndex = modern13 || current14 ? 11 : 9;
  var dateIndex = modern13 || current14 ? 12 : 10;
  var result = {};
  rows.forEach(function (row) {
    var supplyId = row[idIndex];
    if (!supplyId) return;
    result[String(supplyId)] = current14
      ? { date: row[12] || "", time: String(row[13] || "") }
      : di3SplitRegisterEffectiveInput_(row[dateIndex] || "");
  });
  return result;
}

function di3SetupSupplyRegisterSheet() {
  di3EnsureCoreFoundationSchemas_();
  var ss = di3GetSpreadsheet_();
  var sheet = ss.getSheetByName(DI3_SUPPLY_REGISTER_SHEET);
  var created = false;
  if (!sheet) {
    sheet = ss.insertSheet(DI3_SUPPLY_REGISTER_SHEET);
    di3PrepareNewSheet_(sheet, 3, DI3_SUPPLY_REGISTER_HEADERS.length);
    created = true;
  }
  di3EnsureSheetCapacity_(sheet, Math.max(3, sheet.getLastRow()), DI3_SUPPLY_REGISTER_HEADERS.length);
  if (!created && sheet.getLastRow() > 0) {
    var current = sheet.getRange(3, 1, 1, DI3_SUPPLY_REGISTER_HEADERS.length).getDisplayValues()[0].map(di3NormalizeHeader_);
    var previousCurrent = sheet.getRange(3, 1, 1, 13).getDisplayValues()[0].map(di3NormalizeHeader_);
    var previousOrder = sheet.getRange(3, 1, 1, DI3_SUPPLY_REGISTER_PREVIOUS_ORDER_HEADERS.length).getDisplayValues()[0].map(di3NormalizeHeader_);
    var legacy = sheet.getRange(3, 1, 1, DI3_SUPPLY_REGISTER_LEGACY_HEADERS.length).getDisplayValues()[0].map(di3NormalizeHeader_);
    var previous = sheet.getRange(3, 1, 1, DI3_SUPPLY_REGISTER_PREVIOUS_HEADERS.length).getDisplayValues()[0].map(di3NormalizeHeader_);
    var compat = sheet.getRange(3, 1, 1, DI3_SUPPLY_REGISTER_COMPAT_HEADERS.length).getDisplayValues()[0].map(di3NormalizeHeader_);
    var isCurrent = current.join("|") === DI3_SUPPLY_REGISTER_HEADERS.join("|");
    var isPreviousCurrent = previousCurrent.join("|") === DI3_SUPPLY_REGISTER_PREVIOUS_CURRENT_HEADERS.join("|");
    var isPreviousOrder = previousOrder.join("|") === DI3_SUPPLY_REGISTER_PREVIOUS_ORDER_HEADERS.join("|");
    var isCompat = compat.join("|") === DI3_SUPPLY_REGISTER_COMPAT_HEADERS.join("|");
    var isPrevious = previous.join("|") === DI3_SUPPLY_REGISTER_PREVIOUS_HEADERS.join("|");
    var isLegacy = legacy.join("|") === DI3_SUPPLY_REGISTER_LEGACY_HEADERS.join("|");
    if (!isCurrent && !isPreviousCurrent && !isPreviousOrder && !isCompat && !isPrevious && !isLegacy) {
      throw new Error("Лист «Реестр поставок v3» имеет неизвестную структуру. Автоматическая перезапись остановлена.");
    }
    if (di3PreflightHasBodyValues_(sheet, 14, 1) && !isCurrent) {
      throw new Error("Реестр поставок: колонка N содержит данные без заголовка. Добавление времени следующего этапа остановлено.");
    }
  }
  var preservedDateTimesById = di3GetSupplyRegisterEffectiveDates_(sheet);
  sheet.getRange("A1:N2").breakApart();
  sheet.getRange("A1:N1").merge();
  sheet.getRange("A1").setValue("РЕЕСТР ПОСТАВОК");
  sheet.getRange("A2:N2").merge();
  sheet.getRange("A2").setValue("A — автоматическая дата записи в Dots Inventory. Цепочка дат: Оформлена → Отправлена → Ожидает получения → Получена. Сортировка — по дате оформления. Для следующего этапа заполни M (дату) и N (время HH:mm); обе ячейки обязательны.");
  sheet.getRange(3, 1, 1, DI3_SUPPLY_REGISTER_HEADERS.length).setValues([DI3_SUPPLY_REGISTER_HEADERS]);
  sheet.getRange("A1:N1").setBackground("#17243A").setFontColor("#FFFFFF").setFontWeight("bold").setFontSize(14);
  sheet.getRange("A2:N2").setBackground("#EAF0F7").setFontColor("#40516A");
  sheet.getRange("A3:N3").setBackground("#253B59").setFontColor("#FFFFFF").setFontWeight("bold");
  di3SetFrozenRowsSafely_(sheet, 3);
  [190, 150, 220, 145, 160, 200, 145, 160, 150, 130, 280, 90, 145, 120].forEach(function (width, index) {
    sheet.setColumnWidth(index + 1, width);
  });
  sheet.hideColumns(12);
  sheet.showColumns(13, 2);
  di3CompactSheet_(sheet, Math.max(3, sheet.getLastRow()), DI3_SUPPLY_REGISTER_HEADERS.length);
  sheet.setHiddenGridlines(true);
  di3RefreshSupplyRegister(preservedDateTimesById);
  return { status: "READY", sheet: DI3_SUPPLY_REGISTER_SHEET, columns: DI3_SUPPLY_REGISTER_HEADERS.length, upgraded: !created };
}

function di3RefreshSupplyRegister(preservedDateTimesById) {
  var sheet = di3GetSpreadsheet_().getSheetByName(DI3_SUPPLY_REGISTER_SHEET);
  if (!sheet) return { refreshed: false, reason: "SHEET_MISSING" };
  var dateTimesById = preservedDateTimesById && typeof preservedDateTimesById === "object"
    ? preservedDateTimesById : di3GetSupplyRegisterEffectiveDates_(sheet);
  var supplies = di3ReadTableValues_("V3_Supplies");
  var headers = DI3_TABLE_SCHEMAS.V3_Supplies;
  var orderDateIndex = headers.indexOf("supplier_order_date");
  var expectedDateIndex = headers.indexOf("expected_received_date");
  var rows = supplies.map(function (row) {
    var supplyId = String(row[0] || "");
    var input = dateTimesById[supplyId] || { date: "", time: "" };
    return [
      row[4], row[1], row[2],
      orderDateIndex >= 0 ? row[orderDateIndex] || "" : "",
      row[5], row[6], row[7],
      expectedDateIndex >= 0 ? row[expectedDateIndex] || "" : "",
      di3GetSupplyStatusLabel_(row[3]), row[13], row[14], supplyId,
      input.date || "", input.time || ""
    ];
  }).sort(function (a, b) {
    return di3CompareSupplyOrderChronology_(a[3], a[0], a[1], b[3], b[0], b[1]);
  });
  var oldCount = Math.max(0, sheet.getLastRow() - 3);
  di3EnsureSheetCapacity_(sheet, Math.max(3, 3 + rows.length), DI3_SUPPLY_REGISTER_HEADERS.length);
  if (oldCount) sheet.getRange(4, 1, oldCount, DI3_SUPPLY_REGISTER_HEADERS.length).clearContent();
  if (rows.length) {
    sheet.getRange(4, 1, rows.length, DI3_SUPPLY_REGISTER_HEADERS.length).setValues(rows);
    sheet.getRange(4, 1, rows.length, 1).setNumberFormat("dd.mm.yyyy hh:mm");
    sheet.getRange(4, 4, rows.length, 1).setNumberFormat("dd.mm.yyyy");
    sheet.getRange(4, 5, rows.length, 3).setNumberFormat("dd.mm.yyyy hh:mm");
    sheet.getRange(4, 8, rows.length, 1).setNumberFormat("dd.mm.yyyy");
    sheet.getRange(4, 10, rows.length, 1).setNumberFormat("#,##0.00 ₽");
    sheet.getRange(4, 13, rows.length, 1).setDataValidation(
      SpreadsheetApp.newDataValidation().requireDate().setAllowInvalid(false).build()
    ).setNumberFormat("dd.mm.yyyy").setNote("Календарная дата следующего этапа. Время укажи отдельно в колонке N.");
    sheet.getRange(4, 14, rows.length, 1).setNumberFormat("@")
      .setNote("Обязательное местное время следующего этапа в формате HH:mm (24 часа).");
    sheet.getBandings().forEach(function (banding) { banding.remove(); });
    di3ApplyLightBandingWithDarkText_(sheet.getRange(4, 1, rows.length, DI3_SUPPLY_REGISTER_HEADERS.length));
    var filter = sheet.getFilter();
    var filterRange = sheet.getRange(3, 1, rows.length + 1, DI3_SUPPLY_REGISTER_HEADERS.length);
    if (filter) di3SetFilterRangePreservingCriteria_(sheet, filterRange); else filterRange.createFilter();
  } else {
    sheet.getBandings().forEach(function (banding) { banding.remove(); });
    var emptyFilter = sheet.getFilter();
    if (emptyFilter && typeof emptyFilter.remove === "function") emptyFilter.remove();
  }
  di3SetFrozenRowsSafely_(sheet, 3);
  sheet.hideColumns(12);
  sheet.showColumns(13, 2);
  di3CompactSheet_(sheet, Math.max(3, 3 + rows.length), DI3_SUPPLY_REGISTER_HEADERS.length);
  return { refreshed: true, supplies: rows.length, max_rows: sheet.getMaxRows(), max_columns: sheet.getMaxColumns() };
}

function di3BuildRecoverPendingOperationsConfirmationText_(report) {
  report = report || {};
  var recoverable = Array.isArray(report.recoverable) ? report.recoverable : [];
  var eligible = recoverable.filter(function (item) {
    return item.handler_available && (item.retry_ready || String(item.status) === "PREPARED");
  });
  var waiting = recoverable.length - eligible.length;
  var counts = report.counts || {};
  var byType = {};
  eligible.forEach(function (item) {
    var type = String(item.operation_type || "UNKNOWN");
    byType[type] = (byType[type] || 0) + 1;
  });
  var typeLines = Object.keys(byType).sort().map(function (type) {
    return "• " + type + ": " + byType[type];
  });
  return [
    "Будет выполнена проверка незавершённых операций и попытка безопасно завершить операции PREPARED/RETRYABLE, для которых доступен обработчик и наступило время повтора.",
    "",
    "Готово к восстановлению: " + eligible.length,
    "Ожидает повтора или незавершённой попытки: " + waiting,
    "Без обработчика: " + Number(counts.unsupported || 0),
    "В карантине (не запускаются этой командой): " + Number(counts.quarantined || 0),
    "",
    typeLines.length ? "Типы операций к восстановлению:\n" + typeLines.join("\n") : "Подходящих операций сейчас не обнаружено.",
    "",
    "Восстановление может завершить ранее подготовленные движения склада, приёмки поставок, отправки/возвраты заказов или создание документов. Новые операции по уже завершённым записям не создаются; payload и idempotency проверяются.",
    "Операции в карантине и записи без обработчика эта команда не запускает.",
    "",
    "Продолжить?"
  ].join("\n");
}

function di3RecoverAllPendingOperations() {
  var preview = di3GetOperationRecoveryReport_(); // read-only preflight; the operation set is checked again under lock below.
  var ui = SpreadsheetApp.getUi();
  var answer = ui.alert(
    "Подтверждение восстановления операций",
    di3BuildRecoverPendingOperationsConfirmationText_(preview),
    ui.ButtonSet.YES_NO
  );
  if (answer !== ui.Button.YES) return { status: "CANCELLED_BY_USER", recovered: 0 };
  return di3WithLock_(function () {
    di3EnsureStockCoreSchemas_();
    var manual = di3RecoverPreparedOperations_(["MANUAL_STOCK_MOVEMENT"]);
    var supply = di3RecoverPreparedOperations_(["SUPPLY_RECEIVE"]);
    var supplyEdits = di3RecoverPreparedOperations_(["SUPPLY_DOCUMENT_EDIT"]);
    var orders = di3RecoverPreparedOperations_(["ORDER_CREATE", "ORDER_DISPATCH", "ORDER_RETURN"]);
    // If a pending full-edit operation was completed for the document currently
    // loaded in the form, clear the edit lock and reload the authoritative row.
    // This is a form projection only; the operation handler has already committed.
    var activeForm = di3GetSpreadsheet_().getSheetByName(DI3_SUPPLY_FORM_SHEET);
    if (activeForm && String(activeForm.getRange(DI3_SUPPLY_FORM.fullEditMode).getValue() || "") === "FULL_EDIT") {
      var activeSupplyId = String(activeForm.getRange(DI3_SUPPLY_FORM.editSupplyId).getValue() || "");
      var recoveredActiveEdit = (supplyEdits.results || []).some(function (result) {
        return String(result.status) === "COMMITTED" && String(result.supply_id || "") === activeSupplyId;
      });
      if (recoveredActiveEdit) di3EndFullSupplyEditMode(true);
    }
    var report = di3GetOperationRecoveryReport_();
    return {
      manual_stock: manual,
      supply_receipts: supply,
      supply_document_edits: supplyEdits,
      orders: orders,
      unsupported: report.unsupported,
      quarantined: report.quarantined,
      recovery_report: report
    };
  });
}
