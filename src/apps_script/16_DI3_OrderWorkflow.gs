/** Dots Inventory v3 — order status machine, FIFO dispatch/return and recovery. */
var DI3_ORDER_ALLOWED_TRANSITIONS = Object.freeze({
  "Новый": ["В пути", "Отменен"],
  "В пути": ["Завершен", "Возвращается"],
  "Возвращается": ["Возврат"],
  "Завершен": [], "Возврат": [], "Отменен": []
});

function di3GetOrderOperationByKey_(key) {
  return di3FindRowByColumnValue_("Operations", 1, key);
}

function di3CreateOrderOperation_(idempotencyKey, operationType, orderId, payload) {
  return di3RegisterPreparedOperation_({
    idempotency_key: idempotencyKey,
    operation_type: operationType,
    document_type: "ORDER",
    document_id: orderId,
    payload: payload
  });
}

function di3GetNextMovementDisplayCodeSequence_() {
  return di3ReadTableColumnValues_("StockMovementDetails", 1).reduce(function (max, value) {
    var match = String(value || "").match(/^MOV-(\d+)$/);
    return match ? Math.max(max, Number(match[1])) : max;
  }, 0);
}

function di3BuildOrderDispatchPayload_(order, items, effectiveAt) {
  if (!order || !items.length) throw new Error("У заказа нет позиций для отправки.");
  var recordedAt = new Date();
  var sequence = di3GetNextMovementDisplayCodeSequence_();
  var lines = items.map(function (item) {
    if (!Number.isInteger(Number(item.quantity)) || Number(item.quantity) <= 0) {
      throw new Error("Заказ содержит некорректное количество.");
    }
    sequence++;
    return {
      order_item_id: String(item.order_item_id),
      product_id: String(item.product_id),
      product_label: String(item.product_label_snapshot || ""),
      quantity: Number(item.quantity),
      sale_unit_price: Number(item.sale_unit_price),
      line_revenue: Number(item.line_revenue),
      movement_id: di3MakeUuid_(),
      event_key: "ORDER_DISPATCH:" + order.order_id + ":" + item.order_item_id,
      display_code: "MOV-" + String(sequence).padStart(6, "0")
    };
  });
  return {
    order_id: String(order.order_id),
    order_number: String(order.order_number),
    dispatched_at: effectiveAt.toISOString(),
    recorded_at: recordedAt.toISOString(),
    lines: lines
  };
}

function di3BuildOrderDispatchRows_(operationId, payload) {
  var ledger = [], details = [];
  var actor = di3GetOperationInitiatorActor_(operationId);
  payload.lines.forEach(function (line) {
    ledger.push([
      line.movement_id, operationId, line.event_key, line.product_id,
      "ORDER", payload.order_id, -line.quantity,
      new Date(payload.dispatched_at), new Date(payload.recorded_at), "", "",
      "Списание при отправке заказа " + payload.order_number, di3RequireLedgerSequence_(line.ledger_sequence, line.movement_id)
    ]);
    details.push([
      line.movement_id, line.display_code, "OUT", "ORDER_DISPATCH",
      line.sale_unit_price, line.line_revenue, "", "", actor,
      "Заказ " + payload.order_number, "ORDER"
    ]);
  });
  return { ledger: ledger, details: details };
}

function di3UpdateOrderItemsDispatchLinks_(payload) {
  var rows = di3ReadRowsByColumnValue_("V3_OrderItems", 1, payload.order_id);
  var movementsByItem = {};
  payload.lines.forEach(function (line) { movementsByItem[String(line.order_item_id)] = String(line.movement_id); });
  var updates = [];
  var matchedItems = {};
  rows.forEach(function (match) {
    var row = match.values;
    var itemId = String(row[0] || "");
    var movementId = movementsByItem[itemId];
    if (!movementId) return;
    if (matchedItems[itemId]) throw new Error("Обнаружена повторная строка позиции заказа " + itemId + ".");
    matchedItems[itemId] = true;
    if (String(row[11] || "") === movementId) return;
    if (row[11] && String(row[11]) !== movementId) throw new Error("У позиции заказа уже есть другое движение списания.");
    var values = row.slice();
    values[11] = movementId;
    values[15] = new Date();
    updates.push({ row_number: match.row_number, values: values });
  });
  if (Object.keys(matchedItems).length !== payload.lines.length) throw new Error("Не удалось сопоставить все позиции заказа со списаниями.");
  if (updates.length) di3ApplyContiguousRowUpdates_("V3_OrderItems", updates);
}

function di3WriteOrderStatus_(order, newStatus, effectiveAt, operationId, note) {
  var oldStatus = String(order.status);
  var map = {
    "В пути": "dispatched_at", "Завершен": "completed_at",
    "Возвращается": "returning_at", "Возврат": "returned_at", "Отменен": "cancelled_at"
  };
  var field = map[newStatus];
  if (!field) throw new Error("Неизвестный статус заказа: " + newStatus);
  var schema = DI3_TABLE_SCHEMAS.V3_Orders;
  var sheet = di3GetSheetOrThrow_("V3_Orders");
  var row = sheet.getRange(order.row_number, 1, 1, schema.length).getValues()[0];
  row[schema.indexOf("status")] = newStatus;
  row[schema.indexOf(field)] = effectiveAt;
  row[schema.indexOf("updated_at")] = new Date();

  // A sale is financially settled only after the buyer completes pickup/receipt.
  // The payer choice determines whether the fee is added to buyer payment or
  // deducted from seller proceeds; the platform fee itself remains recorded.
  var sellerRevenueIndex = schema.indexOf("seller_revenue");
  var realizedFeeIndex = schema.indexOf("platform_commission_realized");
  var buyerPaidIndex = schema.indexOf("buyer_paid_total");
  var settlementStatusIndex = schema.indexOf("settlement_status");
  var finalizedAtIndex = schema.indexOf("settlement_finalized_at");
  if (newStatus === DI3_ORDER_STATUS.COMPLETED) {
    var goodsCents = di3OrderToCents_(Number(row[schema.indexOf("goods_amount")]) || 0);
    var discountCents = di3OrderToCents_(Number(row[schema.indexOf("discount_amount")]) || 0);
    var commissionCents = di3OrderToCents_(Number(row[schema.indexOf("commission_amount")]) || 0);
    var payer = String(row[schema.indexOf("commission_payer")] || "BUYER");
    var split = di3CalculateOrderCommissionSplit_(goodsCents, discountCents, commissionCents, payer);
    row[sellerRevenueIndex] = di3MoneyFromMinorUnits_(split.seller_revenue_cents);
    row[realizedFeeIndex] = di3MoneyFromMinorUnits_(commissionCents);
    row[buyerPaidIndex] = di3MoneyFromMinorUnits_(split.buyer_paid_cents);
    row[settlementStatusIndex] = "SETTLED";
    row[finalizedAtIndex] = effectiveAt;
  } else if (newStatus === DI3_ORDER_STATUS.RETURNED || newStatus === DI3_ORDER_STATUS.CANCELLED) {
    // Uncollected/cancelled transaction: the quoted surcharge is not realized.
    row[sellerRevenueIndex] = 0;
    row[realizedFeeIndex] = 0;
    row[buyerPaidIndex] = 0;
    row[settlementStatusIndex] = "NOT_COMPLETED";
    row[finalizedAtIndex] = effectiveAt;
  }
  // One row write keeps status and its settlement outcome together.
  sheet.getRange(order.row_number, 1, 1, schema.length).setValues([row]);
  di3EnsureOrderStatusHistory_(order.order_id, oldStatus, newStatus, effectiveAt, operationId, note || "Изменение статуса заказа");
  return di3GetOrderById_(order.order_id);
}

function di3EnsureOrderStatusHistory_(orderId, oldStatus, newStatus, effectiveAt, operationId, comment) {
  var exists = di3ReadRowsByColumnValue_("DocumentStatusHistory", 2, orderId).some(function (match) {
    var row = match.values;
    return String(row[1]) === "ORDER" && String(row[4]) === String(newStatus);
  });
  if (exists) return false;
  di3AppendTableRows_("DocumentStatusHistory", [[
    di3MakeUuid_(), "ORDER", orderId, oldStatus || "", newStatus,
    effectiveAt, operationId ? di3GetOperationInitiatorActor_(operationId) : di3GetActorEmail_(), operationId || "", comment || ""
  ]]);
  return true;
}

function di3CompleteOrderDispatch_(operationRecord, payloadOverride) {
  // payloadOverride is ignored; only the persisted, verified payload is executable.
  return di3ExecutePreparedOperation_(operationRecord);
}

function di3ApplyOrderDispatchOperation_(operationRecord, payload) {
  var operationId = String(operationRecord.values[0]);
  var order = di3GetOrderById_(payload.order_id);
  if (!order) throw new Error("Заказ для восстановления отправки не найден.");
  var rows = di3BuildOrderDispatchRows_(operationId, payload);
  var productIds = payload.lines.map(function (line) { return line.product_id; });
  var eventKeys = rows.ledger.map(function (row) { return String(row[2]); });
  var movementIds = rows.ledger.map(function (row) { return String(row[0]); });
  var existingLedger = di3ReadRowsByColumnValues_("StockLedger", 2, eventKeys).map(function (match) { return match.values; });
  var existingDetails = di3ReadRowsByColumnValues_("StockMovementDetails", 0, movementIds).map(function (match) { return match.values; });
  var ledgerKeys = Object.create(null), detailIds = Object.create(null);
  existingLedger.forEach(function (row) { ledgerKeys[String(row[2])] = true; });
  existingDetails.forEach(function (row) { detailIds[String(row[0])] = true; });
  di3PreflightFifoForProductsScoped_(rows.ledger, rows.details, [], productIds);
  var missingLedger = rows.ledger.filter(function (row) { return !ledgerKeys[String(row[2])]; });
  var missingDetails = rows.details.filter(function (row) { return !detailIds[String(row[0])]; });
  di3AppendTableRows_("StockLedger", missingLedger);
  di3AppendTableRows_("StockMovementDetails", missingDetails);
  di3UpdateOrderItemsDispatchLinks_(payload);
  var fifo = di3RebuildFifoAllocations_("ORDER_DISPATCH", productIds);
  order = di3GetOrderById_(payload.order_id);
  if (String(order.status) !== DI3_ORDER_STATUS.IN_TRANSIT) {
    order = di3WriteOrderStatus_(order, DI3_ORDER_STATUS.IN_TRANSIT, new Date(payload.dispatched_at), operationId,
      "Склад списан по FIFO при отправке заказа");
  } else {
    di3EnsureOrderStatusHistory_(order.order_id, DI3_ORDER_STATUS.NEW, DI3_ORDER_STATUS.IN_TRANSIT,
      order.dispatched_at || new Date(payload.dispatched_at), operationId, "Восстановление истории отправки заказа");
  }
  // Rebuild already refreshes snapshots for the affected product IDs.
  di3RefreshOrderRegister();
  return {
    status: "COMMITTED", order_id: payload.order_id, order_number: payload.order_number,
    movements_created: rows.ledger.length,
    units_dispatched: payload.lines.reduce(function (sum, line) { return sum + line.quantity; }, 0),
    fifo_run_id: fifo.run_id
  };
}

function di3DispatchOrder_(order, effectiveAt) {
  if (String(order.status) === DI3_ORDER_STATUS.IN_TRANSIT) {
    return { status: "ALREADY_DISPATCHED", order_number: order.order_number };
  }
  if (String(order.status) !== DI3_ORDER_STATUS.NEW) throw new Error("Отправить можно только заказ со статусом «Новый».");
  var date = di3ParseSupplyEffectiveDate_(effectiveAt, new Date());
  if (date.getTime() > Date.now() + 5 * 60 * 1000) throw new Error("Дата отправки не может быть в будущем.");
  if (date.getTime() < di3ToMillis_(order.created_at)) throw new Error("Дата отправки не может быть раньше создания заказа.");
  var items = di3GetOrderItems_(order.order_id);
  if (!items.length) throw new Error("У заказа нет товарных позиций.");
  var key = "ORDER_DISPATCH:" + order.order_id;
  di3AssertNoOtherPendingStockOperations_(key);
  var existing = di3GetOrderOperationByKey_(key);
  if (existing) {
    if (String(existing.values[5]) === "COMMITTED") return { status: "ALREADY_DISPATCHED", order_number: order.order_number };
    if (String(existing.values[5]) === "REJECTED") throw new Error("Предыдущая операция отправки отклонена. Проверь журнал Operations.");
    return di3CompleteOrderDispatch_(existing, null);
  }
  di3AssertPeriodOpen_(date, "Отправка заказа");
  items.forEach(function (item) {
    di3AssertNoBackdatedMovementBeforeReturnedOrder_(item.product_id, date, "отправка заказа");
  });
  var payload = di3BuildOrderDispatchPayload_(order, items, date);
  di3AssignLedgerSequencesToLines_(payload.lines);
  // Preflight before creating the operation record, so insufficient stock does not leave a rejected token.
  var candidate = di3BuildOrderDispatchRows_("PREFLIGHT", payload);
  di3PreflightFifoForProductsScoped_(candidate.ledger, candidate.details, [],
    payload.lines.map(function (line) { return line.product_id; }));
  var operation = di3CreateOrderOperation_(key, "ORDER_DISPATCH", order.order_id, payload);
  return di3CompleteOrderDispatch_(operation, payload);
}

function di3GetLotById_(lotId) {
  var match = di3ReadRowByColumnValue_("StockLots", 0, lotId);
  return match ? match.values : null;
}

/**
 * StockAllocations is the active projection, not a single-run snapshot.
 * Product replays replace the rows for one product, while incremental runs
 * append rows for the products they touched. As a result, valid active rows
 * can legitimately carry different allocation_run_id values.
 *
 * For an order return, the stable relationship is the original dispatch
 * movement_id plus allocation_type=CONSUME. Never scope this lookup to the
 * globally latest FIFO run: an unrelated stock operation may have created it.
 */
function di3SelectOrderDispatchConsumeAllocations_(allocationRows, dispatchMovementIds) {
  var movementIds = Object.create(null);
  (dispatchMovementIds || []).forEach(function (movementId) {
    if (movementId != null && String(movementId) !== "") movementIds[String(movementId)] = true;
  });
  if (!Object.keys(movementIds).length) return [];
  return (allocationRows || []).filter(function (row) {
    return Object.prototype.hasOwnProperty.call(movementIds, String(row[2])) &&
      String(row[5]) === "CONSUME";
  });
}

/** Return the original dispatch allocations for one order line, fail-closed on quantity mismatch. */
function di3GetOrderItemReturnAllocations_(allocations, item) {
  if (!item || !item.dispatch_movement_id) {
    throw new Error("У позиции заказа отсутствует движение первоначального списания.");
  }
  var itemAllocations = (allocations || []).filter(function (row) {
    return String(row[2]) === String(item.dispatch_movement_id);
  });
  var allocatedQty = itemAllocations.reduce(function (sum, row) {
    return sum + Number(row[6] || 0);
  }, 0);
  if (allocatedQty !== Number(item.quantity)) {
    throw new Error("FIFO-распределение позиции «" + item.product_label_snapshot + "» не совпадает с количеством заказа.");
  }
  return itemAllocations;
}

function di3BuildOrderReturnPayload_(order, items, effectiveAt) {
  var dispatchMovementIds = items.map(function (item) { return String(item.dispatch_movement_id || ""); }).filter(Boolean);
  var allocationRows = di3ReadRowsByColumnValues_("StockAllocations", 2, dispatchMovementIds)
    .map(function (match) { return match.values; });
  var allocations = di3SelectOrderDispatchConsumeAllocations_(allocationRows, dispatchMovementIds);
  var sourceLotIds = allocations.map(function (row) { return String(row[3]); });
  var lotRows = sourceLotIds.length ? di3ReadRowsByColumnValues_("StockLots", 0, sourceLotIds).map(function (match) { return match.values; }) : [];
  var lotsById = {};
  lotRows.forEach(function (row) { lotsById[String(row[0])] = row; });
  var sourceFifoRunIds = [];
  var seenSourceFifoRunIds = Object.create(null);
  allocations.forEach(function (row) {
    var runId = String(row[1] || "");
    if (runId && !seenSourceFifoRunIds[runId]) {
      seenSourceFifoRunIds[runId] = true;
      sourceFifoRunIds.push(runId);
    }
  });
  var recordedAt = new Date();
  var sequence = di3GetNextMovementDisplayCodeSequence_();
  var lines = [];
  items.forEach(function (item) {
    var itemAllocations = di3GetOrderItemReturnAllocations_(allocations, item);
    itemAllocations.forEach(function (allocation, index) {
      var sourceLot = lotsById[String(allocation[3])] || null;
      if (!sourceLot) throw new Error("Не найдена исходная FIFO-партия для возврата.");
      sequence++;
      var costStatus = String(allocation[8]);
      var totalCostMinor = di3MoneyGetAllocationCostMinor_(allocation);
      lines.push({
        order_item_id: String(item.order_item_id),
        product_id: String(item.product_id),
        product_label: String(item.product_label_snapshot || ""),
        quantity: Number(allocation[6]),
        unit_cost: costStatus === "UNKNOWN" ? "" : (Number(totalCostMinor) / 100 / Number(allocation[6])),
        total_cost_minor: totalCostMinor == null ? "" : totalCostMinor,
        cost_status: costStatus,
        pack_variant_id: String(sourceLot[5] || ""),
        original_dispatch_movement_id: String(item.dispatch_movement_id),
        source_lot_id: String(allocation[3]),
        movement_id: di3MakeUuid_(),
        lot_id: di3MakeUuid_(),
        event_key: "ORDER_RETURN:" + order.order_id + ":" + item.order_item_id + ":" + index,
        display_code: "MOV-" + String(sequence).padStart(6, "0")
      });
    });
  });
  if (!lines.length) throw new Error("Не удалось сформировать партии возвращаемого товара.");
  return {
    order_id: String(order.order_id), order_number: String(order.order_number),
    returned_at: effectiveAt.toISOString(), recorded_at: recordedAt.toISOString(),
    // Keep run IDs as provenance only. A single order may reference active
    // allocations produced by more than one incremental FIFO run.
    source_fifo_run_id: sourceFifoRunIds.length === 1 ? sourceFifoRunIds[0] : "",
    source_fifo_run_ids: sourceFifoRunIds,
    lines: lines
  };
}

function di3BuildOrderReturnRows_(operationId, payload) {
  var ledger = [], details = [], lots = [];
  var actor = di3GetOperationInitiatorActor_(operationId);
  payload.lines.forEach(function (line) {
    ledger.push([
      line.movement_id, operationId, line.event_key, line.product_id,
      "ORDER_RETURN", payload.order_id, line.quantity,
      new Date(payload.returned_at), new Date(payload.recorded_at), "", "",
      "Фактический возврат заказа " + payload.order_number, di3RequireLedgerSequence_(line.ledger_sequence, line.movement_id)
    ]);
    details.push([
      line.movement_id, line.display_code, "IN", "ORDER_RETURN", "", "",
      line.cost_status, line.original_dispatch_movement_id, actor,
      "Возврат исходной FIFO-партии " + line.source_lot_id, "ORDER"
    ]);
    lots.push([
      line.lot_id, line.product_id, line.movement_id, "ORDER_RETURN", payload.order_id,
      line.pack_variant_id, new Date(payload.returned_at), new Date(payload.recorded_at),
      line.quantity, line.unit_cost, line.cost_status, di3GetBaseCurrency_(),
      "Возврат заказа " + payload.order_number + "; исходная партия " + line.source_lot_id, "",
      line.total_cost_minor
    ]);
  });
  return { ledger: ledger, details: details, lots: lots };
}

function di3CompleteOrderReturn_(operationRecord, payloadOverride) {
  // payloadOverride is ignored; only the persisted, verified payload is executable.
  return di3ExecutePreparedOperation_(operationRecord);
}

function di3ApplyOrderReturnOperation_(operationRecord, payload) {
  var operationId = String(operationRecord.values[0]);
  var order = di3GetOrderById_(payload.order_id);
  if (!order) throw new Error("Заказ для восстановления возврата не найден.");
  var built = di3BuildOrderReturnRows_(operationId, payload);
  var productIds = payload.lines.map(function (line) { return line.product_id; });
  var eventKeys = built.ledger.map(function (row) { return String(row[2]); });
  var movementIds = built.ledger.map(function (row) { return String(row[0]); });
  var existingLedger = di3ReadRowsByColumnValues_("StockLedger", 2, eventKeys).map(function (match) { return match.values; });
  var existingDetails = di3ReadRowsByColumnValues_("StockMovementDetails", 0, movementIds).map(function (match) { return match.values; });
  var existingLots = di3ReadRowsByColumnValues_("StockLots", 2, movementIds).map(function (match) { return match.values; });
  var keys = Object.create(null), detailIds = Object.create(null), lotMovementIds = Object.create(null);
  existingLedger.forEach(function (row) { keys[String(row[2])] = true; });
  existingDetails.forEach(function (row) { detailIds[String(row[0])] = true; });
  existingLots.forEach(function (row) { lotMovementIds[String(row[2])] = true; });
  di3PreflightFifoForProductsScoped_(built.ledger, built.details, built.lots, productIds);
  di3AppendTableRows_("StockLedger", built.ledger.filter(function (row) { return !keys[String(row[2])]; }));
  di3AppendTableRows_("StockMovementDetails", built.details.filter(function (row) { return !detailIds[String(row[0])]; }));
  di3AppendTableRows_("StockLots", built.lots.filter(function (row) { return !lotMovementIds[String(row[2])]; }));
  var fifo = di3RebuildFifoAllocations_("ORDER_RETURN", productIds);
  order = di3GetOrderById_(payload.order_id);
  if (String(order.status) !== DI3_ORDER_STATUS.RETURNED) {
    order = di3WriteOrderStatus_(order, DI3_ORDER_STATUS.RETURNED, new Date(payload.returned_at), operationId,
      "Товар физически вернулся; восстановлены исходные FIFO-слои");
  } else {
    di3EnsureOrderStatusHistory_(order.order_id, DI3_ORDER_STATUS.RETURNING, DI3_ORDER_STATUS.RETURNED,
      order.returned_at || new Date(payload.returned_at), operationId, "Восстановление истории возврата заказа");
  }
  // Rebuild already refreshes snapshots for the affected product IDs.
  di3RefreshOrderRegister();
  return {
    status: "COMMITTED", order_id: payload.order_id, order_number: payload.order_number,
    return_movements_created: built.ledger.length,
    units_returned: payload.lines.reduce(function (sum, line) { return sum + line.quantity; }, 0),
    fifo_run_id: fifo.run_id
  };
}

function di3ReturnOrder_(order, effectiveAt) {
  if (String(order.status) === DI3_ORDER_STATUS.RETURNED) return { status: "ALREADY_RETURNED", order_number: order.order_number };
  if (String(order.status) !== DI3_ORDER_STATUS.RETURNING) throw new Error("Принять возврат можно только для заказа со статусом «Возвращается».");
  var date = di3ParseSupplyEffectiveDate_(effectiveAt, new Date());
  if (date.getTime() > Date.now() + 5 * 60 * 1000) throw new Error("Дата возврата не может быть в будущем.");
  if (date.getTime() < di3ToMillis_(order.returning_at)) throw new Error("Дата возврата не может быть раньше даты статуса «Возвращается».");
  var key = "ORDER_RETURN:" + order.order_id;
  di3AssertNoOtherPendingStockOperations_(key);
  var existing = di3GetOrderOperationByKey_(key);
  if (existing) {
    if (String(existing.values[5]) === "COMMITTED") return { status: "ALREADY_RETURNED", order_number: order.order_number };
    if (String(existing.values[5]) === "REJECTED") throw new Error("Предыдущая операция возврата отклонена. Проверь журнал Operations.");
    return di3CompleteOrderReturn_(existing, null);
  }
  di3AssertPeriodOpen_(date, "Фактический возврат заказа");
  var items = di3GetOrderItems_(order.order_id);
  items.forEach(function (item) {
    di3AssertNoBackdatedMovementBeforeReturnedOrder_(item.product_id, date, "возврат заказа");
  });
  var payload = di3BuildOrderReturnPayload_(order, items, date);
  di3AssignLedgerSequencesToLines_(payload.lines);
  var built = di3BuildOrderReturnRows_("PREFLIGHT", payload);
  di3PreflightFifoForProductsScoped_(built.ledger, built.details, built.lots,
    payload.lines.map(function (line) { return line.product_id; }));
  var operation = di3CreateOrderOperation_(key, "ORDER_RETURN", order.order_id, payload);
  return di3CompleteOrderReturn_(operation, payload);
}

function di3ChangeOrderNonStockStatus_(order, nextStatus, effectiveAt) {
  var previousDates = {
    "Завершен": order.dispatched_at,
    "Возвращается": order.dispatched_at,
    "Отменен": order.created_at
  };
  var date = di3ParseSupplyEffectiveDate_(effectiveAt, new Date());
  if (date.getTime() > Date.now() + 5 * 60 * 1000) throw new Error("Дата этапа заказа не может быть в будущем.");
  if (previousDates[nextStatus] && date.getTime() < di3ToMillis_(previousDates[nextStatus])) {
    throw new Error("Дата этапа не может быть раньше предыдущего этапа заказа.");
  }
  di3AssertPeriodOpen_(date, "Изменение статуса заказа");
  var updated = di3WriteOrderStatus_(order, nextStatus, date, "", "Изменение статуса заказа");
  di3RefreshAllOrderFifoSnapshots_();
  di3RefreshOrderRegister();
  return { status: "UPDATED", order_number: updated.order_number, old_status: order.status, new_status: nextStatus, effective_at: date };
}

function di3AdvanceOrderStatus(orderNumber, nextStatus, effectiveAt) {
  return di3WithLock_(function () {
    di3EnsureCoreFoundationSchemas_();
    var order = di3FindOrderByNumber_(String(orderNumber || "").trim());
    if (!order) throw new Error("Заказ не найден: " + orderNumber);
    nextStatus = String(nextStatus || "");
    if (String(order.status) === nextStatus) {
      if (nextStatus === DI3_ORDER_STATUS.IN_TRANSIT) {
        var dispatchOperation = di3GetOrderOperationByKey_("ORDER_DISPATCH:" + order.order_id);
        if (dispatchOperation && String(dispatchOperation.values[5]) === "PREPARED") {
          return di3CompleteOrderDispatch_(dispatchOperation, null);
        }
      }
      if (nextStatus === DI3_ORDER_STATUS.RETURNED) {
        var returnOperation = di3GetOrderOperationByKey_("ORDER_RETURN:" + order.order_id);
        if (returnOperation && String(returnOperation.values[5]) === "PREPARED") {
          return di3CompleteOrderReturn_(returnOperation, null);
        }
      }
      var historyDates = {
        "В пути": order.dispatched_at, "Завершен": order.completed_at,
        "Возвращается": order.returning_at, "Возврат": order.returned_at, "Отменен": order.cancelled_at
      };
      if (historyDates[nextStatus]) di3EnsureOrderStatusHistory_(order.order_id, "", nextStatus, historyDates[nextStatus], "", "Восстановление истории статуса");
      return { status: "ALREADY_IN_STATUS", order_number: order.order_number, new_status: nextStatus };
    }
    var allowed = DI3_ORDER_ALLOWED_TRANSITIONS[String(order.status)] || [];
    if (allowed.indexOf(nextStatus) === -1) {
      throw new Error("Недопустимый переход статуса заказа: «" + order.status + "» → «" + nextStatus + "»." );
    }
    if (nextStatus === DI3_ORDER_STATUS.IN_TRANSIT) return di3DispatchOrder_(order, effectiveAt);
    if (nextStatus === DI3_ORDER_STATUS.RETURNED) return di3ReturnOrder_(order, effectiveAt);
    return di3ChangeOrderNonStockStatus_(order, nextStatus, effectiveAt);
  });
}

function di3RefreshAllOrderFifoSnapshots_(reason, fifoRunId, affectedProductIds) {
  var orderSheet = di3GetSpreadsheet_().getSheetByName("V3_Orders");
  var itemSheet = di3GetSpreadsheet_().getSheetByName("V3_OrderItems");
  if (!orderSheet || !itemSheet || orderSheet.getLastRow() < 2) return { orders: 0, items: 0, snapshots: 0 };

  var affectedProductKeys = [];
  var affectedProductSet = null;
  if (Array.isArray(affectedProductIds) && affectedProductIds.length) {
    affectedProductSet = Object.create(null);
    affectedProductIds.forEach(function (id) {
      var key = String(id == null ? "" : id);
      if (key && !affectedProductSet[key]) {
        affectedProductSet[key] = true;
        affectedProductKeys.push(key);
      }
    });
  }

  var itemMatches;
  var impactedOrderIds = null;
  if (affectedProductSet) {
    // First identify orders touched by the changed products; then load every line
    // of those orders so order-level totals never omit an unaffected line item.
    var changedProductItems = di3ReadRowsByColumnValues_("V3_OrderItems", 3, affectedProductKeys);
    impactedOrderIds = Object.create(null);
    changedProductItems.forEach(function (match) {
      var row = match.values;
      var orderId = String(row[1] || "");
      if (orderId && row[11]) impactedOrderIds[orderId] = true;
    });
    var impactedOrderKeys = Object.keys(impactedOrderIds);
    if (!impactedOrderKeys.length) return { orders: 0, items: 0, snapshots: 0 };
    itemMatches = di3ReadRowsByColumnValues_("V3_OrderItems", 1, impactedOrderKeys);
  } else {
    itemMatches = di3ReadTableValues_("V3_OrderItems").map(function (row, index) {
      return { row_number: index + 2, values: row };
    });
  }
  if (!itemMatches.length) return { orders: 0, items: 0, snapshots: 0 };

  // Affected-product rebuilds only need allocations for dispatch movements in
  // the impacted orders. Full refreshes retain the complete active projection.
  var activeRun, allocationRows;
  if (affectedProductSet) {
    activeRun = di3GetLatestFifoAllocationRun_();
    var movementIds = [];
    var movementSet = Object.create(null);
    itemMatches.forEach(function (match) {
      var movementId = String(match.values[11] || "");
      if (movementId && !movementSet[movementId]) {
        movementSet[movementId] = true;
        movementIds.push(movementId);
      }
    });
    allocationRows = movementIds.length ? di3ReadRowsByColumnValues_("StockAllocations", 2, movementIds).map(function (match) { return match.values; }) : [];
  } else {
    var active = di3GetActiveRunAllocations_();
    activeRun = active.run;
    allocationRows = active.rows;
  }

  var allocationsByMovement = {};
  allocationRows.forEach(function (row) {
    if (String(row[5]) !== "CONSUME") return;
    var id = String(row[2]);
    if (!allocationsByMovement[id]) allocationsByMovement[id] = [];
    allocationsByMovement[id].push(row);
  });

  var itemIds = [];
  var itemIdSet = Object.create(null);
  itemMatches.forEach(function (match) {
    var itemId = String(match.values[0] || "");
    if (itemId && !itemIdSet[itemId]) {
      itemIdSet[itemId] = true;
      itemIds.push(itemId);
    }
  });
  var snapshotMatches = itemIds.length ? di3ReadRowsByColumnValues_("OrderCostSnapshots", 2, itemIds) : [];
  var latestSnapshotByItem = {};
  snapshotMatches.forEach(function (match) {
    var row = match.values;
    var itemId = String(row[2] || "");
    if (!itemId) return;
    var current = latestSnapshotByItem[itemId];
    var version = Number(row[3]) || 0;
    if (!current || version > current.version) {
      latestSnapshotByItem[itemId] = {
        version: version, snapshot_id: String(row[0]),
        cost_minor: row[5] === "" || row[5] == null ? null : Number(row[5]),
        cost_status: String(row[6] || "")
      };
    }
  });

  var itemUpdates = [];
  var costsByOrder = {};
  var snapshotsToAppend = [];
  var now = new Date();
  itemMatches.forEach(function (match) {
    var row = match.values;
    var orderId = String(row[1] || "");
    var movementId = String(row[11] || "");
    if (!orderId) return;
    if (!costsByOrder[orderId]) costsByOrder[orderId] = { count: 0, complete: 0, partial: false, unknown: false, total_minor: 0, dispatched: 0 };
    var bucket = costsByOrder[orderId];
    bucket.count++;
    var cost = null, status = "NOT_DISPATCHED";
    if (movementId) {
      bucket.dispatched++;
      var allocs = allocationsByMovement[movementId] || [];
      var qty = 0, unknownQty = 0, totalMinor = 0;
      allocs.forEach(function (allocation) {
        qty += Number(allocation[6]) || 0;
        if (String(allocation[8]) === "UNKNOWN") unknownQty += Number(allocation[6]) || 0;
        else totalMinor += Number(di3MoneyGetAllocationCostMinor_(allocation) || 0);
      });
      if (qty === Number(row[5]) && qty > 0) {
        status = unknownQty === 0 ? "COMPLETE" : (unknownQty === qty ? "UNKNOWN" : "PARTIAL");
        cost = unknownQty === 0 ? totalMinor / 100 : "";
      } else {
        status = "PENDING";
      }
    }
    var itemId = String(row[0]);
    var latest = latestSnapshotByItem[itemId] || null;
    var nextMinor = cost === "" || cost == null ? null : di3MoneyToMinorUnits_(Number(cost), "Себестоимость заказа", false);
    var snapshotChanged = !latest || latest.cost_status !== status || latest.cost_minor !== nextMinor;
    if (movementId && snapshotChanged) {
      var previousMinor = latest ? latest.cost_minor : null;
      snapshotsToAppend.push([
        di3MakeUuid_(), orderId, itemId, latest ? latest.version + 1 : 1,
        String(fifoRunId || (activeRun ? activeRun.run_id : "")),
        nextMinor == null ? "" : nextMinor, status, Number(row[5]), now,
        String(reason || "FIFO_RECALCULATION"), latest ? latest.snapshot_id : "",
        previousMinor == null || nextMinor == null ? "" : nextMinor - previousMinor
      ]);
      latestSnapshotByItem[itemId] = {
        version: latest ? latest.version + 1 : 1,
        snapshot_id: snapshotsToAppend[snapshotsToAppend.length - 1][0],
        cost_minor: nextMinor, cost_status: status
      };
    }
    var values = row.slice();
    values[12] = cost == null ? "" : cost;
    values[13] = status;
    values[15] = now;
    if (String(row[12]) !== String(values[12]) || String(row[13]) !== String(values[13])) {
      itemUpdates.push({ row_number: match.row_number, values: values });
    }
    if (movementId) {
      if (status === "COMPLETE") { bucket.complete++; bucket.total_minor += Number(nextMinor || 0); }
      else if (status === "PARTIAL") bucket.partial = true;
      else bucket.unknown = true;
    }
  });

  // Append immutable cost snapshots before updating the mutable current projections.
  if (snapshotsToAppend.length) di3AppendTableRows_("OrderCostSnapshots", snapshotsToAppend);
  di3ApplyContiguousRowUpdates_("V3_OrderItems", itemUpdates);

  var orderKeys = Object.keys(costsByOrder);
  var orderMatches = affectedProductSet
    ? (orderKeys.length ? di3ReadRowsByColumnValues_("V3_Orders", 0, orderKeys) : [])
    : di3ReadTableValues_("V3_Orders").map(function (row, index) { return { row_number: index + 2, values: row }; });
  var orderUpdates = [];
  orderMatches.forEach(function (match) {
    var row = match.values;
    var orderId = String(row[0] || "");
    var bucket = costsByOrder[orderId];
    if (!orderId || !bucket) return;
    var status = "NOT_DISPATCHED", total = "", profit = "";
    if (bucket.dispatched > 0) {
      if (bucket.complete === bucket.dispatched && !bucket.partial && !bucket.unknown) {
        status = "COMPLETE";
        total = di3MoneyFromMinorUnits_(bucket.total_minor);
      } else if (bucket.partial || (bucket.complete > 0 && bucket.unknown)) status = "PARTIAL";
      else if (bucket.unknown) status = "UNKNOWN";
      else status = "PENDING";
    }
    if (String(row[3]) === DI3_ORDER_STATUS.COMPLETED && status === "COMPLETE") {
      var sellerRevenueMinor = di3MoneyToMinorUnits_(Number(row[23]), "Выручка продавца", false);
      profit = di3MoneyFromMinorUnits_(sellerRevenueMinor - bucket.total_minor);
    }
    var values = row.slice();
    values[12] = total;
    values[13] = status;
    values[14] = profit;
    values[22] = now;
    if (String(row[12]) !== String(values[12]) || String(row[13]) !== String(values[13]) || String(row[14]) !== String(values[14])) {
      orderUpdates.push({ row_number: match.row_number, values: values });
    }
  });
  di3ApplyContiguousRowUpdates_("V3_Orders", orderUpdates);
  return { orders: orderUpdates.length, items: itemUpdates.length, snapshots: snapshotsToAppend.length };
}

function di3RecoverPendingOrderOperations_() {
  return di3RecoverPreparedOperations_(["ORDER_CREATE", "ORDER_DISPATCH", "ORDER_RETURN"]);
}

function di3GetOrderFinancialSummary(orderNumber) {
  di3AssertNoPendingStockOperations_();
  var order = di3FindOrderByNumber_(orderNumber);
  if (!order) throw new Error("Заказ не найден: " + orderNumber);
  return {
    order_number: order.order_number,
    status: order.status,
    goods_amount: order.goods_amount,
    commission_quote_rate: order.commission_rate,
    commission_quote_amount: order.commission_amount,
    discount_amount: order.discount_amount,
    buyer_payable_quote: order.payable_total,
    seller_revenue_estimate: di3OrderRoundMoney_(
      Number(order.goods_amount) - Number(order.discount_amount) -
      (String(order.commission_payer || "BUYER") === "SELLER" ? Number(order.commission_amount || 0) : 0)
    ),
    commission_payer: String(order.commission_payer || "BUYER"),
    seller_revenue: order.seller_revenue,
    platform_commission_realized: order.platform_commission_realized,
    buyer_paid_total: order.buyer_paid_total,
    settlement_status: order.settlement_status,
    settlement_finalized_at: order.settlement_finalized_at,
    estimated_fifo_cost_total: order.estimated_fifo_cost_total,
    estimated_fifo_cost_status: order.estimated_fifo_cost_status,
    actual_fifo_cost_total: order.actual_fifo_cost_total,
    actual_fifo_cost_status: order.actual_fifo_cost_status,
    profit_total: order.profit_total
  };
}
