/** Dots Inventory v3 — order domain, numbering and idempotent creation. */
var DI3_ORDER_STATUS = Object.freeze({
  NEW: "Новый", IN_TRANSIT: "В пути", COMPLETED: "Завершен",
  RETURNING: "Возвращается", RETURNED: "Возврат", CANCELLED: "Отменен"
});
var DI3_ORDER_FORM_SHEET = "Калькулятор заказа v3";
var DI3_ORDER_REGISTER_SHEET = "Реестр заказов v3";
var DI3_ORDER_FORM = Object.freeze({
  commissionPaidByBuyer: "B3", commissionPercent: "B4", discountEnabled: "B5",
  discountPercent: "B6", deliveryMethod: "B7", notes: "B8",
  firstLine: 12, lineCount: 20
});

function di3OrderRoundMoney_(value) {
  return di3MoneyRound_(value);
}

function di3OrderToCents_(value, fieldName) {
  return di3MoneyToMinorUnits_(value, fieldName || "Сумма", false);
}

/** Normalize a percentage input from either native-percent or literal-percent cells. */
function di3NormalizeOrderPercentInput_(value, numberFormat, fieldName) {
  var raw = value == null || value === "" ? 0 : Number(value);
  if (!Number.isFinite(raw) || raw < 0) throw new Error((fieldName || "Процент") + " должен быть неотрицательным числом.");
  // Native Sheets percent formats store 10% as 0.1; the existing literal format
  // 0.00"%" stores 10 as 10. Strip quoted literals before checking the format.
  var activeFormat = String(numberFormat || "").replace(/"[^"]*"/g, "");
  var rate = activeFormat.indexOf("%") >= 0 ? raw : raw / 100;
  if (!Number.isFinite(rate) || rate < 0 || rate > 1) {
    throw new Error((fieldName || "Процент") + " должен быть от 0% до 100%.");
  }
  return rate;
}

/** Shared integer-kopeck split for buyer-paid vs seller-paid platform commission. */
function di3CalculateOrderCommissionSplit_(goodsCents, discountCents, commissionCents, payer) {
  var goods = Number(goodsCents) || 0;
  var discount = Number(discountCents) || 0;
  var commission = Number(commissionCents) || 0;
  var commissionPayer = String(payer || "BUYER").toUpperCase() === "SELLER" ? "SELLER" : "BUYER";
  var sellerRevenue = goods - discount - (commissionPayer === "SELLER" ? commission : 0);
  var buyerPaid = goods - discount + (commissionPayer === "BUYER" ? commission : 0);
  return {
    commission_payer: commissionPayer,
    buyer_paid_cents: buyerPaid,
    seller_revenue_cents: sellerRevenue
  };
}

/** Pure calculation. Rates are fractions: 0.05 = 5%. */
function di3BuildOrderFinancialPlan_(input) {
  input = input || {};
  var lines = Array.isArray(input.lines) ? input.lines : [];
  if (!lines.length) throw new Error("Заказ пуст. Добавь хотя бы одну позицию.");
  var seenProducts = {};
  var normalizedLines = lines.map(function (line, index) {
    var productId = String(line.product_id || "").trim();
    var quantity = Number(line.quantity);
    var salePrice = Number(line.sale_unit_price);
    if (!productId) throw new Error("Позиция " + (index + 1) + ": не выбран товар.");
    if (seenProducts[productId]) throw new Error("Товар «" + (line.product_label || productId) + "» повторяется в заказе. Объедини количество в одной строке.");
    seenProducts[productId] = true;
    if (!Number.isInteger(quantity) || quantity <= 0) throw new Error("Позиция " + (index + 1) + ": количество должно быть положительным целым числом.");
    if (!Number.isFinite(salePrice) || salePrice < 0) throw new Error("Позиция " + (index + 1) + ": цена продажи должна быть неотрицательной.");
    var lineRevenue = di3OrderRoundMoney_(quantity * salePrice);
    var estimatedUnitCost = line.estimated_unit_cost === "" || line.estimated_unit_cost == null
      ? null : Number(line.estimated_unit_cost);
    var estimatedCostStatus = String(line.estimated_cost_status || (estimatedUnitCost == null ? "UNKNOWN" : "COMPLETE"));
    if (estimatedUnitCost != null && (!Number.isFinite(estimatedUnitCost) || estimatedUnitCost < 0)) {
      throw new Error("Позиция " + (index + 1) + ": некорректная оценочная себестоимость.");
    }
    var estimatedLineCost = estimatedUnitCost == null ? null : di3OrderRoundMoney_(quantity * estimatedUnitCost);
    return {
      product_id: productId,
      product_label: String(line.product_label || ""),
      quantity: quantity,
      sale_unit_price: di3OrderRoundMoney_(salePrice),
      line_revenue: lineRevenue,
      estimated_unit_cost: estimatedUnitCost,
      estimated_line_cost: estimatedLineCost,
      estimated_cost_status: estimatedCostStatus
    };
  });

  var goodsCents = normalizedLines.reduce(function (sum, line) { return sum + di3OrderToCents_(line.line_revenue); }, 0);
  var commissionRate = input.commission_rate == null || input.commission_rate === "" ? 0 : Number(input.commission_rate);
  var discountRate = input.discount_rate == null || input.discount_rate === "" ? 0 : Number(input.discount_rate);
  if (!Number.isFinite(commissionRate) || commissionRate < 0 || commissionRate > 1) throw new Error("Комиссия должна быть от 0% до 100%.");
  if (!Number.isFinite(discountRate) || discountRate < 0 || discountRate > 1) throw new Error("Скидка должна быть от 0% до 100%.");

  // Backward compatibility: old callers using commission_enabled retain the old
  // on/off behaviour. New order forms always calculate the fee from the rate;
  // the checkbox selects who bears it, not whether the fee exists.
  var hasPayerChoice = Object.prototype.hasOwnProperty.call(input, "commission_paid_by_buyer");
  var commissionEnabled = hasPayerChoice ? commissionRate > 0 : input.commission_enabled === true;
  var commissionPaidByBuyer = hasPayerChoice ? input.commission_paid_by_buyer === true : true;
  var commissionPayer = commissionPaidByBuyer ? "BUYER" : "SELLER";
  var commissionCents = commissionEnabled ? Math.round(goodsCents * commissionRate) : 0;
  // Existing policy retained: platform commission is calculated on gross goods
  // before seller discount. The discount then reduces seller proceeds.
  var discountCents = input.discount_enabled ? Math.round(goodsCents * discountRate) : 0;
  var split = di3CalculateOrderCommissionSplit_(goodsCents, discountCents, commissionCents, commissionPayer);
  var payableCents = split.buyer_paid_cents;
  if (payableCents < 0) throw new Error("Итог к оплате не может быть отрицательным.");
  if (split.seller_revenue_cents < 0) throw new Error("Выручка продавца после комиссии не может быть отрицательной.");

  var completeEstimate = normalizedLines.every(function (line) { return line.estimated_line_cost != null; });
  var estimatedCostStatus = completeEstimate ? "COMPLETE" : (normalizedLines.some(function (line) { return line.estimated_cost_status === "PARTIAL"; }) ? "PARTIAL" : "UNKNOWN");
  var estimatedCostCents = completeEstimate
    ? normalizedLines.reduce(function (sum, line) { return sum + di3OrderToCents_(line.estimated_line_cost); }, 0)
    : null;
  return {
    lines: normalizedLines,
    goods_amount: goodsCents / 100,
    commission_rate: commissionEnabled ? commissionRate : 0,
    commission_amount: commissionCents / 100,
    commission_payer: commissionPayer,
    commission_paid_by_buyer: commissionPaidByBuyer,
    discount_rate: input.discount_enabled ? discountRate : 0,
    discount_amount: discountCents / 100,
    payable_total: payableCents / 100,
    seller_revenue_estimate: split.seller_revenue_cents / 100,
    platform_commission_quote: commissionCents / 100,
    estimated_fifo_cost_total: estimatedCostCents == null ? "" : estimatedCostCents / 100,
    estimated_fifo_cost_status: estimatedCostStatus,
    estimated_profit: estimatedCostCents == null ? "" : (split.seller_revenue_cents - estimatedCostCents) / 100
  };
}

/**
 * Upgrade V3_Orders from the 23-column legacy or 28-column settlement schema.
 * Appends settlement fields and commission_payer without moving existing columns.
 * Existing orders default to BUYER to preserve the previous fee policy.
 */
function di3UpgradeOrderSettlementSchema_() {
  var ss = di3GetSpreadsheet_();
  var sheet = ss.getSheetByName("V3_Orders");
  if (!sheet) return { upgraded: false, reason: "SHEET_NOT_CREATED" };
  if (sheet.getLastRow() === 0) return { upgraded: false, reason: "EMPTY_SHEET" };

  var legacyHeaders = [
    "order_id", "order_number", "created_at", "status", "goods_amount",
    "commission_rate", "commission_amount", "discount_rate", "discount_amount",
    "payable_total", "estimated_fifo_cost_total", "estimated_fifo_cost_status",
    "actual_fifo_cost_total", "actual_fifo_cost_status", "profit_total", "notes",
    "delivery_method", "dispatched_at", "completed_at", "returning_at",
    "returned_at", "cancelled_at", "updated_at"
  ];
  var newHeaders = DI3_TABLE_SCHEMAS.V3_Orders;
  var settlementWidth = legacyHeaders.length + 5;
  var targetWidth = legacyHeaders.length + 6;
  var settlementHeaders = newHeaders.slice(0, targetWidth);
  if (newHeaders[targetWidth - 1] !== "commission_payer" || newHeaders[targetWidth] !== "business_date") {
    throw new Error("Неожиданная версия схемы V3_Orders.");
  }
  if (sheet.getMaxColumns() < targetWidth) {
    sheet.insertColumnsAfter(sheet.getMaxColumns(), targetWidth - sheet.getMaxColumns());
  }
  var actual = sheet.getRange(1, 1, 1, targetWidth).getDisplayValues()[0].map(di3NormalizeHeader_);
  var hasLegacyPrefix = legacyHeaders.every(function (header, index) { return actual[index] === header; });
  var isSettlementVersion = settlementHeaders.slice(0, settlementWidth).every(function (header, index) {
    return actual[index] === header;
  });
  var isLegacy = hasLegacyPrefix && !isSettlementVersion;
  var isCurrent = settlementHeaders.every(function (header, index) { return actual[index] === header; });
  if (isCurrent) return { upgraded: false, reason: "ALREADY_CURRENT" };
  if (!isLegacy && !isSettlementVersion) {
    throw new Error("Нельзя обновить V3_Orders: заголовки не соответствуют ни старой, ни промежуточной схеме.");
  }

  var appendStart = isLegacy ? legacyHeaders.length : settlementWidth;
  var expectedTail = settlementHeaders.slice(appendStart);
  var tailActual = actual.slice(appendStart, targetWidth);
  var tailBlank = tailActual.every(function (value) { return !value; });
  var tailCurrent = tailActual.join("|") === expectedTail.join("|");
  if (!tailBlank && !tailCurrent) {
    throw new Error("Нельзя обновить V3_Orders: новые поля расчётов заняты неизвестными заголовками.");
  }
  if (tailBlank && di3PreflightHasBodyValues_(sheet, appendStart + 1, targetWidth - appendStart)) {
    throw new Error("Нельзя обновить V3_Orders: новые колонки содержат данные при пустых заголовках. Миграция остановлена без перезаписи.");
  }
  if (tailBlank) sheet.getRange(1, appendStart + 1, 1, expectedTail.length).setValues([expectedTail]);
  di3SetFrozenRowsSafely_(sheet, 1);

  var lastRow = sheet.getLastRow();
  var rowsUpdated = 0;
  var legacyRowsBackfilled = 0;
  if (lastRow >= 2) {
    var rows = sheet.getRange(2, 1, lastRow - 1, targetWidth).getValues();
    rows.forEach(function (row, index) {
      var updates = [];
      if (isLegacy && !String(row[legacyHeaders.length + 3] || "")) {
        var status = String(row[3] || "");
        var goods = Number(row[4]) || 0;
        var discount = Number(row[8]) || 0;
        var quoteFee = Number(row[6]) || 0;
        var buyerQuote = Number(row[9]) || 0;
        var settlement;
        if (status === DI3_ORDER_STATUS.COMPLETED) {
          settlement = [di3OrderRoundMoney_(goods - discount), quoteFee, buyerQuote, "SETTLED", row[18] || row[22] || ""];
        } else if (status === DI3_ORDER_STATUS.RETURNED || status === DI3_ORDER_STATUS.CANCELLED) {
          settlement = [0, 0, 0, "NOT_COMPLETED", row[20] || row[21] || row[22] || ""];
        } else {
          settlement = ["", 0, "", "QUOTED", ""];
        }
        updates = updates.concat(settlement);
        legacyRowsBackfilled++;
        if (status === DI3_ORDER_STATUS.COMPLETED && String(row[13]) === "COMPLETE" && row[12] !== "" && row[12] != null) {
          var historicalRevenueMinor = di3MoneyToMinorUnits_(settlement[0], "Историческая выручка", false);
          var historicalCostMinor = di3MoneyToMinorUnits_(Number(row[12]), "Историческая себестоимость", false);
          sheet.getRange(index + 2, 15).setValue(di3MoneyFromMinorUnits_(historicalRevenueMinor - historicalCostMinor));
        }
      }
      var payerValue = String(row[targetWidth - 1] || "").toUpperCase();
      var payerNeedsDefault = !payerValue;
      if (payerValue && payerValue !== "BUYER" && payerValue !== "SELLER") {
        throw new Error("V3_Orders: неизвестное значение commission_payer в строке " + (index + 2) + ".");
      }
      if (updates.length || payerNeedsDefault) {
        // For the legacy layout the first five appended values are settlement fields;
        // commission_payer is always the final schema column. Preserve an existing payer.
        if (isLegacy && updates.length >= 5) {
          sheet.getRange(index + 2, legacyHeaders.length + 1, 1, 5).setValues([updates.slice(0, 5)]);
        }
        if (payerNeedsDefault) sheet.getRange(index + 2, targetWidth, 1, 1).setValue("BUYER");
        rowsUpdated++;
      }
    });
  }
  di3CompactSheet_(sheet, Math.max(1, lastRow), targetWidth);
  return {
    upgraded: tailBlank || rowsUpdated > 0,
    orders: Math.max(0, lastRow - 1),
    columns_added: tailBlank ? expectedTail.length : 0,
    rows_backfilled: legacyRowsBackfilled,
    payer_defaults: rowsUpdated
  };
}

function di3GetOrderById_(orderId) {
  var match = di3ReadRowByColumnValue_("V3_Orders", 0, orderId);
  if (!match) return null;
  var record = {};
  DI3_TABLE_SCHEMAS.V3_Orders.forEach(function (header, index) { record[header] = match.values[index]; });
  record.row_number = match.row_number;
  return record;
}

function di3FindOrderByNumber_(orderNumber) {
  var match = di3ReadRowByColumnValue_("V3_Orders", 1, String(orderNumber || ""));
  if (!match) return null;
  var record = {};
  DI3_TABLE_SCHEMAS.V3_Orders.forEach(function (header, index) { record[header] = match.values[index]; });
  record.row_number = match.row_number;
  return record;
}

function di3GetOrderItems_(orderId) {
  return di3ReadRowsByColumnValue_("V3_OrderItems", 1, orderId).map(function (match) {
    var item = {};
    DI3_TABLE_SCHEMAS.V3_OrderItems.forEach(function (header, column) { item[header] = match.values[column]; });
    item.row_number = match.row_number;
    return item;
  }).sort(function (a, b) { return Number(a.line_no) - Number(b.line_no); });
}

function di3GenerateOrderNumber_(createdAt) {
  var timezone = di3GetConfiguredTimeZone_();
  var year = Utilities.formatDate(createdAt, timezone, "yy");
  var month = Number(Utilities.formatDate(createdAt, timezone, "M"));
  var day = Utilities.formatDate(createdAt, timezone, "dd");
  var monthCodes = di3GetDocumentMonthCodes_();
  var monthCode = monthCodes[month - 1];
  if (!monthCode) throw new Error("Не задан код месяца для номера заказа.");
  var prefix = year + monthCode + day;
  var orderNumbers = di3ReadTableColumnValues_("V3_Orders", 1);
  var maxSequence = orderNumbers.reduce(function (max, value) {
    var number = String(value || "");
    if (number.indexOf(prefix) !== 0) return max;
    var suffix = number.slice(prefix.length);
    return /^\d+$/.test(suffix) ? Math.max(max, Number(suffix)) : max;
  }, 0);
  var props = PropertiesService.getScriptProperties();
  var key = "DI3_ORDER_SEQUENCE_" + prefix;
  maxSequence = Math.max(maxSequence, Number(props.getProperty(key) || 0));
  var next = maxSequence + 1;
  props.setProperty(key, String(next));
  return prefix + next;
}

function di3GetDeliveryMethodNames_() {
  if (!di3GetSpreadsheet_().getSheetByName("V3_DeliveryMethods")) return [];
  return di3ReadTableValues_("V3_DeliveryMethods").filter(function (row) {
    return di3NormalizeText_(row[1]) && row[2] !== false && String(row[2]).toLowerCase() !== "false";
  }).sort(function (a, b) { return (Number(a[3]) || 0) - (Number(b[3]) || 0); })
    .map(function (row) { return di3NormalizeText_(row[1]); });
}


function di3BuildOrderRequestHash_(command) {
  command = command || {};
  var canonical = {
    lines: (command.lines || []).map(function (line) {
      return {
        product_id: String(line.product_id || ""),
        quantity: Number(line.quantity),
        sale_unit_price: line.sale_unit_price === "" || line.sale_unit_price == null ? "" : Number(line.sale_unit_price)
      };
    }),
    commission_paid_by_buyer: command.commission_paid_by_buyer !== false,
    commission_rate: Number(command.commission_rate || 0),
    discount_enabled: command.discount_enabled === true,
    discount_rate: Number(command.discount_rate || 0),
    delivery_method: di3NormalizeText_(command.delivery_method),
    notes: di3NormalizeText_(command.notes)
  };
  return di3BuildManualOperationPayloadHash_(canonical);
}

function di3BuildOrderDraftPayload_(command) {
  command = command || {};
  var createdAt = command.created_at ? di3ToDate_(command.created_at, "Дата создания заказа") : new Date();
  var requestToken = String(command.request_token || "").trim();
  if (!requestToken) throw new Error("Не найден токен формы. Обнови форму создания заказа.");
  var deliveryMethod = di3NormalizeText_(command.delivery_method);
  var availableMethods = di3GetDeliveryMethodNames_();
  if (deliveryMethod && availableMethods.length && availableMethods.indexOf(deliveryMethod) === -1) {
    throw new Error("Метод доставки отсутствует в справочнике «V3_DeliveryMethods».");
  }

  var products = di3LoadProductsIndex_();
  var normalizedLines = [];
  var quantitiesByProduct = {};
  (command.lines || []).forEach(function (raw, index) {
    if (!raw || (!raw.product_id && !raw.product_label && (raw.quantity === "" || raw.quantity == null))) return;
    var productId = String(raw.product_id || "");
    var product = products.byId[productId];
    if (!product) throw new Error("Позиция " + (index + 1) + ": товар не найден в каталоге.");
    if (product.active === false || String(product.active).toLowerCase() === "false") throw new Error("Позиция " + (index + 1) + ": товар неактивен.");
    var quantity = Number(raw.quantity);
    if (!Number.isInteger(quantity) || quantity <= 0) throw new Error("Позиция " + (index + 1) + ": количество должно быть положительным целым числом.");
    var hasPriceOverride = raw.sale_unit_price !== "" && raw.sale_unit_price != null;
    var catalogPriceMissing = product.current_sale_price === "" || product.current_sale_price == null;
    if (!hasPriceOverride && catalogPriceMissing) {
      throw new Error("Позиция " + (index + 1) + ": цена продажи не указана ни в заказе, ни в карточке товара.");
    }
    var price = hasPriceOverride ? Number(raw.sale_unit_price) : Number(product.current_sale_price);
    if (!Number.isFinite(price) || price < 0) throw new Error("Позиция " + (index + 1) + ": укажи корректную цену продажи или заполни её в карточке товара.");
    var label = di3GetProductLabel_(product);
    var valuation = di3GetProductFifoValuation(productId);
    if (valuation.total_quantity <= 0) throw new Error("«" + label + ": нет товара в наличии.");
    quantitiesByProduct[productId] = (quantitiesByProduct[productId] || 0) + quantity;
    normalizedLines.push({
      product_id: productId,
      product_label: label,
      quantity: quantity,
      sale_unit_price: price,
      estimated_unit_cost: valuation.valuation_status === "COMPLETE" ? valuation.average_unit_cost : null,
      estimated_cost_status: valuation.valuation_status
    });
  });
  if (!normalizedLines.length) throw new Error("Заказ пуст. Добавь хотя бы одну позицию.");
  Object.keys(quantitiesByProduct).forEach(function (productId) {
    var valuation = di3GetProductFifoValuation(productId);
    if (quantitiesByProduct[productId] > valuation.total_quantity) {
      var product = products.byId[productId];
      throw new Error("Недостаточно товара: " + di3GetProductLabel_(product) + ". Нужно " + quantitiesByProduct[productId] + ", в наличии " + valuation.total_quantity + ".");
    }
  });
  var plan = di3BuildOrderFinancialPlan_({
    lines: normalizedLines,
    commission_paid_by_buyer: command.commission_paid_by_buyer !== false,
    commission_rate: command.commission_rate,
    discount_enabled: command.discount_enabled === true,
    discount_rate: command.discount_rate
  });
  var orderId = di3MakeUuid_();
  var orderNumber = di3GenerateOrderNumber_(createdAt);
  var now = new Date();
  var orderRow = [
    orderId, orderNumber, createdAt, DI3_ORDER_STATUS.NEW, plan.goods_amount,
    plan.commission_rate, plan.commission_amount, plan.discount_rate, plan.discount_amount,
    plan.payable_total, plan.estimated_fifo_cost_total, plan.estimated_fifo_cost_status,
    "", "NOT_DISPATCHED", "", di3NormalizeText_(command.notes), deliveryMethod,
    "", "", "", "", "", now,
    "", 0, "", "QUOTED", "", plan.commission_payer
  ];
  var itemRows = plan.lines.map(function (line, index) {
    return [
      di3MakeUuid_(), orderId, index + 1, line.product_id, line.product_label,
      line.quantity, line.sale_unit_price, line.line_revenue,
      line.estimated_unit_cost == null ? "" : line.estimated_unit_cost,
      line.estimated_line_cost == null ? "" : line.estimated_line_cost,
      line.estimated_cost_status, "", "", "NOT_DISPATCHED", now, now
    ];
  });
  return {
    request_token: requestToken,
    request_hash: di3BuildOrderRequestHash_(command),
    order_id: orderId,
    order_number: orderNumber,
    order_row: orderRow,
    item_rows: itemRows,
    created_at: createdAt.toISOString()
  };
}

function di3GetOrderCreateOperation_(requestToken) {
  return di3FindRowByColumnValue_("Operations", 1, "ORDER_CREATE:" + String(requestToken));
}

function di3ResumeOrderCreateOperation_(operationRecord, payloadOverride) {
  // Always execute from the persisted and hash-verified payload.
  return di3ExecutePreparedOperation_(operationRecord);
}

function di3ApplyOrderCreateOperation_(operationRecord, payload) {
  var operationId = String(operationRecord.values[0]);
  if (!di3GetOrderById_(payload.order_id)) di3AppendTableRows_("V3_Orders", [payload.order_row]);
  var existingItems = di3ReadRowsByColumnValue_("V3_OrderItems", 1, payload.order_id);
  var existingIds = {};
  existingItems.forEach(function (match) { existingIds[String(match.values[0])] = true; });
  var missingItems = payload.item_rows.filter(function (row) { return !existingIds[String(row[0])]; });
  di3AppendTableRows_("V3_OrderItems", missingItems);
  var statusExists = di3ReadRowsByColumnValue_("DocumentStatusHistory", 2, payload.order_id).some(function (match) {
    var row = match.values;
    return String(row[1]) === "ORDER" && String(row[4]) === DI3_ORDER_STATUS.NEW;
  });
  if (!statusExists) di3AppendTableRows_("DocumentStatusHistory", [[
    di3MakeUuid_(), "ORDER", payload.order_id, "", DI3_ORDER_STATUS.NEW,
    new Date(payload.created_at), di3GetOperationInitiatorActor_(operationId), operationId, "Создание заказа"
  ]]);
  var savedOrder = di3GetOrderById_(payload.order_id);
  var savedItems = di3GetOrderItems_(payload.order_id);
  if (!savedOrder || savedItems.length !== payload.item_rows.length) throw new Error("Не удалось подтвердить сохранение заказа и всех позиций.");
  if (typeof di3RefreshOrderRegister === "function") di3RefreshOrderRegister();
  return {
    status: "CREATED", order_id: payload.order_id, order_number: payload.order_number,
    items: savedItems.length, payable_total: savedOrder.payable_total,
    commission_quote_amount: savedOrder.commission_amount,
    seller_revenue_estimate: di3OrderRoundMoney_(
      Number(savedOrder.goods_amount) - Number(savedOrder.discount_amount) -
      (String(savedOrder.commission_payer || "BUYER") === "SELLER" ? Number(savedOrder.commission_amount || 0) : 0)
    ),
    commission_payer: String(savedOrder.commission_payer || "BUYER")
  };
}

function di3CreateOrder(command) {
  return di3WithLock_(function () {
    di3EnsureCoreFoundationSchemas_();
    command = command || {};
    var token = String(command.request_token || "").trim();
    if (!token) throw new Error("Не найден request_token формы заказа.");
    var existing = di3GetOrderCreateOperation_(token);
    if (existing) {
      var savedPayload = di3ReadVerifiedOperationPayload_(existing);
      if (String(savedPayload.request_hash || "") !== di3BuildOrderRequestHash_(command)) {
        throw new Error("Токен формы заказа уже использован с другими данными. Обнови форму перед созданием нового заказа.");
      }
      if (String(existing.values[5]) === "COMMITTED") {
        var existingOrder = di3GetOrderById_(String(existing.values[4]));
        return { status: "ALREADY_CREATED", order_id: existingOrder.order_id, order_number: existingOrder.order_number };
      }
      if (String(existing.values[5]) === "REJECTED") throw new Error("Предыдущая попытка создания заказа отклонена. Обнови форму и повтори.");
      return di3ResumeOrderCreateOperation_(existing, null);
    }
    var payload = di3BuildOrderDraftPayload_(command);
    var idempotencyKey = "ORDER_CREATE:" + token;
    var operationRecord = di3RegisterPreparedOperation_({
      idempotency_key: idempotencyKey,
      operation_type: "ORDER_CREATE",
      document_type: "ORDER",
      document_id: payload.order_id,
      payload: payload
    });
    return di3ResumeOrderCreateOperation_(operationRecord, null);
  });
}

/**
 * Capture the identity available to the current Apps Script execution.
 * Active-user email may be unavailable in trigger/recovery contexts; an empty
 * value is intentional and must not be replaced with the effective-user email.
 */
function di3CaptureActorContext_(sessionApi) {
  var email = "";
  try {
    var activeSession = sessionApi || Session;
    email = String(activeSession.getActiveUser().getEmail() || "").trim();
  } catch (ignore) {}
  return {
    email: email,
    identity_status: email ? "IDENTIFIED" : "UNAVAILABLE",
    identity_source: email ? "ACTIVE_USER" : "NONE"
  };
}

/** Backwards-compatible string accessor for existing audit columns. */
function di3GetActorEmail_() {
  return di3CaptureActorContext_().email;
}
