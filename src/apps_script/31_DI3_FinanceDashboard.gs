/** Dots Inventory v3 — seller finance dashboard built from completed orders, FIFO snapshots and received supplies. */
var DI3_FINANCE_DASHBOARD_SHEET = "Финансы";
var DI3_FINANCE_ALL_PRODUCTS_LABEL = "Все товары";
var DI3_FINANCE_MONTH_HEADERS = [
  "Месяц", "Заказов", "Покупатели оплатили, ₽", "Комиссия площадки, ₽",
  "Скидка продавца, ₽", "Выручка продавца, ₽", "Известная себестоимость, ₽",
  "Без себестоимости, строк", "Валовая прибыль, ₽", "Маржа"
];
var DI3_FINANCE_PURCHASE_HEADERS = [
  "Дата получения", "Поставка", "Поставщик", "Товар", "Получено, шт.",
  "Итого закупки, ₽", "Себестоимость, ₽/шт."
];
var DI3_FINANCE_DELIVERY_HEADERS = [
  "Поставка", "Поставщик", "Отправлена", "Получена", "Срок, дней", "Товаров в поставке"
];

/** Largest-remainder allocation of an integer money amount across non-negative integer weights. */
function di3FinanceAllocateMinorByWeights_(amountMinor, weights) {
  var amount = Number(amountMinor);
  if (!Number.isSafeInteger(amount) || amount < 0) throw new Error("Распределяемая сумма должна быть целым числом копеек.");
  if (!Array.isArray(weights) || !weights.length) {
    if (amount === 0) return [];
    throw new Error("Нельзя распределить сумму без весов.");
  }
  var clean = weights.map(function (weight) {
    var value = Number(weight);
    if (!Number.isSafeInteger(value) || value < 0) throw new Error("Вес распределения должен быть неотрицательным целым числом.");
    return value;
  });
  var totalWeight = clean.reduce(function (sum, value) { return sum + value; }, 0);
  if (!Number.isSafeInteger(totalWeight)) throw new Error("Сумма весов выходит за безопасный целочисленный диапазон.");
  if (totalWeight === 0) {
    if (amount === 0) return clean.map(function () { return 0; });
    throw new Error("Невозможно распределить ненулевую сумму при нулевой сумме весов.");
  }
  var shares = clean.map(function (weight, index) {
    var whole = Math.floor(amount / totalWeight);
    var remainder = amount - whole * totalWeight;
    var base = whole * weight;
    var numerator = remainder * weight;
    if (!Number.isSafeInteger(base) || !Number.isSafeInteger(numerator)) {
      throw new Error("Распределение по строкам выходит за безопасный целочисленный диапазон.");
    }
    var fractionalFloor = Math.floor(numerator / totalWeight);
    return { index: index, minor: base + fractionalFloor, remainder: numerator - fractionalFloor * totalWeight };
  });
  var assigned = shares.reduce(function (sum, share) { return sum + share.minor; }, 0);
  var remainderMinor = amount - assigned;
  shares.slice().sort(function (a, b) {
    if (b.remainder !== a.remainder) return b.remainder - a.remainder;
    return a.index - b.index;
  }).slice(0, remainderMinor).forEach(function (share) { shares[share.index].minor += 1; });
  shares.sort(function (a, b) { return a.index - b.index; });
  return shares.map(function (share) { return share.minor; });
}

function di3FinanceNormalizeDate_(value, endOfDay) {
  if (value === "" || value == null) return null;
  var date = di3ToDate_(value, "Фильтр финансового периода");
  return endOfDay
    ? new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999)
    : new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0);
}

function di3FinanceIsInRange_(value, start, end) {
  if (value === "" || value == null) return false;
  var millis = di3ToMillis_(value);
  return millis > 0 && millis >= start.getTime() && millis <= end.getTime();
}

function di3FinanceGetMonthKey_(date) {
  return Utilities.formatDate(date, di3GetConfiguredTimeZone_(), "yyyy-MM");
}

/** Resolve stable table-column positions from the active schema; never hardcode row offsets. */
function di3FinanceColumnIndex_(tableName, columnName) {
  var schema = DI3_TABLE_SCHEMAS[tableName];
  if (!Array.isArray(schema)) throw new Error("Finance Dashboard: отсутствует схема таблицы " + tableName + ".");
  var index = schema.indexOf(String(columnName));
  if (index < 0) throw new Error("Finance Dashboard: в схеме " + tableName + " отсутствует колонка " + columnName + ".");
  return index;
}

function di3FinanceColumnMap_(tableName, columnNames) {
  var map = Object.create(null);
  (columnNames || []).forEach(function (name) { map[name] = di3FinanceColumnIndex_(tableName, name); });
  return map;
}

function di3FinanceCreateBucket_(key) {
  return {
    month: key, order_ids: Object.create(null), buyer_paid_minor: 0, commission_minor: 0, discount_minor: 0,
    seller_revenue_minor: 0, known_cogs_minor: 0, unknown_cost_lines: 0,
    purchase_minor: 0, purchase_units: 0
  };
}

function di3FinanceResolveLatestOrderCosts_(snapshotRows) {
  var col = di3FinanceColumnMap_("OrderCostSnapshots", ["order_item_id", "calculation_version", "cost_amount_minor", "cost_status"]);
  var latest = Object.create(null);
  (snapshotRows || []).forEach(function (row) {
    var itemId = String(row[col.order_item_id] || "");
    if (!itemId) return;
    var version = Number(row[col.calculation_version]) || 0;
    if (!latest[itemId] || version > latest[itemId].version) {
      latest[itemId] = {
        version: version,
        cost_minor: row[col.cost_amount_minor] === "" || row[col.cost_amount_minor] == null ? null : Number(row[col.cost_amount_minor]),
        cost_status: String(row[col.cost_status] || "")
      };
    }
  });
  return latest;
}

function di3FinanceResolveItemCost_(itemRow, latestSnapshots) {
  var col = di3FinanceColumnMap_("V3_OrderItems", ["order_item_id", "actual_fifo_cost", "actual_fifo_cost_status"]);
  var itemId = String(itemRow[col.order_item_id] || "");
  var snapshot = latestSnapshots[itemId];
  if (snapshot) {
    if (snapshot.cost_status === "COMPLETE" && Number.isSafeInteger(snapshot.cost_minor) && snapshot.cost_minor >= 0) {
      return { known: true, minor: snapshot.cost_minor, source: "SNAPSHOT" };
    }
    return { known: false, minor: null, source: "SNAPSHOT", status: snapshot.cost_status };
  }
  // Compatibility for completed legacy rows whose immutable snapshot was not yet created.
  var legacyCost = itemRow[col.actual_fifo_cost];
  if (String(itemRow[col.actual_fifo_cost_status] || "") === "COMPLETE" && legacyCost !== "" && legacyCost != null) {
    return { known: true, minor: di3MoneyToMinorUnits_(Number(legacyCost), "Фактическая себестоимость позиции", false), source: "ITEM_FALLBACK" };
  }
  return { known: false, minor: null, source: "MISSING" };
}

/**
 * Builds a financial view from authoritative settlement/order snapshots and received supply lines.
 * Sales are recognized on completed_at only. Commission is always reported separately;
 * it is either added to buyer payment or deducted from seller proceeds by commission_payer.
 * Unknown COGS never becomes 0.
 */
function di3GetFinanceDashboardData(filters) {
  filters = filters || {};
  var now = new Date();
  var start = di3FinanceNormalizeDate_(filters.start_date, false) || new Date(now.getFullYear(), now.getMonth(), 1);
  var end = di3FinanceNormalizeDate_(filters.end_date, true) || new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
  if (start.getTime() > end.getTime()) throw new Error("Начало финансового периода позже его окончания.");
  var selectedProductId = String(filters.product_id || "");
  var allProducts = !selectedProductId || selectedProductId === "ALL";
  var warnings = [];
  var orderCol = di3FinanceColumnMap_("V3_Orders", [
    "order_id", "order_number", "status", "commission_amount", "discount_amount", "completed_at",
    "seller_revenue", "platform_commission_realized", "buyer_paid_total", "settlement_finalized_at", "commission_payer"
  ]);
  var itemCol = di3FinanceColumnMap_("V3_OrderItems", [
    "order_item_id", "order_id", "line_no", "product_id", "quantity", "sale_unit_price", "line_revenue"
  ]);
  var snapshotCol = di3FinanceColumnMap_("OrderCostSnapshots", ["order_item_id"]);
  var supplyCol = di3FinanceColumnMap_("V3_Supplies", ["supply_id", "supply_number", "supplier", "status", "sent_at", "received_at"]);
  var supplyItemCol = di3FinanceColumnMap_("V3_SupplyItems", [
    "supply_id", "product_id", "product_label_snapshot", "received_units", "final_line_amount", "unit_cost"
  ]);
  var bucketMap = Object.create(null);
  function bucketFor(date) {
    var key = di3FinanceGetMonthKey_(date);
    if (!bucketMap[key]) bucketMap[key] = di3FinanceCreateBucket_(key);
    return bucketMap[key];
  }

  var orderRows = di3ReadTableValues_("V3_Orders");
  orderRows.forEach(function (row) {
    if (String(row[orderCol.status]) === DI3_ORDER_STATUS.COMPLETED &&
        (row[orderCol.completed_at] === "" || row[orderCol.completed_at] == null) &&
        (row[orderCol.settlement_finalized_at] === "" || row[orderCol.settlement_finalized_at] == null)) {
      warnings.push("У завершённого заказа " + String(row[orderCol.order_number] || row[orderCol.order_id]) + " отсутствует дата завершения/расчёта; он не включён в периодную аналитику.");
    }
  });
  var recognizedOrders = orderRows.filter(function (row) {
    return String(row[orderCol.status]) === DI3_ORDER_STATUS.COMPLETED &&
      di3FinanceIsInRange_(row[orderCol.completed_at] || row[orderCol.settlement_finalized_at], start, end);
  });
  var recognizedOrderIds = recognizedOrders.map(function (row) { return String(row[orderCol.order_id] || ""); }).filter(Boolean);
  var itemMatches = recognizedOrderIds.length
    ? di3ReadRowsByColumnValues_("V3_OrderItems", itemCol.order_id, recognizedOrderIds)
    : [];
  var itemsByOrder = Object.create(null);
  itemMatches.forEach(function (match) {
    var row = match.values;
    var orderId = String(row[itemCol.order_id] || "");
    if (!itemsByOrder[orderId]) itemsByOrder[orderId] = [];
    itemsByOrder[orderId].push(row);
  });
  Object.keys(itemsByOrder).forEach(function (orderId) {
    itemsByOrder[orderId].sort(function (a, b) { return Number(a[itemCol.line_no]) - Number(b[itemCol.line_no]); });
  });
  var recognizedItemIds = itemMatches.map(function (match) { return String(match.values[itemCol.order_item_id] || ""); }).filter(Boolean);
  var snapshotMatches = recognizedItemIds.length
    ? di3ReadRowsByColumnValues_("OrderCostSnapshots", snapshotCol.order_item_id, recognizedItemIds)
    : [];
  var latestSnapshots = di3FinanceResolveLatestOrderCosts_(snapshotMatches.map(function (match) { return match.values; }));
  var sales = {
    buyer_paid_minor: 0, commission_minor: 0, discount_minor: 0, seller_revenue_minor: 0,
    known_cogs_minor: 0, unknown_cost_lines: 0, order_ids: Object.create(null), item_count: 0
  };

  recognizedOrders.forEach(function (order) {
    var orderId = String(order[orderCol.order_id] || "");
    var orderDate = di3ToDate_(order[orderCol.completed_at] || order[orderCol.settlement_finalized_at], "Дата завершения заказа");
    var orderItems = itemsByOrder[orderId] || [];
    if (!orderItems.length) {
      warnings.push("У завершённого заказа " + String(order[orderCol.order_number] || orderId) + " нет строк V3_OrderItems; финансовые показатели заказа не включены.");
      return;
    }
    var lineGoodsMinor = orderItems.map(function (item) {
      var lineAmount = item[itemCol.line_revenue] === "" || item[itemCol.line_revenue] == null
        ? Number(item[itemCol.quantity]) * Number(item[itemCol.sale_unit_price]) : Number(item[itemCol.line_revenue]);
      return di3MoneyToMinorUnits_(lineAmount, "Выручка строки заказа", false);
    });
    var goodsMinor = lineGoodsMinor.reduce(function (sum, value) { return sum + value; }, 0);
    var discountMinor = di3MoneyToMinorUnits_(Number(order[orderCol.discount_amount] || 0), "Скидка заказа", false);
    var commissionRecorded = order[orderCol.platform_commission_realized] !== "" && order[orderCol.platform_commission_realized] != null;
    var commissionValue = commissionRecorded ? order[orderCol.platform_commission_realized] : order[orderCol.commission_amount];
    var commissionMinor = di3MoneyToMinorUnits_(Number(commissionValue || 0), "Комиссия площадки", false);
    if (!commissionRecorded && commissionMinor > 0) {
      warnings.push("Заказ " + String(order[orderCol.order_number] || orderId) + ": фактическая комиссия не зафиксирована; использована сумма комиссии из документа.");
    }
    if (discountMinor > goodsMinor) {
      warnings.push("Скидка заказа " + String(order[orderCol.order_number] || orderId) + " превышает сумму строк; заказ пропущен.");
      return;
    }
    var discountShares = di3FinanceAllocateMinorByWeights_(discountMinor, lineGoodsMinor);
    var commissionShares = di3FinanceAllocateMinorByWeights_(commissionMinor, lineGoodsMinor);
    var commissionPayer = String(order[orderCol.commission_payer] || "BUYER").toUpperCase();
    if (commissionPayer !== "BUYER" && commissionPayer !== "SELLER") {
      warnings.push("Заказ " + String(order[orderCol.order_number] || orderId) + ": неизвестный плательщик комиссии; для аналитики применено прежнее правило BUYER.");
      commissionPayer = "BUYER";
    }
    var storedSellerRevenue = order[orderCol.seller_revenue] === "" || order[orderCol.seller_revenue] == null ? null
      : di3MoneyToMinorUnits_(Number(order[orderCol.seller_revenue]), "Выручка продавца в заказе", false);
    var storedBuyerPaid = order[orderCol.buyer_paid_total] === "" || order[orderCol.buyer_paid_total] == null ? null
      : di3MoneyToMinorUnits_(Number(order[orderCol.buyer_paid_total]), "Сумма оплаты покупателя в заказе", false);
    var calculatedSplit = di3CalculateOrderCommissionSplit_(goodsMinor, discountMinor, commissionMinor, commissionPayer);
    var calculatedSellerRevenue = calculatedSplit.seller_revenue_cents;
    var calculatedBuyerPaid = calculatedSplit.buyer_paid_cents;
    if (storedSellerRevenue != null && storedSellerRevenue !== calculatedSellerRevenue) {
      warnings.push("Заказ " + String(order[orderCol.order_number] || orderId) + ": выручка продавца в документе не совпадает с суммой строк после скидки.");
    }
    if (storedBuyerPaid != null && storedBuyerPaid !== calculatedBuyerPaid) {
      warnings.push("Заказ " + String(order[orderCol.order_number] || orderId) + ": сумма оплаты покупателя не совпадает с выручкой продавца плюс комиссией.");
    }
    var matchedLineCount = 0;
    orderItems.forEach(function (item, index) {
      var productId = String(item[itemCol.product_id] || "");
      if (!allProducts && productId !== selectedProductId) return;
      matchedLineCount++;
      var lineSplit = di3CalculateOrderCommissionSplit_(
        lineGoodsMinor[index], discountShares[index], commissionShares[index], commissionPayer
      );
      var revenueMinor = lineSplit.seller_revenue_cents;
      var buyerPaidMinor = lineSplit.buyer_paid_cents;
      var cogs = di3FinanceResolveItemCost_(item, latestSnapshots);
      var bucket = bucketFor(orderDate);
      bucket.order_ids[orderId] = true;
      bucket.buyer_paid_minor += buyerPaidMinor;
      bucket.commission_minor += commissionShares[index];
      bucket.discount_minor += discountShares[index];
      bucket.seller_revenue_minor += revenueMinor;
      sales.order_ids[orderId] = true;
      sales.buyer_paid_minor += buyerPaidMinor;
      sales.commission_minor += commissionShares[index];
      sales.discount_minor += discountShares[index];
      sales.seller_revenue_minor += revenueMinor;
      sales.item_count++;
      if (cogs.known) {
        bucket.known_cogs_minor += cogs.minor;
        sales.known_cogs_minor += cogs.minor;
      } else {
        bucket.unknown_cost_lines++;
        sales.unknown_cost_lines++;
      }
    });
    if (!allProducts && matchedLineCount === 0) return;
  });

  var supplyRows = di3ReadTableValues_("V3_Supplies");
  supplyRows.forEach(function (row) {
    if (String(row[supplyCol.status]) === DI3_SUPPLY_STATUS.RECEIVED &&
        (row[supplyCol.received_at] === "" || row[supplyCol.received_at] == null)) {
      warnings.push("У полученной поставки " + String(row[supplyCol.supply_number] || row[supplyCol.supply_id]) + " отсутствует дата получения; она не включена в периодную аналитику.");
    }
  });
  var deliveredSupplies = supplyRows.filter(function (row) {
    return String(row[supplyCol.status]) === DI3_SUPPLY_STATUS.RECEIVED && di3FinanceIsInRange_(row[supplyCol.received_at], start, end);
  });
  var supplyIds = deliveredSupplies.map(function (row) { return String(row[supplyCol.supply_id] || ""); }).filter(Boolean);
  var supplyItemMatches = supplyIds.length ? di3ReadRowsByColumnValues_("V3_SupplyItems", supplyItemCol.supply_id, supplyIds) : [];
  var supplyItemsById = Object.create(null);
  supplyItemMatches.forEach(function (match) {
    var row = match.values;
    var supplyId = String(row[supplyItemCol.supply_id] || "");
    if (!supplyItemsById[supplyId]) supplyItemsById[supplyId] = [];
    supplyItemsById[supplyId].push(row);
  });
  var productsById = Object.create(null);
  di3ListAllProductsForWarehouse_().forEach(function (product) { productsById[String(product.product_id)] = product; });
  var purchases = { total_minor: 0, units: 0, line_count: 0 };
  var deliveries = [];
  var priceHistory = [];
  deliveredSupplies.forEach(function (supply) {
    var supplyId = String(supply[supplyCol.supply_id] || "");
    var lines = supplyItemsById[supplyId] || [];
    var selectedLines = lines.filter(function (line) { return allProducts || String(line[supplyItemCol.product_id]) === selectedProductId; });
    if (!selectedLines.length) return;
    var receivedAt = di3ToDate_(supply[supplyCol.received_at], "Дата получения поставки");
    var bucket = bucketFor(receivedAt);
    var days = null;
    if (supply[supplyCol.sent_at] !== "" && supply[supplyCol.sent_at] != null) {
      var sentAt = di3ToDate_(supply[supplyCol.sent_at], "Дата отправки поставки");
      days = (receivedAt.getTime() - sentAt.getTime()) / 86400000;
      if (days < 0) {
        warnings.push("У поставки " + String(supply[supplyCol.supply_number]) + " дата получения раньше даты отправки; срок не рассчитан.");
        days = null;
      }
    } else {
      warnings.push("У полученной поставки " + String(supply[supplyCol.supply_number] || supplyId) + " отсутствует дата отправки; срок доставки не рассчитан.");
    }
    var displayNames = [];
    selectedLines.forEach(function (line) {
      var units = Number(line[supplyItemCol.received_units]) || 0;
      var amountValue = line[supplyItemCol.final_line_amount] === "" || line[supplyItemCol.final_line_amount] == null
        ? Number(line[supplyItemCol.unit_cost] || 0) * units : Number(line[supplyItemCol.final_line_amount]);
      var amountMinor = di3MoneyToMinorUnits_(amountValue, "Итоговая стоимость строки поставки", false);
      purchases.total_minor += amountMinor;
      purchases.units += units;
      purchases.line_count++;
      bucket.purchase_minor += amountMinor;
      bucket.purchase_units += units;
      var productId = String(line[supplyItemCol.product_id] || "");
      var product = productsById[productId];
      var label = String(line[supplyItemCol.product_label_snapshot] || (product ? di3GetProductLabel_(product) : productId));
      displayNames.push(label);
      priceHistory.push({
        date: receivedAt, supply_number: String(supply[supplyCol.supply_number] || ""), supplier: String(supply[supplyCol.supplier] || ""),
        product_id: productId, product_label: label, units: units, total_minor: amountMinor,
        unit_cost: units > 0 ? amountMinor / 100 / units : null
      });
    });
    if (days != null) deliveries.push({
      supply_number: String(supply[supplyCol.supply_number] || ""), supplier: String(supply[supplyCol.supplier] || ""),
      sent_at: supply[supplyCol.sent_at], received_at: receivedAt, days: days,
      product_count: selectedLines.length, product_labels: displayNames.join(", ")
    });
  });

  var months = Object.keys(bucketMap).sort().map(function (key) {
    var bucket = bucketMap[key];
    var profitMinor = bucket.unknown_cost_lines > 0 ? null : bucket.seller_revenue_minor - bucket.known_cogs_minor;
    return {
      month: key,
      month_date: new Date(Number(key.slice(0, 4)), Number(key.slice(5, 7)) - 1, 1),
      order_count: Object.keys(bucket.order_ids).length,
      buyer_paid_minor: bucket.buyer_paid_minor,
      commission_minor: bucket.commission_minor,
      discount_minor: bucket.discount_minor,
      seller_revenue_minor: bucket.seller_revenue_minor,
      known_cogs_minor: bucket.known_cogs_minor,
      unknown_cost_lines: bucket.unknown_cost_lines,
      profit_minor: profitMinor,
      margin: profitMinor == null || bucket.seller_revenue_minor <= 0 ? null : profitMinor / bucket.seller_revenue_minor,
      purchase_minor: bucket.purchase_minor,
      purchase_units: bucket.purchase_units
    };
  });
  priceHistory.sort(function (a, b) { return a.date.getTime() - b.date.getTime() || a.supply_number.localeCompare(b.supply_number); });
  deliveries.sort(function (a, b) { return b.received_at.getTime() - a.received_at.getTime(); });
  var avgDelivery = deliveries.length ? deliveries.reduce(function (sum, item) { return sum + item.days; }, 0) / deliveries.length : null;
  var profitMinor = sales.unknown_cost_lines > 0 ? null : sales.seller_revenue_minor - sales.known_cogs_minor;
  if (sales.unknown_cost_lines > 0) {
    warnings.push("Неполная FIFO-себестоимость: неизвестна для " + sales.unknown_cost_lines + " строк завершённых заказов. Валовая прибыль и маржа не рассчитаны.");
  }
  return {
    filters: { start_date: start, end_date: end, product_id: allProducts ? "ALL" : selectedProductId },
    metrics: {
      buyer_paid_minor: sales.buyer_paid_minor,
      commission_minor: sales.commission_minor,
      discount_minor: sales.discount_minor,
      seller_revenue_minor: sales.seller_revenue_minor,
      known_cogs_minor: sales.known_cogs_minor,
      unknown_cost_lines: sales.unknown_cost_lines,
      profit_minor: profitMinor,
      margin: profitMinor == null || sales.seller_revenue_minor <= 0 ? null : profitMinor / sales.seller_revenue_minor,
      order_count: Object.keys(sales.order_ids).length,
      item_count: sales.item_count,
      purchases_minor: purchases.total_minor,
      purchase_units: purchases.units,
      purchase_lines: purchases.line_count,
      average_delivery_days: avgDelivery,
      delivered_supply_count: deliveries.length
    },
    monthly: months,
    purchase_history: priceHistory,
    deliveries: deliveries,
    warnings: warnings
  };
}

function di3SetupFinanceDashboard() {
  var ss = di3GetSpreadsheet_();
  var sheet = ss.getSheetByName(DI3_FINANCE_DASHBOARD_SHEET);
  var created = false;
  if (!sheet) { sheet = ss.insertSheet(DI3_FINANCE_DASHBOARD_SHEET); di3PrepareNewSheet_(sheet, 40, 17); created = true; }
  if (created || sheet.getLastRow() === 0) {
    sheet.getRange("A1:Q1").merge().setValue("ФИНАНСЫ · АНАЛИТИКА ПРОДАЖ И ЗАКУПОК");
    sheet.getRange("A2:Q2").merge().setValue("Выручка продавца, комиссия площадки отдельно, FIFO-себестоимость, прибыль, закупочные цены и сроки доставки. Продажи признаются по дате завершения заказа.");
    sheet.getRange("A4:P4").merge();
    sheet.getRange("A3").setValue("Период с");
    sheet.getRange("B3").setValue(new Date(new Date().getFullYear(), new Date().getMonth(), 1));
    sheet.getRange("C3").setValue("по");
    sheet.getRange("D3").setValue(new Date());
    sheet.getRange("E3").setValue("Товар");
    sheet.getRange("F3").setValue(DI3_FINANCE_ALL_PRODUCTS_LABEL);
    [
      ["A5:D5", "A6:D7", "Выручка продавца"],
      ["E5:H5", "E6:H7", "Известная себестоимость продаж"],
      ["I5:L5", "I6:L7", "Валовая прибыль"],
      ["M5:P5", "M6:P7", "Маржа"]
    ].forEach(function (card) {
      sheet.getRange(card[0]).merge().setValue(card[2]);
      sheet.getRange(card[1]).merge().setValue("—");
      sheet.getRange(card[0]).setBackground("#EAF0F7").setFontColor("#40516A").setFontWeight("bold");
      sheet.getRange(card[1]).setBackground("#F7F9FC").setFontColor("#202124").setFontSize(18).setFontWeight("bold").setVerticalAlignment("middle");
    });
    [
      ["A8:C8", "Покупатели оплатили: —"],
      ["D8:F8", "Комиссия площадки: —"],
      ["G8:I8", "Скидка продавца: —"],
      ["J8:L8", "Закупки: —"],
      ["M8:Q8", "Средний срок доставки: —"]
    ].forEach(function (item) { sheet.getRange(item[0]).merge().setValue(item[1]).setBackground("#F3F6FA").setFontColor("#40516A"); });
    sheet.getRange("A9:J9").merge().setValue("ФИНАНСОВЫЕ РЕЗУЛЬТАТЫ ПО МЕСЯЦАМ");
    sheet.getRange("K9:Q9").merge().setValue("ДИНАМИКА ЗАКУПОЧНЫХ ЦЕН");
    sheet.getRange(10, 1, 1, DI3_FINANCE_MONTH_HEADERS.length).setValues([DI3_FINANCE_MONTH_HEADERS]);
    sheet.getRange(10, 11, 1, DI3_FINANCE_PURCHASE_HEADERS.length).setValues([DI3_FINANCE_PURCHASE_HEADERS]);
    sheet.getRange("A1:Q1").setBackground("#17243A").setFontColor("#FFFFFF").setFontWeight("bold").setFontSize(15);
    sheet.getRange("A2:Q2").setBackground("#EAF0F7").setFontColor("#40516A");
    sheet.getRange("A3:F3").setBackground("#F3F6FA").setFontColor("#202124");
    sheet.getRange("A9:J9").setBackground("#1F6B62").setFontColor("#FFFFFF").setFontWeight("bold");
    sheet.getRange("K9:Q9").setBackground("#1F6B62").setFontColor("#FFFFFF").setFontWeight("bold");
    sheet.getRange("A10:J10").setBackground("#253B59").setFontColor("#FFFFFF").setFontWeight("bold");
    sheet.getRange("K10:Q10").setBackground("#253B59").setFontColor("#FFFFFF").setFontWeight("bold");
    di3SetFrozenRowsSafely_(sheet, 10);
    [110, 110, 145, 145, 145, 145, 155, 130, 145, 95, 125, 125, 150, 240, 110, 140, 140].forEach(function (width, index) { sheet.setColumnWidth(index + 1, width); });
    sheet.setRowHeight(1, 38);
    sheet.setRowHeight(2, 34);
    sheet.setRowHeights(6, 2, 28);
  } else {
    if (String(sheet.getRange("A1").getDisplayValue() || "") !== "ФИНАНСЫ · АНАЛИТИКА ПРОДАЖ И ЗАКУПОК") {
      throw new Error("Лист «Финансы» уже существует с другой структурой. Автоматическая перезапись запрещена.");
    }
  }
  sheet.getRange("B3").setNumberFormat("dd.mm.yyyy");
  sheet.getRange("D3").setNumberFormat("dd.mm.yyyy");
  var products = di3ListAllProductsForWarehouse_();
  var codeMap = di3GetProductPublicCodeMap_();
  var options = [DI3_FINANCE_ALL_PRODUCTS_LABEL].concat(products.map(function (product) {
    return di3GetProductOptionLabelWithMap_(product, codeMap);
  }));
  sheet.getRange("F3").setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(options, true).setAllowInvalid(false).build());
  if (options.indexOf(String(sheet.getRange("F3").getValue() || "")) === -1) sheet.getRange("F3").setValue(DI3_FINANCE_ALL_PRODUCTS_LABEL);
  sheet.setHiddenGridlines(true);
  di3InstallUnifiedEditTrigger_();
  di3RefreshFinanceDashboard();
  return { status: "READY", sheet: DI3_FINANCE_DASHBOARD_SHEET, product_options: options.length };
}

function di3RefreshFinanceDashboardProductOptions() {
  var sheet = di3GetSpreadsheet_().getSheetByName(DI3_FINANCE_DASHBOARD_SHEET);
  if (!sheet) throw new Error("Сначала создай лист «Финансы».");
  var products = di3ListAllProductsForWarehouse_();
  var codeMap = di3GetProductPublicCodeMap_();
  var options = [DI3_FINANCE_ALL_PRODUCTS_LABEL].concat(products.map(function (product) {
    return di3GetProductOptionLabelWithMap_(product, codeMap);
  }));
  sheet.getRange("F3").setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(options, true).setAllowInvalid(false).build());
  if (options.indexOf(String(sheet.getRange("F3").getValue() || "")) === -1) sheet.getRange("F3").setValue(DI3_FINANCE_ALL_PRODUCTS_LABEL);
  return { products: options.length - 1 };
}

function di3RefreshFinanceDashboard() {
  var sheet = di3GetSpreadsheet_().getSheetByName(DI3_FINANCE_DASHBOARD_SHEET);
  if (!sheet) throw new Error("Сначала запусти setupDotsInventoryV3().");
  var start = sheet.getRange("B3").getValue();
  var end = sheet.getRange("D3").getValue();
  var selectedLabel = String(sheet.getRange("F3").getValue() || DI3_FINANCE_ALL_PRODUCTS_LABEL);
  var selectedProductId = "ALL";
  if (selectedLabel !== DI3_FINANCE_ALL_PRODUCTS_LABEL) {
    var products = di3ListAllProductsForWarehouse_();
    var codeMap = di3GetProductPublicCodeMap_();
    var matches = products.filter(function (product) { return di3GetProductOptionLabelWithMap_(product, codeMap) === selectedLabel; });
    if (matches.length !== 1) throw new Error("Не удалось однозначно определить товар в фильтре «Финансы». Обнови список товаров.");
    selectedProductId = String(matches[0].product_id);
  }
  var data = di3GetFinanceDashboardData({ start_date: start, end_date: end, product_id: selectedProductId });
  var existingLastRow = sheet.getLastRow();
  if (existingLastRow >= 9) {
    var dynamicArea = sheet.getRange(9, 1, existingLastRow - 8, 17);
    dynamicArea.breakApart();
    dynamicArea.clearContent();
  }
  sheet.getBandings().forEach(function (banding) { banding.remove(); });
  sheet.getCharts().forEach(function (chart) { sheet.removeChart(chart); });
  sheet.getRange("A9:J9").merge().setValue("ФИНАНСОВЫЕ РЕЗУЛЬТАТЫ ПО МЕСЯЦАМ");
  sheet.getRange("K9:Q9").merge().setValue("ДИНАМИКА ЗАКУПОЧНЫХ ЦЕН");
  sheet.getRange(10, 1, 1, DI3_FINANCE_MONTH_HEADERS.length).setValues([DI3_FINANCE_MONTH_HEADERS]);
  sheet.getRange(10, 11, 1, DI3_FINANCE_PURCHASE_HEADERS.length).setValues([DI3_FINANCE_PURCHASE_HEADERS]);
  sheet.getRange("A9:J9").setBackground("#1F6B62").setFontColor("#FFFFFF").setFontWeight("bold");
  sheet.getRange("K9:Q9").setBackground("#1F6B62").setFontColor("#FFFFFF").setFontWeight("bold");
  sheet.getRange("A10:J10").setBackground("#253B59").setFontColor("#FFFFFF").setFontWeight("bold");
  sheet.getRange("K10:Q10").setBackground("#253B59").setFontColor("#FFFFFF").setFontWeight("bold");

  var metrics = data.metrics;
  var cardValues = [
    ["A6", di3MoneyFromMinorUnits_(metrics.seller_revenue_minor)],
    ["E6", di3MoneyFromMinorUnits_(metrics.known_cogs_minor)],
    ["I6", metrics.profit_minor == null ? "Неполная оценка" : di3MoneyFromMinorUnits_(metrics.profit_minor)],
    ["M6", metrics.margin == null ? "—" : metrics.margin]
  ];
  cardValues.forEach(function (item) { sheet.getRange(item[0]).setValue(item[1]); });
  sheet.getRange("A6").setNumberFormat("#,##0.00 ₽");
  sheet.getRange("E6").setNumberFormat("#,##0.00 ₽");
  sheet.getRange("I6").setNumberFormat("#,##0.00 ₽");
  sheet.getRange("M6").setNumberFormat("0.0%");
  sheet.getRange("A8").setValue("Покупатели: " + di3MoneyFromMinorUnits_(metrics.buyer_paid_minor).toFixed(2) + " ₽");
  sheet.getRange("D8").setValue("Комиссия: " + di3MoneyFromMinorUnits_(metrics.commission_minor).toFixed(2) + " ₽ · не доход продавца");
  sheet.getRange("G8").setValue("Скидка: " + di3MoneyFromMinorUnits_(metrics.discount_minor).toFixed(2) + " ₽");
  sheet.getRange("J8").setValue("Закупки: " + di3MoneyFromMinorUnits_(metrics.purchases_minor).toFixed(2) + " ₽ · " + metrics.purchase_units + " шт.");
  sheet.getRange("M8").setValue("Средний срок доставки: " + (metrics.average_delivery_days == null ? "—" : metrics.average_delivery_days.toFixed(1) + " дн."));

  var monthlyRows = data.monthly.map(function (bucket) {
    return [bucket.month_date, bucket.order_count,
      di3MoneyFromMinorUnits_(bucket.buyer_paid_minor), di3MoneyFromMinorUnits_(bucket.commission_minor),
      di3MoneyFromMinorUnits_(bucket.discount_minor), di3MoneyFromMinorUnits_(bucket.seller_revenue_minor),
      di3MoneyFromMinorUnits_(bucket.known_cogs_minor), bucket.unknown_cost_lines,
      bucket.profit_minor == null ? "" : di3MoneyFromMinorUnits_(bucket.profit_minor),
      bucket.margin == null ? "" : bucket.margin];
  });
  if (monthlyRows.length) {
    di3EnsureSheetCapacity_(sheet, 10 + monthlyRows.length + 1, 17);
    sheet.getRange(11, 1, monthlyRows.length, 10).setValues(monthlyRows);
    sheet.getRange(11, 1, monthlyRows.length, 1).setNumberFormat("mmm yyyy");
    sheet.getRange(11, 2, monthlyRows.length, 1).setNumberFormat("#,##0");
    sheet.getRange(11, 3, monthlyRows.length, 5).setNumberFormat("#,##0.00 ₽");
    sheet.getRange(11, 8, monthlyRows.length, 1).setNumberFormat("#,##0");
    sheet.getRange(11, 9, monthlyRows.length, 1).setNumberFormat("#,##0.00 ₽");
    sheet.getRange(11, 10, monthlyRows.length, 1).setNumberFormat("0.0%");
    di3ApplyLightBandingWithDarkText_(sheet.getRange(11, 1, monthlyRows.length, 10));
  }

  var purchaseRows = data.purchase_history.slice(-250).map(function (item) {
    return [item.date, item.supply_number, item.supplier, item.product_label, item.units,
      di3MoneyFromMinorUnits_(item.total_minor), item.unit_cost == null ? "" : item.unit_cost];
  });
  if (purchaseRows.length) {
    di3EnsureSheetCapacity_(sheet, 10 + purchaseRows.length + 1, 17);
    sheet.getRange(11, 11, purchaseRows.length, 7).setValues(purchaseRows);
    sheet.getRange(11, 11, purchaseRows.length, 1).setNumberFormat("dd.mm.yyyy");
    sheet.getRange(11, 15, purchaseRows.length, 1).setNumberFormat("#,##0");
    sheet.getRange(11, 16, purchaseRows.length, 2).setNumberFormat("#,##0.00 ₽");
    di3ApplyLightBandingWithDarkText_(sheet.getRange(11, 11, purchaseRows.length, 7));
  }

  var deliverySectionRow = Math.max(15, 11 + monthlyRows.length + 3);
  sheet.getRange(deliverySectionRow, 1, 1, 6).merge().setValue("СРОКИ ДОСТАВКИ ПОЛУЧЕННЫХ ПОСТАВОК");
  sheet.getRange(deliverySectionRow, 1, 1, 6).setBackground("#1F6B62").setFontColor("#FFFFFF").setFontWeight("bold");
  var deliveryHeaderRow = deliverySectionRow + 1;
  sheet.getRange(deliveryHeaderRow, 1, 1, DI3_FINANCE_DELIVERY_HEADERS.length).setValues([DI3_FINANCE_DELIVERY_HEADERS]);
  sheet.getRange(deliveryHeaderRow, 1, 1, 6).setBackground("#253B59").setFontColor("#FFFFFF").setFontWeight("bold");
  var deliveryRows = data.deliveries.slice(0, 200).map(function (item) {
    return [item.supply_number, item.supplier, item.sent_at, item.received_at, item.days, item.product_labels];
  });
  var deliveryStart = deliveryHeaderRow + 1;
  if (deliveryRows.length) {
    di3EnsureSheetCapacity_(sheet, deliveryStart + deliveryRows.length + 20, 17);
    sheet.getRange(deliveryStart, 1, deliveryRows.length, 6).setValues(deliveryRows);
    sheet.getRange(deliveryStart, 3, deliveryRows.length, 2).setNumberFormat("dd.mm.yyyy");
    sheet.getRange(deliveryStart, 5, deliveryRows.length, 1).setNumberFormat("0.0");
    di3ApplyLightBandingWithDarkText_(sheet.getRange(deliveryStart, 1, deliveryRows.length, 6));
  }
  if (data.deliveries.length > deliveryRows.length) {
    sheet.getRange(deliveryStart + deliveryRows.length, 1, 1, 6).merge()
      .setValue("Показаны последние " + deliveryRows.length + " из " + data.deliveries.length + " поставок.")
      .setFontColor("#64748B");
  }

  var chartRow = Math.max(deliveryStart + deliveryRows.length + 3, 30, 11 + purchaseRows.length + 3);
  if (monthlyRows.length > 1) {
    di3EnsureSheetCapacity_(sheet, chartRow + 20, 17);
    var chart = sheet.newChart().asLineChart()
      .addRange(sheet.getRange(10, 1, monthlyRows.length + 1, 1))
      .addRange(sheet.getRange(10, 6, monthlyRows.length + 1, 1))
      .addRange(sheet.getRange(10, 7, monthlyRows.length + 1, 1))
      .addRange(sheet.getRange(10, 9, monthlyRows.length + 1, 1))
      .setPosition(chartRow, 1, 0, 0)
      .setOption("title", "Выручка продавца, себестоимость и прибыль по месяцам")
      .setOption("legend", { position: "bottom" })
      .setOption("width", 760)
      .setOption("height", 350)
      .build();
    sheet.insertChart(chart);
  }
  if (selectedProductId !== "ALL" && purchaseRows.length > 1) {
    di3EnsureSheetCapacity_(sheet, chartRow + 20, 17);
    var priceChart = sheet.newChart().asLineChart()
      .addRange(sheet.getRange(10, 11, purchaseRows.length + 1, 1))
      .addRange(sheet.getRange(10, 17, purchaseRows.length + 1, 1))
      .setPosition(chartRow, 10, 0, 0)
      .setOption("title", "Динамика закупочной себестоимости выбранного товара")
      .setOption("legend", { position: "none" })
      .setOption("width", 760)
      .setOption("height", 350)
      .build();
    sheet.insertChart(priceChart);
  }
  if (data.warnings.length) sheet.getRange("A4").setValue("Предупреждения: " + data.warnings.slice(0, 3).join(" · "))
    .setBackground("#FEF3C7").setFontColor("#92400E");
  else sheet.getRange("A4").setValue("Продажи учитываются после статуса «Завершен». Комиссия площадки оплачивается покупателем и не входит в прибыль продавца.")
    .setBackground("#EAF0F7").setFontColor("#40516A");
  var requiredRows = chartRow + 20;
  di3CompactSheet_(sheet, Math.max(10, requiredRows), 17);
  sheet.setHiddenGridlines(true);
  return {
    status: "REFRESHED", metrics: metrics, month_rows: monthlyRows.length,
    purchase_rows: purchaseRows.length, delivery_rows: deliveryRows.length,
    warning_count: data.warnings.length
  };
}

function di3OpenFinanceDashboard() {
  var sheet = di3GetSpreadsheet_().getSheetByName(DI3_FINANCE_DASHBOARD_SHEET);
  if (!sheet) throw new Error("Лист «Финансы» не найден. Запусти setupDotsInventoryV3().");
  di3GetSpreadsheet_().setActiveSheet(sheet);
  return { opened: true, sheet: DI3_FINANCE_DASHBOARD_SHEET };
}
