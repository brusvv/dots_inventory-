/**
 * Dots Inventory v3 — stock ledger, FIFO lots, allocation runs and valuation.
 * The module owns stock movements and does not depend on an external catalogue sheet.
 */

var DI3_FIFO_COST_STATUS = Object.freeze({ KNOWN: "KNOWN", FREE: "FREE", UNKNOWN: "UNKNOWN" });
var DI3_STOCK_MOVEMENT_TYPE = Object.freeze({ IN: "IN", OUT: "OUT" });
var DI3_STOCK_REASON_LABELS = Object.freeze({
  IN: {
    OLD_STOCK_NO_DOC: "Старые запасы без документа",
    PERSONAL_STOCK: "Личные запасы",
    FREE_GOODS: "Получено бесплатно",
    CUSTOMER_RETURN: "Возврат товара",
    ADJUSTMENT: "Корректировка остатка",
    OTHER: "Другое"
  },
  OUT: {
    TESTING: "Тестирование продукта",
    OFFLINE_SALE: "Продажа вне системы",
    INTERNAL_USE: "Внутреннее использование",
    DAMAGE_LOSS: "Порча / утрата",
    ADJUSTMENT: "Корректировка остатка",
    OTHER: "Другое"
  }
});

function di3EnsureStockCoreSchemas_() {
  // Uses additive standalone schemas and performs a one-time bootstrap of the active FIFO state.
  var created = di3EnsureCoreFoundationSchemas_();
  if (typeof di3EnsureMoneyMinorUnitsState_ === "function") di3EnsureMoneyMinorUnitsState_();
  di3EnsureProductPublicCodes_();
  if (typeof di3EnsureIncrementalFifoReady_ === "function") di3EnsureIncrementalFifoReady_();
  return created;
}

function di3ToDate_(value, fieldName) {
  var date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (isNaN(date.getTime())) throw new Error((fieldName || "Дата") + ": некорректная дата и время.");
  return date;
}

function di3ToMillis_(value) {
  if (value instanceof Date) return value.getTime();
  var date = new Date(value);
  return isNaN(date.getTime()) ? 0 : date.getTime();
}

function di3GetProductPublicCodeMap_() {
  var map = {};
  var spreadsheet = di3GetSpreadsheet_();
  if (!spreadsheet || !spreadsheet.getSheetByName("ProductPublicCodes")) return map;
  di3ReadTableValues_("ProductPublicCodes").forEach(function (row) {
    if (row[0] && row[1]) map[String(row[0])] = String(row[1]);
  });
  return map;
}

function di3EnsureProductPublicCodes_() {
  return di3WithLock_(function () {
    if (!di3GetSpreadsheet_().getSheetByName("ProductPublicCodes") || !di3GetSpreadsheet_().getSheetByName("Products")) return { added: 0 };
  var products = di3ReadTableValues_("Products");
  var codes = di3ReadTableValues_("ProductPublicCodes");
  var byProduct = {};
  var usedCodes = {};
  var maxSequence = 0;
  codes.forEach(function (row, index) {
    var productId = String(row[0] || "");
    var code = String(row[1] || "");
    if (!productId || !code) throw new Error("ProductPublicCodes: пустой product_id или display_code в строке " + (index + 2) + ".");
    if (byProduct[productId]) throw new Error("ProductPublicCodes: повторяется product_id " + productId + ".");
    if (usedCodes[code]) throw new Error("ProductPublicCodes: повторяется display_code " + code + ".");
    byProduct[productId] = true;
    usedCodes[code] = true;
    var match = code.match(/^PRD-(\d+)$/);
    if (match) maxSequence = Math.max(maxSequence, Number(match[1]));
  });
  var rows = [];
  products.forEach(function (row) {
    var productId = String(row[0] || "");
    if (!productId || byProduct[productId]) return;
    maxSequence++;
    var code = "PRD-" + String(maxSequence).padStart(4, "0");
    if (usedCodes[code]) throw new Error("Не удалось выделить уникальный код товара " + code + ".");
    rows.push([productId, code, new Date()]);
    byProduct[productId] = true;
    usedCodes[code] = true;
  });
    di3AppendTableRows_("ProductPublicCodes", rows);
    return { added: rows.length };
  });
}

function di3GetShortProductCodeWithMap_(productId, codeMap) {
  var map = codeMap || {};
  if (map[String(productId)]) return map[String(productId)];
  var token = String(productId || "").replace(/[^a-z0-9]/gi, "").toUpperCase();
  return token ? "PRD-" + token.substring(0, 8) : "PRD-UNKNOWN";
}

function di3GetShortProductCode_(productId) {
  return di3GetShortProductCodeWithMap_(productId, di3GetProductPublicCodeMap_());
}

function di3GetProductLabel_(product) {
  return di3CreateProductLabel_(product.brand, product.model, product.diameter);
}

function di3GetProductOptionLabelWithMap_(product, codeMap) {
  var code = codeMap[String(product.product_id)] || di3GetShortProductCode_(product.product_id);
  return code + " | " + di3GetProductLabel_(product);
}

function di3GetProductOptionLabel_(product) {
  return di3GetProductOptionLabelWithMap_(product, di3GetProductPublicCodeMap_());
}

/** Create a product in the standalone catalogue. Model and diameter may be blank. */
function di3CreateProduct(command) {
  return di3WithLock_(function () {
    di3EnsureStockCoreSchemas_();
    command = command || {};
    var brand = di3NormalizeText_(command.brand);
    var model = di3NormalizeText_(command.model);
    var diameterResult = di3NormalizeDiameter_(command.diameter, command.diameter);
    if (!brand) throw new Error("Для товара обязательно заполнить бренд.");
    if (diameterResult.invalidDate) throw new Error("Диаметр похож на дату. Укажи корректный диаметр или оставь поле пустым.");
    var identityKey = di3BuildIdentityKey_(brand, model, diameterResult.value);
    var normalizedUnitsPerPack = command.units_per_pack;
    if (normalizedUnitsPerPack !== "" && normalizedUnitsPerPack != null) {
      normalizedUnitsPerPack = Number(normalizedUnitsPerPack);
      if (!Number.isInteger(normalizedUnitsPerPack) || normalizedUnitsPerPack <= 0) {
        throw new Error("Фасовка должна быть положительным целым числом.");
      }
    }
    var products = di3LoadProductsIndex_();
    if (products.byIdentity[identityKey]) {
      var existing = products.byIdentity[identityKey];
      // Creating a product must never mutate an existing product's pack catalogue.
      // Existing products and their variants are changed only through the explicit editor.
      return {
        created: false,
        product_id: String(existing.product_id),
        display_code: di3GetShortProductCode_(existing.product_id),
        label: di3GetProductLabel_(existing),
        pack_variant: null,
        message: "Товар с такой идентичностью уже существует. Выбери его в карточке продукта для редактирования или добавления фасовки."
      };
    }
    var salePrice = command.current_sale_price === "" || command.current_sale_price == null
      ? "" : Number(command.current_sale_price);
    if (salePrice !== "" && (!Number.isFinite(salePrice) || salePrice < 0)) {
      throw new Error("Цена продажи должна быть неотрицательным числом.");
    }
    var productId = di3MakeUuid_();
    var now = new Date();
    var row = [
      productId, identityKey, brand, model, diameterResult.value,
      di3NormalizeText_(command.category), di3NormalizeText_(command.shape),
      di3NormalizeText_(command.material), di3NormalizeText_(command.thickness),
      di3NormalizeText_(command.foam), salePrice, true, now, now, now
    ];
    di3AppendTableRows_("Products", [row]);
    di3EnsureProductPublicCodes_();
    var variant = null;
    if (normalizedUnitsPerPack !== "" && normalizedUnitsPerPack != null) {
      variant = di3GetOrCreatePackVariant_(productId, normalizedUnitsPerPack, "MANUAL_CATALOG");
    }
    return {
      created: true,
      product_id: productId,
      display_code: di3GetShortProductCode_(productId),
      label: di3GetProductLabel_({ brand: brand, model: model, diameter: diameterResult.value }),
      pack_variant: variant
    };
  });
}

function di3ListAllProductsForWarehouse_() {
  var index = di3LoadProductsIndex_();
  return Object.keys(index.byId).map(function (id) { return index.byId[id]; })
    .sort(function (a, b) {
      return di3GetProductLabel_(a).localeCompare(di3GetProductLabel_(b), "ru");
    });
}

function di3ListActiveProductsForWarehouse_() {
  return di3ListAllProductsForWarehouse_().filter(function (product) {
    return product.active !== false && String(product.active).toLowerCase() !== "false";
  });
}

function di3NormalizeCostStatus_(value) {
  var text = String(value || "").trim().toUpperCase();
  if (text === "KNOWN" || text === "FREE" || text === "UNKNOWN") return text;
  var localized = String(value || "").trim().toLowerCase();
  if (localized === "известна") return "KNOWN";
  if (localized === "бесплатно") return "FREE";
  if (localized === "неизвестна") return "UNKNOWN";
  return "";
}

function di3ValidateInboundCost_(costStatus, unitCost) {
  var status = di3NormalizeCostStatus_(costStatus);
  if (!status) throw new Error("Для прихода выбери состояние себестоимости: известна, бесплатно или неизвестна.");
  if (status === "UNKNOWN") return { cost_status: status, unit_cost: "" };
  if (status === "FREE") return { cost_status: status, unit_cost: 0 };
  var cost = Number(unitCost);
  if (unitCost === "" || unitCost == null || !Number.isFinite(cost) || cost < 0) {
    throw new Error("Для известной себестоимости укажи неотрицательную стоимость единицы.");
  }
  return { cost_status: status, unit_cost: cost };
}

function di3ValidateStockReason_(movementType, reasonCode, note) {
  var table = DI3_STOCK_REASON_LABELS[movementType];
  if (!table || !Object.prototype.hasOwnProperty.call(table, reasonCode)) {
    throw new Error("Основание операции не подходит выбранному типу движения.");
  }
  if (reasonCode === "OTHER" && !di3NormalizeText_(note)) {
    throw new Error("Для основания «Другое» обязательно заполни комментарий.");
  }
}

function di3BuildFifoReplayPlan_(ledgerRows, detailRows, lotRows, cutoff) {
  var cutoffMillis = cutoff == null ? null : di3ToMillis_(cutoff);
  var detailsByMovement = {};
  (detailRows || []).forEach(function (row) {
    var id = String(row[0] || "");
    if (!id) throw new Error("StockMovementDetails содержит запись без movement_id.");
    if (detailsByMovement[id]) throw new Error("StockMovementDetails: дублируется movement_id " + id + ".");
    detailsByMovement[id] = {
      movement_id: id,
      movement_type: String(row[2] || ""),
      reason_code: String(row[3] || ""),
      unit_sale_price: row[4] === "" || row[4] == null ? null : Number(row[4]),
      revenue_amount: row[5] === "" || row[5] == null ? null : Number(row[5]),
      cost_status: String(row[6] || ""),
      reversal_of_movement_id: String(row[7] || ""),
      actor: String(row[8] || ""),
      note: String(row[9] || "")
    };
  });
  var lotsByMovement = {};
  (lotRows || []).forEach(function (row) {
    var movementId = String(row[2] || "");
    if (!movementId) throw new Error("StockLots содержит партию без source_movement_id.");
    if (lotsByMovement[movementId]) throw new Error("Для движения " + movementId + " создано больше одной партии. Пока одна строка прихода создаёт одну FIFO-партию.");
    var lotQuantity = Number(row[8]);
    if (!Number.isInteger(lotQuantity) || lotQuantity <= 0) throw new Error("У партии " + row[0] + " некорректное initial_quantity.");
    var lotCostStatus = String(row[10] || "UNKNOWN");
    if (["KNOWN", "FREE", "UNKNOWN"].indexOf(lotCostStatus) === -1) throw new Error("У партии " + row[0] + " неизвестный cost_status.");
    if (lotCostStatus === "KNOWN" && (row[9] === "" || row[9] == null || !Number.isFinite(Number(row[9])) || Number(row[9]) < 0)) {
      throw new Error("У партии " + row[0] + " некорректная себестоимость.");
    }
    lotsByMovement[movementId] = {
      lot_id: String(row[0] || ""),
      product_id: String(row[1] || ""),
      source_movement_id: movementId,
      effective_at: row[6],
      recorded_at: row[7],
      initial_quantity: lotQuantity,
      unit_cost: row[9] === "" || row[9] == null ? null : Number(row[9]),
      total_cost_minor: di3MoneyGetLotTotalCostMinor_(row),
      consumed_quantity: 0,
      cost_status: lotCostStatus
    };
  });

  var events = [];
  (ledgerRows || []).forEach(function (row, index) {
    var movementId = String(row[0] || "");
    if (!movementId) throw new Error("StockLedger: пустой movement_id в записи " + (index + 2) + ".");
    var productId = String(row[3] || "");
    var delta = Number(row[6]);
    if (!productId || !Number.isFinite(delta) || delta === 0) {
      throw new Error("StockLedger: некорректный товар или quantity_delta в записи " + (index + 2) + ".");
    }
    var detail = detailsByMovement[movementId];
    if (!detail) throw new Error("Для складского движения " + movementId + " отсутствует StockMovementDetails.");
    var effectiveAt = di3ToDate_(row[7], "StockLedger.effective_at");
    var recordedAt = di3ToDate_(row[8], "StockLedger.recorded_at");
    var effectiveMillis = effectiveAt.getTime();
    if (cutoffMillis !== null && effectiveMillis > cutoffMillis) return;
    var movementType = detail.movement_type;
    if (movementType !== "IN" && movementType !== "OUT") {
      throw new Error("Неизвестный movement_type у движения " + movementId + ".");
    }
    if ((movementType === "IN" && delta <= 0) || (movementType === "OUT" && delta >= 0)) {
      throw new Error("Знак quantity_delta не соответствует типу движения " + movementId + ".");
    }
    var event = {
      movement_id: movementId,
      product_id: productId,
      movement_type: movementType,
      quantity: Math.abs(delta),
      effective_at: effectiveAt,
      recorded_at: recordedAt,
      reason_code: detail.reason_code,
      row_number: index + 2
    };
    if (movementType === "IN") {
      var lot = lotsByMovement[movementId];
      if (!lot) throw new Error("Для прихода " + movementId + " отсутствует партия StockLots.");
      if (lot.product_id !== productId || lot.initial_quantity !== event.quantity) {
        throw new Error("Данные StockLots не совпадают с движением " + movementId + ".");
      }
      event.lot = lot;
    }
    events.push(event);
  });

  events.sort(function (a, b) {
    var byEffective = a.effective_at.getTime() - b.effective_at.getTime();
    if (byEffective) return byEffective;
    var byRecorded = a.recorded_at.getTime() - b.recorded_at.getTime();
    if (byRecorded) return byRecorded;
    return a.movement_id.localeCompare(b.movement_id);
  });

  var availableByProduct = {};
  var allocations = [];
  var movementCosts = {};
  var productsSeen = {};
  events.forEach(function (event) {
    productsSeen[event.product_id] = true;
    if (!availableByProduct[event.product_id]) availableByProduct[event.product_id] = [];
    var availableLots = availableByProduct[event.product_id];
    if (event.movement_type === "IN") {
      availableLots.push({
        lot_id: event.lot.lot_id,
        product_id: event.product_id,
        effective_at: event.lot.effective_at,
        recorded_at: event.lot.recorded_at,
        initial_quantity: event.lot.initial_quantity,
        remaining_quantity: event.lot.initial_quantity,
        unit_cost: event.lot.unit_cost,
        total_cost_minor: event.lot.total_cost_minor,
        consumed_quantity: 0,
        cost_status: event.lot.cost_status
      });
      availableLots.sort(function (a, b) {
        var byDate = di3ToMillis_(a.effective_at) - di3ToMillis_(b.effective_at);
        if (byDate) return byDate;
        var byRecorded = di3ToMillis_(a.recorded_at) - di3ToMillis_(b.recorded_at);
        if (byRecorded) return byRecorded;
        return a.lot_id.localeCompare(b.lot_id);
      });
      return;
    }

    var needed = event.quantity;
    var movementAllocationRows = [];
    var knownQuantity = 0;
    var unknownQuantity = 0;
    var knownCostMinor = 0;
    for (var i = 0; i < availableLots.length && needed > 0; i++) {
      var currentLot = availableLots[i];
      if (currentLot.remaining_quantity <= 0) continue;
      var take = Math.min(needed, currentLot.remaining_quantity);
      var lotStatus = String(currentLot.cost_status || "UNKNOWN");
      if (["KNOWN", "FREE", "UNKNOWN"].indexOf(lotStatus) === -1) {
        throw new Error("У партии " + currentLot.lot_id + " неизвестный cost_status.");
      }
      var unitCost = lotStatus === "UNKNOWN" ? null : Number(currentLot.unit_cost);
      if (lotStatus === "KNOWN" && (!Number.isFinite(unitCost) || unitCost < 0)) {
        throw new Error("У партии " + currentLot.lot_id + " некорректная себестоимость.");
      }
      if (lotStatus === "FREE") unitCost = 0;
      var allocatedCostMinor = lotStatus === "UNKNOWN" ? null : di3MoneyAllocateLotCostMinor_(
        Number(currentLot.total_cost_minor), Number(currentLot.initial_quantity),
        Number(currentLot.consumed_quantity), take);
      var allocatedCost = allocatedCostMinor == null ? null : di3MoneyFromMinorUnits_(allocatedCostMinor);
      movementAllocationRows.push({
        movement_id: event.movement_id,
        lot_id: currentLot.lot_id,
        product_id: event.product_id,
        allocation_type: "CONSUME",
        quantity: take,
        unit_cost: unitCost,
        cost_status: lotStatus,
        allocated_cost: allocatedCost,
        allocated_cost_minor: allocatedCostMinor,
        effective_at: event.effective_at,
        recorded_at: event.recorded_at
      });
      if (lotStatus === "UNKNOWN") unknownQuantity += take;
      else {
        knownQuantity += take;
        knownCostMinor += allocatedCostMinor;
      }
      currentLot.consumed_quantity += take;
      currentLot.remaining_quantity -= take;
      needed -= take;
    }
    if (needed > 0) {
      throw new Error("Недостаточно остатка для расхода " + event.movement_id + ": не хватает " + needed + " шт. на дату операции.");
    }
    Array.prototype.push.apply(allocations, movementAllocationRows);
    var costStatus = unknownQuantity === 0 ? "COMPLETE" : (knownQuantity === 0 ? "UNKNOWN" : "PARTIAL");
    movementCosts[event.movement_id] = {
      movement_id: event.movement_id,
      quantity: event.quantity,
      known_quantity: knownQuantity,
      unknown_quantity: unknownQuantity,
      known_cost_minor: knownCostMinor,
      known_cost: di3MoneyFromMinorUnits_(knownCostMinor),
      total_cost_minor: unknownQuantity === 0 ? knownCostMinor : null,
      total_cost: unknownQuantity === 0 ? di3MoneyFromMinorUnits_(knownCostMinor) : null,
      cost_status: costStatus,
      allocation_count: movementAllocationRows.length
    };
  });

  var remainingLots = [];
  Object.keys(availableByProduct).forEach(function (productId) {
    availableByProduct[productId].forEach(function (lot) {
      remainingLots.push(lot);
    });
  });
  return {
    allocations: allocations,
    movement_costs: movementCosts,
    remaining_lots: remainingLots,
    movement_count: events.length,
    product_count: Object.keys(productsSeen).length,
    as_of: cutoffMillis === null ? null : new Date(cutoffMillis)
  };
}

function di3GetLatestFifoAllocationRun_() {
  var rows = di3ReadTableValues_("FifoAllocationRuns");
  var latest = null;
  rows.forEach(function (row, index) {
    if (String(row[2]) !== "COMMITTED") return;
    var seq = Number(row[1]) || 0;
    if (!latest || seq > latest.run_sequence) {
      latest = { run_id: String(row[0]), run_sequence: seq, row_number: index + 2 };
    }
  });
  return latest;
}

function di3UpdateFifoRunStatus_(rowNumber, status, committedAt, errorText, allocationCount) {
  var row = Number(rowNumber);
  if (!Number.isInteger(row) || row < 2) throw new Error("Некорректный номер FIFO run: " + rowNumber);
  var sheet = di3GetSheetOrThrow_("FifoAllocationRuns");
  var current = sheet.getRange(row, 3, 1, 8).getValues()[0];
  current[0] = String(status || "");
  current[3] = committedAt || "";
  if (allocationCount != null) current[5] = Number(allocationCount);
  current[7] = errorText || "";
  sheet.getRange(row, 3, 1, 8).setValues([current]);
}

function di3GetActiveRunAllocations_() {
  // StockAllocations is now a compact active projection. Historical run metadata remains in FifoAllocationRuns.
  var run = di3GetLatestFifoAllocationRun_();
  return { run: run, rows: di3ReadTableValues_("StockAllocations") };
}

function di3BuildProductValuation_(productId, lotRows, allocationRows) {
  var consumedByLot = {};
  (allocationRows || []).forEach(function (row) {
    if (String(row[4]) !== String(productId)) return;
    var lotId = String(row[3]);
    var amount = Number(row[6]) || 0;
    if (String(row[5]) === "CONSUME") consumedByLot[lotId] = (consumedByLot[lotId] || 0) + amount;
  });
  var totalQuantity = 0, knownQuantity = 0, unknownQuantity = 0, knownValueMinor = 0;
  var lots = [];
  (lotRows || []).forEach(function (row) {
    if (String(row[1]) !== String(productId)) return;
    var original = Number(row[8]) || 0;
    var consumed = consumedByLot[String(row[0])] || 0;
    var derivedRemaining = original - consumed;
    if (derivedRemaining < -1e-9) throw new Error("FIFO-распределения превысили количество партии " + row[0] + ".");
    if (derivedRemaining < 0) derivedRemaining = 0;
    var cachedRemaining = row.length > 13 && row[13] !== "" && row[13] != null ? Number(row[13]) : derivedRemaining;
    if (!Number.isFinite(cachedRemaining) || Math.abs(cachedRemaining - derivedRemaining) > 1e-9) {
      throw new Error("Кэш remaining_quantity партии " + row[0] + " не совпадает с активными FIFO-распределениями. Запусти полный FIFO rebuild.");
    }
    var remaining = cachedRemaining;
    totalQuantity += remaining;
    var costStatus = String(row[10] || "UNKNOWN");
    var unitCost = row[9] === "" || row[9] == null ? null : Number(row[9]);
    var totalCostMinor = di3MoneyGetLotTotalCostMinor_(row);
    var remainingCostMinor = costStatus === "UNKNOWN" ? null : di3MoneyGetLotRemainingCostMinor_(row, remaining);
    if (costStatus === "UNKNOWN") unknownQuantity += remaining;
    else {
      knownQuantity += remaining;
      knownValueMinor += Number(remainingCostMinor);
    }
    var nextUnitCostMinor = remaining > 0 && costStatus !== "UNKNOWN"
      ? di3MoneyAllocateLotCostMinor_(Number(totalCostMinor), original, consumed, 1) : null;
    lots.push({
      lot_id: String(row[0]), source_movement_id: String(row[2]),
      effective_at: row[6], recorded_at: row[7], initial_quantity: original,
      consumed_quantity: consumed, remaining_quantity: remaining,
      unit_cost: unitCost, total_cost_minor: totalCostMinor, remaining_cost_minor: remainingCostMinor,
      next_unit_cost_minor: nextUnitCostMinor, cost_status: costStatus
    });
  });
  lots.sort(function (a, b) {
    var byEffective = di3ToMillis_(a.effective_at) - di3ToMillis_(b.effective_at);
    if (byEffective) return byEffective;
    var byRecorded = di3ToMillis_(a.recorded_at) - di3ToMillis_(b.recorded_at);
    if (byRecorded) return byRecorded;
    return a.lot_id.localeCompare(b.lot_id);
  });
  var nextLot = lots.filter(function (lot) { return lot.remaining_quantity > 0; })[0] || null;
  var nextFifoCost = nextLot && nextLot.cost_status !== "UNKNOWN"
    ? di3MoneyFromMinorUnits_(Number(nextLot.next_unit_cost_minor || 0)) : null;
  var knownValue = di3MoneyFromMinorUnits_(knownValueMinor);
  var averageKnown = knownQuantity > 0 ? knownValue / knownQuantity : null;
  var status = totalQuantity === 0 ? "EMPTY" : (unknownQuantity > 0
    ? (knownQuantity > 0 ? "PARTIAL" : "UNVALUED") : "COMPLETE");
  return {
    product_id: String(productId), total_quantity: totalQuantity,
    known_quantity: knownQuantity, unknown_quantity: unknownQuantity,
    known_inventory_value_minor: knownValueMinor,
    known_inventory_value: knownValue,
    inventory_value: unknownQuantity === 0 ? knownValue : null,
    average_known_unit_cost: averageKnown,
    average_unit_cost: unknownQuantity === 0 && totalQuantity > 0 ? knownValue / totalQuantity : null,
    next_fifo_unit_cost: nextFifoCost,
    next_fifo_cost_status: nextLot ? nextLot.cost_status : "EMPTY",
    next_fifo_lot_id: nextLot ? nextLot.lot_id : null,
    cost_coverage_pct: totalQuantity > 0 ? knownQuantity / totalQuantity * 100 : 100,
    valuation_status: status, lots: lots
  };
}

function di3GetPendingStockOperations_() {
  var stockOperationTypes = ["MANUAL_STOCK_MOVEMENT", "SUPPLY_RECEIVE", "ORDER_DISPATCH", "ORDER_RETURN", "STOCK_ADJUSTMENT"];
  var rows = di3ReadRowsByColumnValuesViaTextFinder_("Operations", 5, ["PREPARED", "RETRYABLE", "QUARANTINED"]);
  return rows.filter(function (match) {
    var row = match.values;
    return stockOperationTypes.indexOf(String(row[2])) !== -1;
  }).map(function (match) {
    var row = match.values;
    return { operation_id: String(row[0]), idempotency_key: String(row[1]), operation_type: String(row[2]),
      document_type: String(row[3]), document_id: String(row[4]), status: String(row[5]), error: String(row[9] || "") };
  });
}

function di3AssertNoPendingStockOperations_() {
  var pending = di3GetPendingStockOperations_();
  if (pending.length) {
    throw new Error("Есть незавершённые складские операции (" + pending.length + "). Сначала запусти восстановление складских операций.");
  }
}

function di3GetProductFifoValuation(productId) {
  di3AssertNoPendingStockOperations_();
  var lots = di3ReadRowsByColumnValue_("StockLots", 1, productId).map(function (match) { return match.values; });
  var allocations = di3ReadRowsByColumnValue_("StockAllocations", 4, productId).map(function (match) { return match.values; });
  return di3BuildProductValuation_(productId, lots, allocations);
}

function di3GetMovementFifoCost(movementId) {
  di3AssertNoPendingStockOperations_();
  var active = di3GetActiveRunAllocations_();
  var rows = active.rows.filter(function (row) {
    return String(row[2]) === String(movementId) && String(row[5]) === "CONSUME";
  });
  var quantity = 0;
  var knownQuantity = 0;
  var unknownQuantity = 0;
  var knownCostMinor = 0;
  rows.forEach(function (row) {
    var q = Number(row[6]) || 0;
    quantity += q;
    if (String(row[8]) === "UNKNOWN") unknownQuantity += q;
    else {
      knownQuantity += q;
      knownCostMinor += Number(di3MoneyGetAllocationCostMinor_(row) || 0);
    }
  });
  var knownCost = di3MoneyFromMinorUnits_(knownCostMinor);
  return {
    movement_id: String(movementId),
    quantity: quantity,
    known_quantity: knownQuantity,
    unknown_quantity: unknownQuantity,
    known_cost_minor: knownCostMinor,
    known_cost: knownCost,
    total_cost_minor: unknownQuantity === 0 ? knownCostMinor : null,
    total_cost: unknownQuantity === 0 ? knownCost : null,
    cost_status: unknownQuantity === 0 ? "COMPLETE" : (knownQuantity ? "PARTIAL" : "UNKNOWN")
  };
}


function di3GetMovementFinancialResult(movementId) {
  di3AssertNoPendingStockOperations_();
  var detail = di3FindRowByFirstColumn_("StockMovementDetails", movementId);
  if (!detail) throw new Error("Не найдено описание складского движения " + movementId + ".");
  var row = detail.values;
  var movementType = String(row[2]);
  var revenue = row[5] === "" || row[5] == null ? null : di3MoneyFromMinorUnits_(di3MoneyToMinorUnits_(row[5], "Выручка", false));
  var revenueMinor = revenue == null ? null : di3MoneyToMinorUnits_(revenue, "Выручка", false);
  var fifo = movementType === "OUT" ? di3GetMovementFifoCost(movementId) : null;
  var grossProfitMinor = revenueMinor != null && fifo && fifo.total_cost_minor != null
    ? revenueMinor - fifo.total_cost_minor : null;
  return {
    movement_id: String(movementId),
    display_code: String(row[1] || ""),
    movement_type: movementType,
    reason_code: String(row[3] || ""),
    revenue: revenue,
    revenue_minor: revenueMinor,
    fifo_cost: fifo,
    gross_profit_minor: grossProfitMinor,
    gross_profit: grossProfitMinor == null ? null : di3MoneyFromMinorUnits_(grossProfitMinor),
    gross_profit_status: revenue == null ? "NO_REVENUE" : (fifo && fifo.total_cost != null ? "COMPLETE" : "INCOMPLETE_FIFO_COST")
  };
}

function di3GetInventoryValuationSummary() {
  di3AssertNoPendingStockOperations_();
  var products = di3ListAllProductsForWarehouse_();
  var active = di3GetActiveRunAllocations_();
  var lots = di3ReadTableValues_("StockLots");
  var totals = {
    products: products.length,
    active_products: products.filter(function (p) { return p.active !== false && String(p.active).toLowerCase() !== "false"; }).length,
    total_quantity: 0,
    known_quantity: 0,
    unknown_quantity: 0,
    known_inventory_value: 0,
    known_inventory_value_minor: 0,
    inventory_value: 0,
    average_known_unit_cost: null,
    valuation_status: "COMPLETE"
  };
  products.forEach(function (product) {
    var valuation = di3BuildProductValuation_(product.product_id, lots, active.rows);
    totals.total_quantity += valuation.total_quantity;
    totals.known_quantity += valuation.known_quantity;
    totals.unknown_quantity += valuation.unknown_quantity;
    totals.known_inventory_value_minor += Number(valuation.known_inventory_value_minor || 0);
  });
  totals.known_inventory_value = di3MoneyFromMinorUnits_(totals.known_inventory_value_minor);
  totals.inventory_value = totals.unknown_quantity === 0 ? totals.known_inventory_value : null;
  totals.average_known_unit_cost = totals.known_quantity > 0
    ? totals.known_inventory_value / totals.known_quantity : null;
  if (totals.unknown_quantity > 0) totals.valuation_status = totals.known_quantity > 0 ? "PARTIAL" : "UNVALUED";
  return totals;
}

function di3CalculatePriceSuggestion_(averageFifoCost, currentSalePrice, targetGrossMargin, hasUnknownCost, totalQuantity) {
  var margin = Number(targetGrossMargin);
  if (!Number.isFinite(margin) || margin < 0 || margin >= 0.95) {
    throw new Error("Целевая валовая маржа должна быть от 0% до 95%.");
  }
  if (!(Number(totalQuantity) > 0)) return { status: "NO_STOCK" };
  if (hasUnknownCost || averageFifoCost == null || !Number.isFinite(Number(averageFifoCost))) {
    return { status: "INCOMPLETE_COST_COVERAGE", message: "Часть остатка имеет неизвестную себестоимость." };
  }
  var averageCost = Number(averageFifoCost);
  var currentPrice = currentSalePrice === "" || currentSalePrice == null ? null : Number(currentSalePrice);
  var minimumPrice = averageCost / (1 - margin);
  var currentGrossMargin = currentPrice != null && currentPrice > 0
    ? (currentPrice - averageCost) / currentPrice : null;
  return {
    status: "READY",
    average_fifo_cost: averageCost,
    current_sale_price: currentPrice,
    current_gross_margin: currentGrossMargin,
    target_gross_margin: margin,
    minimum_sale_price: minimumPrice,
    maximum_discount_per_unit: currentPrice == null ? null : Math.max(0, currentPrice - minimumPrice),
    suggested_price: currentPrice == null ? minimumPrice : Math.max(currentPrice, minimumPrice),
    note: "Расчёт основан на валовой марже и не учитывает комиссии, налоги и индивидуальные расходы продажи."
  };
}

function di3AddNextFifoPriceGuidance_(suggestion, valuation, currentSalePrice, targetGrossMargin) {
  var margin = Number(targetGrossMargin);
  var currentPrice = currentSalePrice === "" || currentSalePrice == null ? null : Number(currentSalePrice);
  var nextCost = valuation.next_fifo_unit_cost;
  suggestion.next_fifo_unit_cost = nextCost;
  suggestion.next_fifo_cost_status = valuation.next_fifo_cost_status;
  suggestion.next_fifo_lot_id = valuation.next_fifo_lot_id;
  if (nextCost == null || !Number.isFinite(Number(nextCost)) || !Number.isFinite(margin) || margin < 0 || margin >= 0.95) {
    suggestion.next_fifo_minimum_sale_price = null;
    suggestion.next_fifo_maximum_discount_per_unit = null;
    suggestion.next_fifo_pricing_status = valuation.next_fifo_cost_status === "UNKNOWN" ? "UNKNOWN_NEXT_FIFO_COST" : "UNAVAILABLE";
    return suggestion;
  }
  var nextMinimum = Number(nextCost) / (1 - margin);
  suggestion.next_fifo_minimum_sale_price = nextMinimum;
  suggestion.next_fifo_maximum_discount_per_unit = currentPrice == null ? null : Math.max(0, currentPrice - nextMinimum);
  suggestion.next_fifo_pricing_status = "READY";
  return suggestion;
}

function di3SuggestProductPricing(productId, targetGrossMargin) {
  var product = di3LoadProductById_(productId);
  if (!product) throw new Error("Товар не найден.");
  var valuation = di3GetProductFifoValuation(productId);
  var currentPrice = product.current_sale_price === "" || product.current_sale_price == null
    ? null : Number(product.current_sale_price);
  var suggestion = di3CalculatePriceSuggestion_(
    valuation.average_unit_cost, currentPrice, targetGrossMargin,
    valuation.unknown_quantity > 0, valuation.total_quantity
  );
  di3AddNextFifoPriceGuidance_(suggestion, valuation, currentPrice, targetGrossMargin);
  suggestion.product_id = productId;
  suggestion.valuation = valuation;
  return suggestion;
}

function di3CalculateAverageKnownUnitCost_(knownInventoryValue, knownUnits) {
  var value = Number(knownInventoryValue);
  var units = Number(knownUnits);
  if (!Number.isFinite(value) || !Number.isFinite(units) || units <= 0) return null;
  return di3MoneyRound_(value / units);
}

function di3GetWarehouseDashboardData(targetGrossMargin) {
  var pendingOperations = di3GetPendingStockOperations_();
  var margin = targetGrossMargin == null ? di3GetTargetGrossMargin_() : Number(targetGrossMargin);
  var products = di3ListAllProductsForWarehouse_();
  // Public product codes are a reference lookup shared by every dashboard row.
  // Read once per dashboard render rather than once per product.
  var productCodeMap = di3GetProductPublicCodeMap_();
  var active = di3GetActiveRunAllocations_();
  var lots = di3ReadTableValues_("StockLots");
  var rows = [];
  var totals = { products: products.length, stock_units: 0, known_units: 0, unknown_units: 0, known_inventory_value: 0,
    known_inventory_value_minor: 0, average_known_unit_cost: null, inventory_value: 0,
    pending_products: 0, data_status: pendingOperations.length ? "PENDING_RECONCILIATION" : "CURRENT" };
  products.forEach(function (product) {
    var valuation;
    try {
      valuation = di3BuildProductValuation_(product.product_id, lots, active.rows);
    } catch (error) {
      if (!pendingOperations.length) throw error;
      totals.pending_products++;
      rows.push({
        product_id: String(product.product_id), product_code: di3GetShortProductCodeWithMap_(product.product_id, productCodeMap),
        label: di3GetProductLabel_(product), active: product.active !== false && String(product.active).toLowerCase() !== "false",
        stock_quantity: null, known_quantity: null, unknown_quantity: null, average_fifo_cost: null,
        average_known_fifo_cost: null, next_fifo_unit_cost: null, next_fifo_cost_status: "PENDING",
        next_fifo_minimum_sale_price: null, next_fifo_maximum_discount_per_unit: null, inventory_value: null,
        known_inventory_value: null, current_sale_price: product.current_sale_price === "" || product.current_sale_price == null ? null : Number(product.current_sale_price),
        pricing_status: "PENDING_RECONCILIATION", minimum_sale_price: null, maximum_discount_per_unit: null,
        valuation_status: "PENDING_RECONCILIATION", valuation_error: error.message || String(error)
      });
      return;
    }
    var price = product.current_sale_price === "" || product.current_sale_price == null ? null : Number(product.current_sale_price);
    var pricing = di3CalculatePriceSuggestion_(valuation.average_unit_cost, price, margin,
      valuation.unknown_quantity > 0, valuation.total_quantity);
    di3AddNextFifoPriceGuidance_(pricing, valuation, price, margin);
    rows.push({
      product_id: String(product.product_id),
      product_code: di3GetShortProductCodeWithMap_(product.product_id, productCodeMap),
      label: di3GetProductLabel_(product),
      active: product.active !== false && String(product.active).toLowerCase() !== "false",
      stock_quantity: valuation.total_quantity,
      known_quantity: valuation.known_quantity,
      unknown_quantity: valuation.unknown_quantity,
      average_fifo_cost: valuation.average_unit_cost,
      average_known_fifo_cost: valuation.average_known_unit_cost,
      next_fifo_unit_cost: valuation.next_fifo_unit_cost,
      next_fifo_cost_status: valuation.next_fifo_cost_status,
      next_fifo_minimum_sale_price: pricing.next_fifo_minimum_sale_price,
      next_fifo_maximum_discount_per_unit: pricing.next_fifo_maximum_discount_per_unit,
      inventory_value: valuation.inventory_value,
      known_inventory_value: valuation.known_inventory_value,
      current_sale_price: price,
      pricing_status: pricing.status,
      minimum_sale_price: pricing.minimum_sale_price == null ? null : pricing.minimum_sale_price,
      maximum_discount_per_unit: pricing.maximum_discount_per_unit == null ? null : pricing.maximum_discount_per_unit,
      valuation_status: valuation.valuation_status
    });
    totals.stock_units += valuation.total_quantity;
    totals.known_units += valuation.known_quantity;
    totals.unknown_units += valuation.unknown_quantity;
    totals.known_inventory_value_minor += Number(valuation.known_inventory_value_minor || 0);
  });
  totals.known_inventory_value = di3MoneyFromMinorUnits_(totals.known_inventory_value_minor);
  totals.average_known_unit_cost = di3CalculateAverageKnownUnitCost_(totals.known_inventory_value, totals.known_units);
  if (totals.pending_products > 0) {
    totals.stock_units = null;
    totals.known_units = null;
    totals.unknown_units = null;
    totals.known_inventory_value = null;
    totals.known_inventory_value_minor = null;
    totals.inventory_value = null;
  } else {
    totals.inventory_value = totals.unknown_units === 0 ? totals.known_inventory_value : null;
  }
  return {
    generated_at: new Date(), target_gross_margin: margin, totals: totals, products: rows,
    pending_operations: pendingOperations,
    warning: pendingOperations.length ? "Есть незавершённые складские операции. Показатели могут отражать последнее подтверждённое состояние; проверь восстановление перед новыми операциями." : ""
  };
}

function di3GetProductFifoValuationHistory(productId, days) {
  di3AssertNoPendingStockOperations_();
  var count = Number(days || 30);
  if (![30, 90, 180].includes(count)) throw new Error("Поддерживаются периоды 30, 90 или 180 дней.");
  var ledgerRows = di3ReadRowsByColumnValue_("StockLedger", 3, productId).map(function (match) { return match.values; });
  var movementIds = [];
  var movementSet = Object.create(null);
  ledgerRows.forEach(function (row) {
    var movementId = String(row[0] || "");
    if (movementId && !movementSet[movementId]) {
      movementSet[movementId] = true;
      movementIds.push(movementId);
    }
  });
  var detailRows = movementIds.length
    ? di3ReadRowsByColumnValues_("StockMovementDetails", 0, movementIds).map(function (match) { return match.values; })
    : [];
  var lotRows = di3ReadRowsByColumnValue_("StockLots", 1, productId).map(function (match) { return match.values; });
  var events = di3GetFifoEventsForProduct_(productId, ledgerRows, detailRows, lotRows);
  var today = new Date();
  today.setHours(23, 59, 59, 999);
  var start = new Date(today.getTime());
  start.setDate(start.getDate() - (count - 1));
  start.setHours(0, 0, 0, 0);
  var availableLots = [];
  var eventIndex = 0;
  var result = [];

  // Apply each product event once, then snapshot the in-memory FIFO layers for each day.
  for (var day = 0; day < count; day++) {
    var cutoff = new Date(start.getTime());
    cutoff.setDate(start.getDate() + day);
    cutoff.setHours(23, 59, 59, 999);

    while (eventIndex < events.length && events[eventIndex].effective_at.getTime() <= cutoff.getTime()) {
      var event = events[eventIndex++];
      if (event.movement_type === "IN") {
        var lotRow = event.lot;
        availableLots.push({
          lot_id: String(lotRow[0]), product_id: String(productId),
          effective_at: di3ToDate_(lotRow[6], "StockLots.effective_at"),
          recorded_at: di3ToDate_(lotRow[7], "StockLots.recorded_at"),
          remaining_quantity: Number(lotRow[8]),
          initial_quantity: Number(lotRow[8]),
          consumed_quantity: 0,
          unit_cost: lotRow[9] === "" || lotRow[9] == null ? null : Number(lotRow[9]),
          total_cost_minor: di3MoneyGetLotTotalCostMinor_(lotRow),
          cost_status: String(lotRow[10] || "UNKNOWN")
        });
        availableLots.sort(function (a, b) {
          var byEffective = a.effective_at.getTime() - b.effective_at.getTime();
          if (byEffective) return byEffective;
          var byRecorded = a.recorded_at.getTime() - b.recorded_at.getTime();
          if (byRecorded) return byRecorded;
          return a.lot_id.localeCompare(b.lot_id);
        });
      } else {
        var needed = event.quantity;
        for (var i = 0; i < availableLots.length && needed > 0; i++) {
          var lot = availableLots[i];
          if (lot.remaining_quantity <= 0) continue;
          var take = Math.min(needed, lot.remaining_quantity);
          lot.remaining_quantity -= take;
          lot.consumed_quantity += take;
          needed -= take;
        }
        if (needed > 0) throw new Error("Недостаточно остатка для исторического FIFO-движения " + event.movement_id + ".");
      }
    }

    var totalQty = 0, knownQty = 0, unknownQty = 0, knownValueMinor = 0;
    availableLots.forEach(function (lot) {
      var remaining = Number(lot.remaining_quantity) || 0;
      totalQty += remaining;
      if (lot.cost_status === "UNKNOWN") unknownQty += remaining;
      else {
        knownQty += remaining;
        knownValueMinor += di3MoneyGetLotRemainingCostMinor_([
          lot.lot_id, productId, "", "", "", "", lot.effective_at, lot.recorded_at,
          lot.initial_quantity, lot.unit_cost, lot.cost_status, "", "", lot.remaining_quantity,
          lot.total_cost_minor
        ], remaining);
      }
    });
    var knownValue = di3MoneyFromMinorUnits_(knownValueMinor);
    result.push({
      date: new Date(cutoff.getFullYear(), cutoff.getMonth(), cutoff.getDate()),
      total_quantity: totalQty,
      known_quantity: knownQty,
      unknown_quantity: unknownQty,
      known_inventory_value_minor: knownValueMinor,
      known_inventory_value: knownValue,
      inventory_value: unknownQty === 0 ? knownValue : null,
      average_known_unit_cost: knownQty > 0 ? knownValue / knownQty : null,
      average_unit_cost: unknownQty === 0 && totalQty > 0 ? knownValue / totalQty : null,
      cost_coverage_pct: totalQty > 0 ? knownQty / totalQty * 100 : 100
    });
  }
  return result;
}

function di3FindRowByFirstColumn_(sheetName, key) {
  return di3ReadRowByColumnValue_(sheetName, 0, key);
}

function di3FindRowByColumnValue_(sheetName, columnIndexZeroBased, value) {
  return di3ReadRowByColumnValue_(sheetName, columnIndexZeroBased, value);
}

function di3SetOperationStatus_(operationRowNumber, status, committedAt, errorText) {
  var rowNumber = Number(operationRowNumber);
  if (!Number.isInteger(rowNumber) || rowNumber < 2) {
    throw new Error("Некорректный номер строки операции: " + operationRowNumber);
  }
  var sheet = di3GetSheetOrThrow_("Operations");
  // Preserve payload hash, started_at and actor with one read instead of four RPCs.
  var current = sheet.getRange(rowNumber, 6, 1, 6).getValues()[0];
  current[0] = String(status || "");
  current[3] = committedAt || "";
  current[4] = errorText || "";
  sheet.getRange(rowNumber, 6, 1, 6).setValues([current]);
}

function di3BuildManualMovementCommand_(command) {
  var direction = String(command.direction || "").toUpperCase();
  if (direction !== "IN" && direction !== "OUT") throw new Error("Тип движения должен быть IN или OUT.");
  var productId = String(command.product_id || "");
  var product = di3LoadProductById_(productId);
  if (!product) throw new Error("Выбранный товар не найден в Products.");
  if (product.active === false || String(product.active).toLowerCase() === "false") throw new Error("Выбранный товар отключён.");
  var quantity = Number(command.quantity);
  if (!Number.isInteger(quantity) || quantity <= 0) throw new Error("Количество должно быть положительным целым числом.");
  var effectiveAt = di3ToDate_(command.effective_at, "Дата операции");
  if (effectiveAt.getTime() > new Date().getTime() + 5 * 60 * 1000) {
    throw new Error("Нельзя провести ручное складское движение будущей датой. Для ожидаемого поступления используй документ поставки.");
  }
  var reasonCode = String(command.reason_code || "");
  var note = di3NormalizeText_(command.note);
  di3ValidateStockReason_(direction, reasonCode, note);
  var cost = null;
  var salePrice = null;
  if (direction === "IN") {
    cost = di3ValidateInboundCost_(command.cost_status, command.unit_cost);
    if (reasonCode === "FREE_GOODS" && cost.cost_status !== "FREE") {
      throw new Error("Для основания «Получено бесплатно» себестоимость должна иметь статус «Бесплатно».");
    }
  } else if (reasonCode === "OFFLINE_SALE") {
    salePrice = Number(command.unit_sale_price);
    if (command.unit_sale_price === "" || !Number.isFinite(salePrice) || salePrice <= 0) {
      throw new Error("Для продажи вне системы укажи положительную цену продажи за единицу.");
    }
  } else if (command.unit_sale_price !== "" && command.unit_sale_price != null) {
    salePrice = Number(command.unit_sale_price);
    if (!Number.isFinite(salePrice) || salePrice < 0) throw new Error("Цена продажи должна быть неотрицательной.");
  }
  var token = String(command.request_token || "").trim();
  if (!token) throw new Error("Не найден токен запроса. Обнови форму Менеджера склада.");
  return {
    request_token: token,
    direction: direction,
    product_id: productId,
    quantity: quantity,
    effective_at: effectiveAt.toISOString(),
    reason_code: reasonCode,
    note: note,
    cost_status: cost ? cost.cost_status : "",
    unit_cost: cost ? cost.unit_cost : "",
    unit_sale_price: salePrice == null ? "" : salePrice,
    source_module: "WAREHOUSE_MANAGER"
  };
}

function di3BuildManualOperationPayloadHash_(payload) {
  var canonical = JSON.stringify(payload);
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, canonical, Utilities.Charset.UTF_8);
  return bytes.map(function (b) { return (b < 0 ? b + 256 : b).toString(16).padStart(2, "0"); }).join("");
}

function di3NextMovementDisplayCode_(existingRows) {
  if (Array.isArray(existingRows)) {
    var suppliedMax = existingRows.reduce(function (value, row) {
      var match = String(row[1] || "").match(/^MOV-(\d+)$/);
      return match ? Math.max(value, Number(match[1])) : value;
    }, 0);
    return "MOV-" + String(suppliedMax + 1).padStart(6, "0");
  }
  var sheet = di3GetSheetOrThrow_("StockMovementDetails");
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return "MOV-000001";
  // Movement details are append-only in document order; inspect the final code only.
  var lastCode = String(sheet.getRange(lastRow, 2, 1, 1).getValue() || "");
  var lastMatch = lastCode.match(/^MOV-(\d+)$/);
  if (lastMatch) return "MOV-" + String(Number(lastMatch[1]) + 1).padStart(6, "0");
  // Defensive legacy fallback: read only the public-code column, not every detail column.
  var codes = sheet.getRange(2, 2, lastRow - 1, 1).getValues();
  var max = codes.reduce(function (value, row) {
    var match = String(row[0] || "").match(/^MOV-(\d+)$/);
    return match ? Math.max(value, Number(match[1])) : value;
  }, 0);
  return "MOV-" + String(max + 1).padStart(6, "0");
}

function di3AssertNoOtherPendingStockOperations_(currentIdempotencyKey) {
  var pending = di3GetPendingStockOperations_().filter(function (operation) {
    return String(operation.idempotency_key) !== String(currentIdempotencyKey);
  });
  if (pending.length) {
    throw new Error("Есть другая незавершённая складская операция. Сначала запусти di3RecoverPendingStockOperations().");
  }
}

/** Prevent any late stock movement from silently changing the original FIFO cost of an already-returned order. */
function di3AssertNoBackdatedMovementBeforeReturnedOrder_(productId, effectiveAt, operationLabel) {
  var orderSheet = di3GetSpreadsheet_().getSheetByName("V3_Orders");
  var itemSheet = di3GetSpreadsheet_().getSheetByName("V3_OrderItems");
  if (!orderSheet || !itemSheet || orderSheet.getLastRow() < 2 || itemSheet.getLastRow() < 2) return true;
  var movementDate = di3ToDate_(effectiveAt, "Дата операции").getTime();
  var returnedOrders = Object.create(null);
  di3ReadRowsByColumnValue_("V3_Orders", 3, "Возврат").forEach(function (match) {
    var row = match.values;
    if (!row[17]) return;
    var dispatchDate = di3ToDate_(row[17], "Дата отправки возвращённого заказа").getTime();
    if (movementDate < dispatchDate) returnedOrders[String(row[0])] = String(row[1]);
  });
  var returnedOrderIds = Object.keys(returnedOrders);
  if (!returnedOrderIds.length) return true;
  var affectedOrderIds = Object.create(null);
  di3ReadRowsByColumnValue_("V3_OrderItems", 3, productId).forEach(function (match) {
    var row = match.values;
    var orderId = String(row[1] || "");
    if (orderId && Object.prototype.hasOwnProperty.call(returnedOrders, orderId)) affectedOrderIds[orderId] = true;
  });
  var affectedNumbers = Object.keys(affectedOrderIds).map(function (id) { return returnedOrders[id]; });
  if (affectedNumbers.length) {
    throw new Error("Нельзя провести " + (operationLabel || "складское движение") + " задним числом раньше отправки уже возвращённого заказа " +
      affectedNumbers.join(", ") +
      ": это изменит первоначальное FIFO-распределение, по которому товар был возвращён. Укажи дату после отправки или выполни отдельную корректировку возврата.");
  }
  return true;
}

function di3AssertNoBackdatedReceiptBeforeReturnedOrder_(productId, effectiveAt) {
  return di3AssertNoBackdatedMovementBeforeReturnedOrder_(productId, effectiveAt, "приход");
}

function di3PostManualStockMovement(command) {
  return di3WithLock_(function () {
    di3EnsureStockCoreSchemas_();
    var payload = di3BuildManualMovementCommand_(command || {});
    var idempotencyKey = "MANUAL_STOCK:" + payload.request_token;
    di3AssertNoOtherPendingStockOperations_(idempotencyKey);
    var payloadHash = di3BuildManualStockRequestHash_(payload);
    var existingOperation = di3FindRowByColumnValue_("Operations", 1, idempotencyKey);
    if (existingOperation) {
      if (String(existingOperation.values[6]) !== payloadHash) {
        throw new Error("Этот токен уже использован с другими данными. Не меняй поля незавершённой операции; сначала восстанови её.");
      }
      if (String(existingOperation.values[5]) === "COMMITTED") {
        var committedMovementId = String(existingOperation.values[4]);
        var committedDetail = di3FindRowByFirstColumn_("StockMovementDetails", committedMovementId);
        var committedLedger = di3FindRowByFirstColumn_("StockLedger", committedMovementId);
        return {
          status: "ALREADY_COMMITTED",
          operation_id: String(existingOperation.values[0]),
          movement_id: committedMovementId,
          movement_code: committedDetail ? String(committedDetail.values[1]) : "",
          direction: committedDetail ? String(committedDetail.values[2]) : "",
          quantity: committedLedger ? Math.abs(Number(committedLedger.values[6]) || 0) : 0
        };
      }
      if (String(existingOperation.values[5]) === "REJECTED") {
        throw new Error("Предыдущая операция с этим токеном отклонена. Исправь команду и используй новый request_token.");
      }
      return di3ResumeManualStockOperation_(existingOperation, null);
    }

    di3AssertPeriodOpen_(payload.effective_at, "Ручное складское движение");
    di3AssertNoBackdatedMovementBeforeReturnedOrder_(payload.product_id, payload.effective_at,
      payload.direction === "IN" ? "приход" : "расход");
    var startedAt = new Date();
    // Keep the original request hash stable while storing the registration time
    // in the immutable event envelope for deterministic FIFO ties.
    var storedPayload = Object.assign({}, payload, { recorded_at: startedAt.toISOString() });
    var movementId = di3MakeUuid_();
    var operation = di3RegisterPreparedOperation_({
      idempotency_key: idempotencyKey,
      operation_type: "MANUAL_STOCK_MOVEMENT",
      document_type: "MANUAL_STOCK",
      document_id: movementId,
      payload: storedPayload,
      hash_payload: payload
    });
    return di3ResumeManualStockOperation_(operation, null);
  });
}

function di3BuildManualStockRequestHash_(payload) {
  return di3BuildManualOperationPayloadHash_(payload);
}

function di3ApplyManualStockOperation_(operationRecord, storedPayload) {
  var operationId = String(operationRecord.values[0]);
  var movementId = String(operationRecord.values[4]);
  var eventKey = String(operationRecord.values[1]);
  // Resolve only this event's records; do not materialize the full ledger, details or lot tables.
  var existingMovement = di3ReadRowByColumnValue_("StockLedger", 2, eventKey);
  var detailsRecord = di3ReadRowByColumnValue_("StockMovementDetails", 0, movementId);
  var lotRecord = storedPayload.direction === "IN"
    ? di3ReadRowByColumnValue_("StockLots", 2, movementId) : null;
  var effectiveAt = new Date(storedPayload.effective_at);
  var recordedAt = storedPayload.recorded_at ? new Date(storedPayload.recorded_at) : new Date();
  var displayCode = detailsRecord ? String(detailsRecord.values[1]) : di3NextMovementDisplayCode_();

  var ledgerRow = existingMovement ? existingMovement.values : [
    movementId, operationId, eventKey, storedPayload.product_id, "MANUAL_STOCK",
    movementId, storedPayload.direction === "IN" ? storedPayload.quantity : -storedPayload.quantity,
    effectiveAt, recordedAt, "", "", storedPayload.note
  ];
  if (existingMovement) ledgerRow._di3RowNumber = Number(existingMovement.row_number);
  var revenue = storedPayload.direction === "OUT" && storedPayload.reason_code === "OFFLINE_SALE"
    ? di3MoneyFromMinorUnits_(di3MoneyToMinorUnits_(storedPayload.unit_sale_price, "Цена продажи", false) * Number(storedPayload.quantity)) : "";
  var detailRow = detailsRecord ? detailsRecord.values : [
    movementId, displayCode, storedPayload.direction, storedPayload.reason_code,
    storedPayload.unit_sale_price, revenue,
    storedPayload.direction === "IN" ? storedPayload.cost_status : "",
    "", "", storedPayload.note, "WAREHOUSE_MANAGER"
  ];
  var lotRow = null;
  if (storedPayload.direction === "IN") {
    lotRow = lotRecord ? lotRecord.values : [
      di3MakeUuid_(), storedPayload.product_id, movementId, "MANUAL", storedPayload.reason_code,
      "", effectiveAt, recordedAt, storedPayload.quantity,
      storedPayload.cost_status === "UNKNOWN" ? "" : storedPayload.unit_cost,
      storedPayload.cost_status, di3GetBaseCurrency_(), storedPayload.note, "",
      storedPayload.cost_status === "UNKNOWN" ? "" : (storedPayload.cost_status === "FREE" ? 0 :
        di3MoneyToMinorUnits_(Number(storedPayload.unit_cost) * Number(storedPayload.quantity), "Полная себестоимость ручного прихода", false))
    ];
    if (lotRecord) lotRow._di3RowNumber = Number(lotRecord.row_number);
  }

  try {
    di3PreflightFifoForProductScoped_(storedPayload.product_id, ledgerRow, detailRow, lotRow, existingMovement);
  } catch (preflightError) {
    if (!existingMovement) throw di3MarkOperationErrorDisposition_(preflightError, "REJECTED");
    throw preflightError;
  }

  if (!existingMovement) di3AppendTableRows_("StockLedger", [ledgerRow]);
  if (!detailsRecord) di3AppendTableRows_("StockMovementDetails", [detailRow]);
  if (storedPayload.direction === "IN" && !lotRecord) di3AppendTableRows_("StockLots", [lotRow]);

  var fifoResult = di3RebuildFifoAllocations_("MANUAL_STOCK_MOVEMENT", [storedPayload.product_id]);
  var cost = storedPayload.direction === "OUT"
    ? di3GetMovementFifoCostWithinOperation_(movementId)
    : { total_cost_minor: storedPayload.cost_status === "UNKNOWN" ? null :
        (storedPayload.cost_status === "FREE" ? 0 : di3MoneyToMinorUnits_(Number(storedPayload.unit_cost) * Number(storedPayload.quantity), "Полная себестоимость ручного прихода", false)),
      total_cost: storedPayload.cost_status === "UNKNOWN" ? null : di3MoneyFromMinorUnits_(storedPayload.cost_status === "FREE" ? 0 :
        di3MoneyToMinorUnits_(Number(storedPayload.unit_cost) * Number(storedPayload.quantity), "Полная себестоимость ручного прихода", false)),
      cost_status: storedPayload.cost_status || "NOT_APPLICABLE" };
  return {
    status: "COMMITTED", operation_id: operationId, movement_id: movementId,
    movement_code: displayCode, direction: storedPayload.direction, quantity: storedPayload.quantity,
    fifo_cost: cost,
    financial_result: storedPayload.direction === "OUT" ? di3GetMovementFinancialResultWithinOperation_(movementId) : null,
    fifo_run_id: fifoResult.run_id
  };
}

function di3RecoverPendingStockOperations() {
  return di3WithLock_(function () {
    di3EnsureStockCoreSchemas_();
    return di3RecoverPreparedOperations_(["MANUAL_STOCK_MOVEMENT"]);
  });
}

function di3ResumeManualStockOperation_(operationRecord, payloadOverride) {
  // payloadOverride is intentionally ignored: the executor always reads and
  // verifies the immutable persisted payload before invoking the domain handler.
  return di3ExecutePreparedOperation_(operationRecord);
}
